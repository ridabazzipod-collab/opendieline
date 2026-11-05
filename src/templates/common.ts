import { arc, type Vec2 } from "../geometry.js";
import { DielineError, type DielineSpec } from "../model.js";

/** Box dimensions in millimetres. Length, width and depth are inside sizes. */
export interface BoxParameters {
  length: number;
  width: number;
  depth: number;
  /** Board thickness in mm. */
  thickness: number;
}

export interface Template {
  id: string;
  name: string;
  description: string;
  /** Typical parameters, also used as the defaults in the CLI and playground. */
  defaults: BoxParameters;
  build(parameters: BoxParameters): DielineSpec;
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
