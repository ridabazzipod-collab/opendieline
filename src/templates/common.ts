import { arc, type Vec2 } from "../geometry.js";
import type { FoldVerification } from "../fold.js";
import { DielineError, type Dieline, type DielineSpec } from "../model.js";

/** Box dimensions in millimetres. Length, width and depth are inside sizes. */
export interface BoxParameters {
  length: number;
  width: number;
  depth: number;
  /** Board thickness in mm. Pouches ignore it. */
  thickness: number;
  /** Pouch side seal width in mm. */
  seal?: number;
  /** Pouch: distance from the top edge to the zipper centre line, in mm. */
  zipper?: number;
  /** Pouch: radius of the top corners in mm. */
  corner?: number;
  /** Pouch: add a hang hole in the top seal. */
  hangHole?: boolean;
}

export type TemplateKind = "carton" | "pouch";

/** What each size means for this template. `null` hides a size that is not used. */
export interface FieldLabels {
  length: string;
  width: string | null;
  depth: string;
}

export const CARTON_LABELS: FieldLabels = { length: "Length", width: "Width", depth: "Depth" };

export interface Template {
  id: string;
  name: string;
  description: string;
  /** Typical parameters, also used as the defaults in the CLI and playground. */
  kind: TemplateKind;
  labels: FieldLabels;
  defaults: BoxParameters;
  /** The axis that points up when the finished pack stands on a table. */
  upright: "y" | "z";
  /** The panel shown to customers, and how far to turn a front image to read upright on it. */
  frontPanel: string;
  frontRotation: 0 | 90 | 180 | 270;
  build(parameters: BoxParameters): DielineSpec;
  /** Checks for templates that do not fold into a box, such as pouches. */
  verify?(dieline: Dieline): FoldVerification;
}

export interface BoxDimensions extends BoxParameters {
  /** Crease-to-crease sizes: each inside size plus one board thickness. */
  a: number;
  b: number;
  d: number;
}

const MAX_SIZE_MM = 5000;
const MAX_THICKNESS_MM = 25;

export function resolveDimensions(p: BoxParameters, minimumMm: number): BoxDimensions {
  for (const key of ["length", "width", "depth"] as const) {
    const value = p[key];
    if (!Number.isFinite(value) || value < minimumMm || value > MAX_SIZE_MM) {
      throw new DielineError(
        "INVALID_PARAMETER",
        `${key} must be between ${minimumMm} and ${MAX_SIZE_MM} mm, got ${value}.`,
      );
    }
  }
  if (!Number.isFinite(p.thickness) || p.thickness < 0 || p.thickness > MAX_THICKNESS_MM) {
    throw new DielineError(
      "INVALID_PARAMETER",
      `thickness must be between 0 and ${MAX_THICKNESS_MM} mm, got ${p.thickness}.`,
    );
  }
  const t = p.thickness;
  return { ...p, a: p.length + t, b: p.width + t, d: p.depth + t };
}

/** A tapered flap on a horizontal edge. `direction` is -1 for up, +1 for down. */
export function endFlap(
  x0: number,
  x1: number,
  y: number,
  direction: -1 | 1,
  height: number,
  inset: number,
  taper: number,
): Vec2[] {
  const tip = y + direction * height;
  return [
    [x0 + inset, y],
    [x0 + inset + taper, tip],
    [x1 - inset - taper, tip],
    [x1 - inset, y],
  ];
}

/** A tapered flap on a vertical edge. `direction` is -1 for left, +1 for right. */
export function sideFlap(
  x: number,
  y0: number,
  y1: number,
  direction: -1 | 1,
  width: number,
  inset: number,
  taper: number,
): Vec2[] {
  const tip = x + direction * width;
  return [
    [x, y0 + inset],
    [tip, y0 + inset + taper],
    [tip, y1 - inset - taper],
    [x, y1 - inset],
  ];
}

/** A round-cornered tuck tab on a horizontal edge. */
export function tuckTab(
  x0: number,
  x1: number,
  y: number,
  direction: -1 | 1,
  height: number,
  inset: number,
  radius: number,
): Vec2[] {
  const left = x0 + inset;
  const right = x1 - inset;
  const cornerY = y + direction * (height - radius);
  const leftCorner =
    direction < 0
      ? arc([left + radius, cornerY], radius, 180, 270)
      : arc([left + radius, cornerY], radius, 180, 90);
  const rightCorner =
    direction < 0
      ? arc([right - radius, cornerY], radius, 270, 360)
      : arc([right - radius, cornerY], radius, 90, 0);
  return [[left, y], ...leftCorner, ...rightCorner, [right, y]];
}
