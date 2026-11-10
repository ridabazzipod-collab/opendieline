import type { Bounds, Vec2 } from "./geometry.js";

/**
 * - `wall`: forms an outer face of the finished box. Walls are counted when
 *   checking that the folded box is fully closed.
 * - `flap`: tucks or glues inside the box (dust flap, glue flap, tuck tab).
 */
export type PanelRole = "wall" | "flap";

/** One flat piece of board, joined to its parent along a shared edge. */
export interface PanelSpec {
  id: string;
  label?: string;
  role: PanelRole;
  polygon: readonly Vec2[];
  /** The panel this one folds from. Exactly one panel, the root, has no parent. */
  parent?: string;
  /** Fold angle in degrees, measured away from the printed side. Defaults to 90. */
  foldAngle?: number;
}

export type GuideKind = "seal" | "zipper";

/** A non-cutting production mark, such as a heat-seal area or a zipper line. */
export interface Guide {
  kind: GuideKind;
  points: readonly Vec2[];
  closed: boolean;
}

/** Resolved sizes of a pouch, in mm. */
export interface PouchInfo {
  width: number;
  height: number;
  /** Bottom gusset depth. Zero for a flat pouch. */
  gusset: number;
  seal: number;
  topSeal: number;
  /** Distance from the top edge to the zipper centre line. */
  zipper: number;
  corner: number;
  /** Distance from the top edge to the tear notches. */
  notchY: number;
  hangHole: boolean;
}

export interface DielineSpec {
  template: string;
  panels: readonly PanelSpec[];
  /** Crease-to-crease size of the folded box, in mm. */
  foldedSize: readonly [number, number, number];
  /** Number of box faces that are open by design: 1 for a tray, 2 for a sleeve. */
  openFaces: number;
  /** Closed cut paths inside the blank, such as a hang hole. */
  innerCuts?: readonly (readonly Vec2[])[];
  guides?: readonly Guide[];
  pouch?: PouchInfo;
}

export interface Hinge {
  from: Vec2;
  to: Vec2;
  /** Signed fold angle in radians about the from→to axis. */
  angle: number;
}

export interface Panel extends PanelSpec {
  area: number;
  /** Absent on the root panel. */
  hinge?: Hinge;
}

export interface Crease {
  from: Vec2;
  to: Vec2;
  panels: readonly [string, string];
}

/** A fully resolved dieline, guaranteed to be one valid, non-overlapping blank. */
export interface Dieline {
  template: string;
  panels: readonly Panel[];
  /** The closed outer cut path. */
  cut: readonly Vec2[];
  creases: readonly Crease[];
  bounds: Bounds;
  foldedSize: readonly [number, number, number];
  openFaces: number;
  innerCuts: readonly (readonly Vec2[])[];
  guides: readonly Guide[];
  pouch?: PouchInfo;
}

export type DielineErrorCode =
  | "INVALID_PARAMETER"
  | "INVALID_PANEL"
  | "INVALID_HIERARCHY"
  | "MISSING_HINGE"
  | "OVERLAPPING_PANELS"
  | "OPEN_OUTLINE"
  | "SELF_INTERSECTION"
  | "UNKNOWN_TEMPLATE";

export class DielineError extends Error {
  constructor(
    readonly code: DielineErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "DielineError";
  }
}
