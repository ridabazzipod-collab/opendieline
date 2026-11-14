import { rect } from "../geometry.js";
import { compile } from "../compile.js";
import { verifyFold, type FoldCheck, type FoldVerification } from "../fold.js";
import { DielineError, type DielineSpec, type PanelSpec } from "../model.js";
import { CARTON_LABELS, endFlap, sideFlap, tuckTab, type BoxParameters, type Template } from "./common.js";

/**
 * A four-panel carton read from a finished dieline picture. Every size is in the same unit,
 * pixels when read from a picture and millimetres once the template scales it.
 */
export interface CartonLayout {
  /** Widths of the four wall panels from left to right. */
  widths: [number, number, number, number];
  /** Width of the glue flap on the left of the first panel. 0 means there is none. */
  glue: number;
  /** Height of the wall panels. */
  height: number;
  /** Which panel carries the top lid. The panel opposite it is the front. */
  lidPanel: 0 | 1 | 2 | 3;
  /** Total height above the wall row, the lid and its tuck tab together. */
  lidTop: number;
}

/** Where a carton sits in a picture, in picture pixels. */
export interface PixelLayout {
  /** Left edge of the first panel, then the edge after each panel. Five numbers. */
  breaks: [number, number, number, number, number];
  /** Left edge of the glue flap, equal to `breaks[0]` when there is no glue. */
  glueLeft: number;
  /** Top of the wall row and bottom of the wall row. */
  rowTop: number;
  rowBottom: number;
  /** Top of the whole dieline. */
  top: number;
  lidPanel: 0 | 1 | 2 | 3;
  /** True when the picture did not show clear panel edges and these are only a first guess. */
  guessed: boolean;
}

export function layoutFromPixels(p: PixelLayout): CartonLayout {
  const widths = [0, 1, 2, 3].map((i) => p.breaks[i + 1]! - p.breaks[i]!) as CartonLayout["widths"];
  return {
    widths,
    glue: Math.max(0, p.breaks[0] - p.glueLeft),
    height: p.rowBottom - p.rowTop,
    lidPanel: p.lidPanel,
    lidTop: p.rowTop - p.top,
  };
}

const RELIEF_MM = 0.5;
const frontOf = (layout: CartonLayout): number => (layout.lidPanel + 2) % 4;

/** Opposite panels are made equal, so the carton closes. Pictures are never exact to the pixel. */
export function idealise(layout: CartonLayout): CartonLayout {
  const back = layout.lidPanel;
  const front = frontOf(layout);
  const sideA = (back + 1) % 4;
  const sideB = (back + 3) % 4;
  const length = (layout.widths[back]! + layout.widths[front]!) / 2;
  const width = (layout.widths[sideA]! + layout.widths[sideB]!) / 2;
  const widths = [...layout.widths] as CartonLayout["widths"];
  widths[back] = length;
  widths[front] = length;
  widths[sideA] = width;
  widths[sideB] = width;
  return { ...layout, widths };
}

function check(layout: CartonLayout): void {
  const values = [...layout.widths, layout.height, layout.lidTop, layout.glue];
  if (values.some((value) => !Number.isFinite(value) || value < 0) || layout.widths.some((w) => w <= 0) || layout.height <= 0) {
    throw new DielineError("INVALID_PARAMETER", "The panel sizes read from the picture are not usable.");
  }
}

/**
 * Builds the blank from measured panel sizes. With `exact`, panels keep the sizes
 * measured in the picture, so artwork lines up pixel for pixel.
 */
export function buildCustomCarton(measured: CartonLayout, exact: boolean): DielineSpec {
  check(measured);
  const layout = exact ? measured : idealise(measured);
  const { widths, height: d } = layout;
  const edges = [0];
  for (const w of widths) edges.push(edges[edges.length - 1]! + w);

  const back = layout.lidPanel;
  const front = frontOf(layout);
  const sides = [(back + 1) % 4, (back + 3) % 4] as const;
  const length = (widths[back]! + widths[front]!) / 2;
  const sideWidth = (widths[sides[0]]! + widths[sides[1]]!) / 2;

  const lidDepth = Math.min(sideWidth, layout.lidTop * 0.92);
  const tabHeight = Math.max(2, Math.min(layout.lidTop - lidDepth, sideWidth * 0.6, d * 0.5));
  const tabRadius = Math.min(5, tabHeight * 0.6);
  const dustHeight = Math.min(length * 0.45, d * 0.6);
  const dustTaper = Math.min(dustHeight * 0.3, sideWidth * 0.2);
  const glue = Math.min(layout.glue || sideWidth * 0.4, sideWidth * 0.6);

  const name = (index: number): string =>
    index === back ? "back" : index === front ? "front" : `side-${index === sides[0] ? 1 : 2}`;
  const label = (index: number): string => (index === back ? "Back" : index === front ? "Front" : "Side");

  // The panel that carries the lid is the root; the others hang off it along the strip.
  const parentOf = new Map<number, number>();
  for (let i = back - 1; i >= 0; i--) parentOf.set(i, i + 1);
  for (let i = back + 1; i < 4; i++) parentOf.set(i, i - 1);

  const panels: PanelSpec[] = [];
  const order = [back, ...[0, 1, 2, 3].filter((i) => i !== back).sort((p, q) => Math.abs(p - back) - Math.abs(q - back))];
  for (const i of order) {
    const parent = parentOf.get(i);
    panels.push({
      id: name(i),
      label: label(i),
      role: "wall",
      ...(parent === undefined ? {} : { parent: name(parent) }),
      polygon: rect(edges[i]!, 0, edges[i + 1]!, d),
    });
  }

  if (layout.glue > 0) {
    panels.push({
      id: "glue",
      label: "Glue",
      role: "flap",
      parent: name(0),
      polygon: sideFlap(0, 0, d, -1, glue, 1, glue * 0.35),
    });
  }

  panels.push(
    { id: "top-lid", label: "Top", role: "wall", parent: "back", polygon: rect(edges[back]!, -lidDepth, edges[back + 1]!, 0) },
    {
      id: "top-tab",
      label: "Tuck",
      role: "flap",
      parent: "top-lid",
      polygon: tuckTab(edges[back]!, edges[back + 1]!, -lidDepth, -1, tabHeight, 1, tabRadius),
    },
    { id: "bottom-lid", label: "Bottom", role: "wall", parent: "front", polygon: rect(edges[front]!, d, edges[front + 1]!, d + lidDepth) },
    {
      id: "bottom-tab",
      label: "Tuck",
      role: "flap",
      parent: "bottom-lid",
      polygon: tuckTab(edges[front]!, edges[front + 1]!, d + lidDepth, 1, tabHeight, 1, tabRadius),
    },
  );

  for (const index of sides) {
    const id = name(index);
    const x0 = edges[index]!;
    const x1 = edges[index + 1]!;
    panels.push(
      { id: `${id}-top-dust`, label: "Dust", role: "flap", parent: id, polygon: endFlap(x0, x1, 0, -1, dustHeight, RELIEF_MM, dustTaper) },
      { id: `${id}-bottom-dust`, label: "Dust", role: "flap", parent: id, polygon: endFlap(x0, x1, d, 1, dustHeight, RELIEF_MM, dustTaper) },
    );
  }

  return { template: "from-image", panels, foldedSize: [length, sideWidth, d], openFaces: 0 };
}

/** How far apart opposite panels are, as a share of their size. */
function mismatch(layout: CartonLayout): number {
  const back = layout.lidPanel;
  const front = frontOf(layout);
  const sideA = (back + 1) % 4;
  const sideB = (back + 3) % 4;
  const pair = (p: number, q: number): number => Math.abs(layout.widths[p]! - layout.widths[q]!) / Math.max(layout.widths[p]!, layout.widths[q]!);
  return Math.max(pair(back, front), pair(sideA, sideB));
}

/**
 * A template for one carton read from a picture. It is not in the template list,
 * because it only exists for the picture it was read from.
 */
export function customCartonTemplate(layout: CartonLayout): Template {
  check(layout);
  const front = frontOf(layout);
  const scaled = (parameters: BoxParameters): { layout: CartonLayout; scale: number } => {
    const scale = parameters.length / layout.widths[front]!;
    return {
      scale,
      layout: {
        widths: layout.widths.map((w) => w * scale) as CartonLayout["widths"],
        glue: layout.glue * scale,
        height: layout.height * scale,
        lidPanel: layout.lidPanel,
        lidTop: layout.lidTop * scale,
      },
    };
  };
  const ideal = idealise(layout);
  const idealLength = ideal.widths[front]!;
  return {
    id: "from-image",
    name: "From your dieline picture",
    description:
      "A four-panel carton read from your own dieline picture. Panel edges come from the picture, so the artwork lands exactly where you placed it.",
    kind: "carton",
    labels: { ...CARTON_LABELS, length: "Front width", width: null },
    defaults: { length: 90, width: 60, depth: 80, thickness: 0 },
    upright: "y",
    frontPanel: "front",
    frontRotation: 0,
    build: (parameters) => buildCustomCarton(scaled(parameters).layout, true),
    verify: (dieline): FoldVerification => {
      const scale = dieline.foldedSize[0] / idealLength;
      const idealSpec = buildCustomCarton(
        {
          widths: layout.widths.map((w) => w * scale) as CartonLayout["widths"],
          glue: layout.glue * scale,
          height: layout.height * scale,
          lidPanel: layout.lidPanel,
          lidTop: layout.lidTop * scale,
        },
        false,
      );
      const folded = verifyFold(compile(idealSpec));
      const gap = mismatch(layout);
      const match: FoldCheck = {
        name: "panels read from picture",
        passed: gap < 0.06,
        detail: `opposite panels differ by ${(gap * 100).toFixed(1)}%; the fold check uses their average.`,
      };
      return { passed: folded.passed && match.passed, measuredSize: folded.measuredSize, checks: [...folded.checks, match] };
    },
  };
}
