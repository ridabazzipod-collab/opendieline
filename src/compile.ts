import {
  area,
  bounds,
  centroid,
  distance,
  edgeKey,
  parameterOnSegment,
  pointInPolygon,
  pointKey,
  samePoint,
  segmentsCross,
  signedArea,
  simplifyClosed,
  type Vec2,
} from "./geometry.js";
import {
  DielineError,
  type Crease,
  type Dieline,
  type DielineSpec,
  type Hinge,
  type Panel,
  type PanelSpec,
} from "./model.js";

interface SplitEdge {
  a: Vec2;
  b: Vec2;
  panels: string[];
}

/**
 * Turns a set of panels into a manufacturable dieline.
 *
 * Templates only describe panels and which panel folds from which. Everything
 * else is derived: an edge used by two panels is a crease, an edge used by one
 * panel is a cut. This makes it impossible for the cut, crease and fold data to
 * disagree, and lets the compiler reject a bad blank instead of exporting it.
 */
export function compile(spec: DielineSpec): Dieline {
  validateHierarchy(spec.panels);
  const edges = collectEdges(spec.panels);
  const creases = deriveCreases(spec.panels, edges);
  const cut = traceCutPath([...edges.values()].filter((edge) => edge.panels.length === 1));
  validateBlank(spec.panels, cut);

  const hingeByPanel = new Map(creases.map((crease) => [crease.child, crease.hinge]));
  const panels: Panel[] = spec.panels.map((panel) => {
    const hinge = hingeByPanel.get(panel.id);
    return { ...panel, area: area(panel.polygon), ...(hinge ? { hinge } : {}) };
  });

  const innerCuts = spec.innerCuts ?? [];
  for (const hole of innerCuts) {
    if (hole.length < 3 || !hole.every((point) => pointInPolygon(point, cut))) {
      throw new DielineError("INVALID_PANEL", "An inner cut must sit fully inside the blank.");
    }
  }

  return {
    template: spec.template,
    panels,
    cut,
    creases: creases.map(({ crease }) => crease),
    bounds: bounds(cut),
    foldedSize: spec.foldedSize,
    openFaces: spec.openFaces,
    innerCuts,
    guides: spec.guides ?? [],
    ...(spec.pouch ? { pouch: spec.pouch } : {}),
  };
}

function validateHierarchy(panels: readonly PanelSpec[]): void {
  const byId = new Map<string, PanelSpec>();
  for (const panel of panels) {
    if (byId.has(panel.id)) {
      throw new DielineError("INVALID_PANEL", `Duplicate panel id "${panel.id}".`);
    }
    if (panel.polygon.length < 3 || area(panel.polygon) < 1e-6) {
      throw new DielineError("INVALID_PANEL", `Panel "${panel.id}" has no area.`);
    }
    if (!panel.polygon.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y))) {
      throw new DielineError("INVALID_PANEL", `Panel "${panel.id}" has a non-finite coordinate.`);
    }
    byId.set(panel.id, panel);
  }

  const roots = panels.filter((panel) => panel.parent === undefined);
  if (roots.length !== 1) {
    throw new DielineError(
      "INVALID_HIERARCHY",
      `Expected exactly one root panel, found ${roots.length}.`,
    );
  }

  for (const panel of panels) {
    const seen = new Set<string>();
    let current: PanelSpec | undefined = panel;
    while (current?.parent !== undefined) {
      if (seen.has(current.id)) {
        throw new DielineError("INVALID_HIERARCHY", `Panel "${panel.id}" is in a parent cycle.`);
      }
      seen.add(current.id);
      const parent = byId.get(current.parent);
      if (!parent) {
        throw new DielineError(
          "INVALID_HIERARCHY",
          `Panel "${current.id}" has an unknown parent "${current.parent}".`,
        );
      }
      current = parent;
    }
  }
}

/** Splits every panel edge at T-junctions so shared edges match exactly. */
function collectEdges(panels: readonly PanelSpec[]): Map<string, SplitEdge> {
  const vertices = new Map<string, Vec2>();
  for (const panel of panels) {
    for (const point of panel.polygon) vertices.set(pointKey(point), point);
  }
  const allVertices = [...vertices.values()];

  const edges = new Map<string, SplitEdge>();
  for (const panel of panels) {
    const polygon = panel.polygon;
    for (let i = 0; i < polygon.length; i++) {
      const start = polygon[i]!;
      const end = polygon[(i + 1) % polygon.length]!;
      if (samePoint(start, end)) continue;

      const stops = allVertices
        .map((point) => ({ point, t: parameterOnSegment(point, start, end) }))
        .filter((stop): stop is { point: Vec2; t: number } => stop.t !== null)
        .sort((p, q) => p.t - q.t);

      for (let s = 0; s + 1 < stops.length; s++) {
        const a = stops[s]!.point;
        const b = stops[s + 1]!.point;
        if (samePoint(a, b)) continue;
        const key = edgeKey(a, b);
        const edge = edges.get(key);
        if (edge) edge.panels.push(panel.id);
        else edges.set(key, { a, b, panels: [panel.id] });
      }
    }
  }
  return edges;
}

function deriveCreases(
  panels: readonly PanelSpec[],
  edges: Map<string, SplitEdge>,
): { child: string; crease: Crease; hinge: Hinge }[] {
  const byId = new Map(panels.map((panel) => [panel.id, panel]));
  const shared = new Map<string, SplitEdge[]>();

  for (const edge of edges.values()) {
    if (edge.panels.length === 1) continue;
    if (edge.panels.length > 2) {
      throw new DielineError(
        "OVERLAPPING_PANELS",
        `Panels ${edge.panels.join(", ")} all use the same edge.`,
      );
    }
    const [first, second] = edge.panels as [string, string];
    const child =
      byId.get(first)?.parent === second
        ? first
        : byId.get(second)?.parent === first
          ? second
          : undefined;
    if (!child) {
      throw new DielineError(
        "MISSING_HINGE",
        `Panels "${first}" and "${second}" touch but neither folds from the other.`,
      );
    }
    const list = shared.get(child) ?? [];
    list.push(edge);
    shared.set(child, list);
  }

  const result: { child: string; crease: Crease; hinge: Hinge }[] = [];
  for (const panel of panels) {
    if (panel.parent === undefined) continue;
    const segments = shared.get(panel.id);
    if (!segments) {
      throw new DielineError(
        "MISSING_HINGE",
        `Panel "${panel.id}" does not share an edge with its parent "${panel.parent}".`,
      );
    }

    const points = segments.flatMap((segment) => [segment.a, segment.b]);
    const [from, to] = farthestPair(points);
    const hingeLength = distance(from, to);
    const sharedLength = segments.reduce((sum, s) => sum + distance(s.a, s.b), 0);
    const collinear = points.every((point) => parameterOnSegment(point, from, to) !== null);
    if (!collinear || Math.abs(hingeLength - sharedLength) > 1e-3) {
      throw new DielineError(
        "MISSING_HINGE",
        `Panel "${panel.id}" must join its parent along one straight line.`,
      );
    }

    result.push({
      child: panel.id,
      crease: { from, to, panels: [panel.parent, panel.id] },
      hinge: { from, to, angle: signedFoldAngle(panel, from, to) },
    });
  }
  return result;
}

function farthestPair(points: readonly Vec2[]): [Vec2, Vec2] {
  let pair: [Vec2, Vec2] = [points[0]!, points[1]!];
  let longest = -1;
  for (const a of points) {
    for (const b of points) {
      const length = distance(a, b);
      if (length > longest) {
        longest = length;
        pair = [a, b];
      }
    }
  }
  return pair;
}

/**
 * Picks the rotation direction that folds the panel away from the printed side.
 *
 * With +x right and +y down, a right-handed z axis points away from someone looking at
 * the flat dieline. That person sees the printed side, so the printed side faces -z and
 * panels fold towards +z.
 */
function signedFoldAngle(panel: PanelSpec, from: Vec2, to: Vec2): number {
  const [cx, cy] = centroid(panel.polygon);
  const ux = to[0] - from[0];
  const uy = to[1] - from[1];
  const zOfRotation = ux * (cy - from[1]) - uy * (cx - from[0]);
  const direction = zOfRotation > 0 ? 1 : -1;
  return (direction * (panel.foldAngle ?? 90) * Math.PI) / 180;
}

function traceCutPath(edges: readonly SplitEdge[]): Vec2[] {
  const adjacency = new Map<string, { point: Vec2; edges: SplitEdge[] }>();
  const attach = (point: Vec2, edge: SplitEdge): void => {
    const key = pointKey(point);
    const node = adjacency.get(key) ?? { point, edges: [] };
    node.edges.push(edge);
    adjacency.set(key, node);
  };
  for (const edge of edges) {
    attach(edge.a, edge);
    attach(edge.b, edge);
  }

  for (const node of adjacency.values()) {
    if (node.edges.length !== 2) {
      throw new DielineError(
        "OPEN_OUTLINE",
        `Cut path is not a single clean loop at (${node.point.join(", ")}): ` +
          `${node.edges.length} cut edges meet there.`,
      );
    }
  }

  const first = edges[0];
  if (!first) throw new DielineError("OPEN_OUTLINE", "Dieline has no cut edges.");
  const path: Vec2[] = [first.a];
  const used = new Set<SplitEdge>([first]);
  let current = first.b;
  while (!samePoint(current, path[0]!)) {
    path.push(current);
    const node = adjacency.get(pointKey(current))!;
    const next = node.edges.find((edge) => !used.has(edge));
    if (!next) throw new DielineError("OPEN_OUTLINE", "Cut path does not close.");
    used.add(next);
    current = pointKey(next.a) === pointKey(current) ? next.b : next.a;
  }

  if (used.size !== edges.length) {
    throw new DielineError(
      "OPEN_OUTLINE",
      `Blank has ${edges.length - used.size} cut edges outside the main outline.`,
    );
  }
  return simplifyClosed(signedArea(path) < 0 ? path.reverse() : path);
}

function validateBlank(panels: readonly PanelSpec[], cut: readonly Vec2[]): void {
  for (let i = 0; i < cut.length; i++) {
    const a = cut[i]!;
    const b = cut[(i + 1) % cut.length]!;
    for (let j = i + 2; j < cut.length; j++) {
      if (i === 0 && j === cut.length - 1) continue;
      if (segmentsCross(a, b, cut[j]!, cut[(j + 1) % cut.length]!)) {
        throw new DielineError("SELF_INTERSECTION", "The cut path crosses itself.");
      }
    }
  }

  // If panels overlap, their combined area exceeds the area enclosed by the outline.
  const panelArea = panels.reduce((sum, panel) => sum + area(panel.polygon), 0);
  const outlineArea = area(cut);
  if (Math.abs(panelArea - outlineArea) > Math.max(0.01, panelArea * 1e-6)) {
    throw new DielineError(
      "OVERLAPPING_PANELS",
      `Panels cover ${panelArea.toFixed(2)} mm² but the outline encloses ${outlineArea.toFixed(2)} mm².`,
    );
  }
}
