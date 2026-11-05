import type { Vec2 } from "./geometry.js";
import type { Dieline, Hinge } from "./model.js";

export type Vec3 = readonly [x: number, y: number, z: number];

/** Affine transform stored as rows of a 3×4 matrix. */
type Transform = readonly number[];

const IDENTITY: Transform = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];

function multiply(p: Transform, q: Transform): Transform {
  const out: number[] = [];
  for (let row = 0; row < 3; row++) {
    const r = row * 4;
    for (let column = 0; column < 4; column++) {
      out.push(
        p[r]! * q[column]! +
          p[r + 1]! * q[column + 4]! +
          p[r + 2]! * q[column + 8]! +
          (column === 3 ? p[r + 3]! : 0),
      );
    }
  }
  return out;
}

function apply(m: Transform, [x, y]: Vec2): Vec3 {
  return [
    m[0]! * x + m[1]! * y + m[3]!,
    m[4]! * x + m[5]! * y + m[7]!,
    m[8]! * x + m[9]! * y + m[11]!,
  ];
}

/** Rodrigues rotation about a hinge line lying in the flat z=0 plane. */
function hingeRotation(hinge: Hinge, progress: number): Transform {
  const [px, py] = hinge.from;
  const dx = hinge.to[0] - px;
  const dy = hinge.to[1] - py;
  const length = Math.hypot(dx, dy);
  const ux = dx / length;
  const uy = dy / length;
  const theta = hinge.angle * progress;
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  const v = 1 - c;

  const r00 = c + ux * ux * v;
  const r01 = ux * uy * v;
  const r02 = uy * s;
  const r10 = ux * uy * v;
  const r11 = c + uy * uy * v;
  const r12 = -ux * s;
  const r20 = -uy * s;
  const r21 = ux * s;
  const r22 = c;

  return [
    r00, r01, r02, px - (r00 * px + r01 * py),
    r10, r11, r12, py - (r10 * px + r11 * py),
    r20, r21, r22, -(r20 * px + r21 * py),
  ];
}

export interface FoldedPanel {
  id: string;
  role: "wall" | "flap";
  points: readonly Vec3[];
}

/** Folds the blank in 3D. `progress` runs from 0 (flat) to 1 (fully folded). */
export function foldPanels(dieline: Dieline, progress = 1): FoldedPanel[] {
  const byId = new Map(dieline.panels.map((panel) => [panel.id, panel]));
  const transforms = new Map<string, Transform>();

  const transformFor = (id: string): Transform => {
    const known = transforms.get(id);
    if (known) return known;
    const panel = byId.get(id)!;
    const local = panel.hinge ? hingeRotation(panel.hinge, progress) : IDENTITY;
    const transform =
      panel.parent === undefined ? local : multiply(transformFor(panel.parent), local);
    transforms.set(id, transform);
    return transform;
  };

  return dieline.panels.map((panel) => {
    const transform = transformFor(panel.id);
    return {
      id: panel.id,
      role: panel.role,
      points: panel.polygon.map((point) => apply(transform, point)),
    };
  });
}

export interface FoldCheck {
  name: string;
  passed: boolean;
  detail: string;
}

export interface FoldVerification {
  passed: boolean;
  /** Measured crease-to-crease size of the folded box, largest first. */
  measuredSize: readonly [number, number, number];
  checks: readonly FoldCheck[];
}

const TOLERANCE_MM = 1e-3;
/** Share of a closed face walls must cover. Slotted boxes leave narrow slots. */
const MIN_FACE_COVERAGE = 0.9;

/**
 * Proves that a blank makes the box it claims to make, by folding it in 3D:
 * the box measures the requested size, every wall sits on a box face, the faces
 * that should be closed are closed, and no flap ends up outside the box.
 */
export function verifyFold(dieline: Dieline): FoldVerification {
  const folded = foldPanels(dieline, 1);
  const walls = folded.filter((panel) => panel.role === "wall");
  const wallPoints = walls.flatMap((panel) => [...panel.points]);

  const low = [0, 1, 2].map((axis) => Math.min(...wallPoints.map((p) => p[axis]!)));
  const high = [0, 1, 2].map((axis) => Math.max(...wallPoints.map((p) => p[axis]!)));
  const extents = [0, 1, 2].map((axis) => high[axis]! - low[axis]!);

  const descending = (p: number, q: number): number => q - p;
  const measured = [...extents].sort(descending) as [number, number, number];
  const expected = [...dieline.foldedSize].sort(descending);
  const sizeMatches = measured.every((v, i) => Math.abs(v - expected[i]!) <= TOLERANCE_MM);

  const coverage = new Map<string, number>();
  const offFace: string[] = [];
  for (const panel of walls) {
    const face = faceOf(panel.points, low, high);
    if (!face) {
      offFace.push(panel.id);
      continue;
    }
    const area = dieline.panels.find((p) => p.id === panel.id)!.area;
    coverage.set(face, (coverage.get(face) ?? 0) + area);
  }

  let closedFaces = 0;
  for (const [face, covered] of coverage) {
    const axis = Number(face[1]);
    const others = [0, 1, 2].filter((a) => a !== axis);
    const faceArea = extents[others[0]!]! * extents[others[1]!]!;
    if (covered / faceArea >= MIN_FACE_COVERAGE) closedFaces++;
  }
  const expectedClosed = 6 - dieline.openFaces;

  const escaped = folded
    .filter((panel) =>
      panel.points.some((point) =>
        point.some(
          (value, axis) =>
            value < low[axis]! - TOLERANCE_MM || value > high[axis]! + TOLERANCE_MM,
        ),
      ),
    )
    .map((panel) => panel.id);

  const checks: FoldCheck[] = [
    {
      name: "size",
      passed: sizeMatches,
      detail: `folded ${measured.map((v) => v.toFixed(2)).join(" × ")} mm, expected ${expected
        .map((v) => v.toFixed(2))
        .join(" × ")} mm`,
    },
    {
      name: "walls",
      passed: offFace.length === 0,
      detail: offFace.length ? `not on a box face: ${offFace.join(", ")}` : "every wall sits on a box face",
    },
    {
      name: "closure",
      passed: closedFaces === expectedClosed,
      detail: `${closedFaces} of ${expectedClosed} required faces closed`,
    },
    {
      name: "containment",
      passed: escaped.length === 0,
      detail: escaped.length ? `outside the box: ${escaped.join(", ")}` : "every flap folds inside the box",
    },
  ];

  return { passed: checks.every((check) => check.passed), measuredSize: measured, checks };
}

function faceOf(
  points: readonly Vec3[],
  low: readonly number[],
  high: readonly number[],
): string | null {
  for (let axis = 0; axis < 3; axis++) {
    if (points.every((p) => Math.abs(p[axis]! - low[axis]!) <= TOLERANCE_MM)) return `a${axis}-`;
    if (points.every((p) => Math.abs(p[axis]! - high[axis]!) <= TOLERANCE_MM)) return `a${axis}+`;
  }
  return null;
}
