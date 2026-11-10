import { arc, rect, type Vec2 } from "../geometry.js";
import type { FoldCheck, FoldVerification } from "../fold.js";
import {
  DielineError,
  type Dieline,
  type DielineSpec,
  type Guide,
  type PanelSpec,
  type PouchInfo,
} from "../model.js";
import type { BoxParameters, Template } from "./common.js";

/** Half the height of a press-to-close zipper band, in mm. */
const ZIPPER_HALF_BAND = 5;
const NOTCH = 3;
const HOLE_WIDTH = 24;
const HOLE_HEIGHT = 7;

const tidy = (value: number): number => Math.round(value * 10) / 10;

function fail(message: string): never {
  throw new DielineError("INVALID_PARAMETER", message);
}

function inRange(name: string, value: number, low: number, high: number): void {
  if (!Number.isFinite(value) || value < low || value > high) {
    fail(`${name} must be between ${tidy(low)} and ${tidy(high)} mm, got ${value}.`);
  }
}

/**
 * Pouch sizes use the box fields like this: length is the pouch width, depth is the pouch
 * height, and width is the bottom gusset. A standing pouch then measures length × width ×
 * depth, just like a carton.
 */
export function resolvePouch(parameters: BoxParameters, standUp: boolean): PouchInfo {
  const width = parameters.length;
  const height = parameters.depth;
  inRange("width", width, 40, 1000);
  inRange("height", height, 60, 1200);

  const gusset = standUp ? parameters.width : 0;
  if (standUp) inRange("gusset", gusset, 20, Math.min(width, height / 2));

  const seal = parameters.seal ?? 8;
  inRange("seal", seal, 3, Math.min(20, width / 5));

  const hangHole = parameters.hangHole ?? false;
  if (hangHole && width < HOLE_WIDTH + 2 * seal + 10) {
    fail(`width must be at least ${HOLE_WIDTH + 2 * seal + 10} mm to fit a hang hole.`);
  }

  // Without a hang hole, the tear notch sits between the top seal and the zipper.
  // With one, the top seal widens down to the zipper to hold the hole.
  const lowest = hangHole
    ? Math.max(seal + ZIPPER_HALF_BAND + 2, HOLE_HEIGHT + 6 + ZIPPER_HALF_BAND + 2)
    : seal + ZIPPER_HALF_BAND + 2 + NOTCH + 1;
  if (height / 3 < lowest) {
    fail(`height is too small for this seal and zipper. Use at least ${tidy(lowest * 3)} mm.`);
  }
  const zipper = parameters.zipper ?? Math.max(30, lowest);
  inRange("zipper distance", zipper, lowest, height / 3);

  const topSeal = hangHole ? zipper - ZIPPER_HALF_BAND - 2 : seal;
  const notchY = zipper - ZIPPER_HALF_BAND - 2 - NOTCH / 2;
  const corner = parameters.corner ?? 0;
  inRange("corner radius", corner, 0, Math.min(15, width / 6, notchY - NOTCH / 2 - 1));

  return { width, height, gusset, seal, topSeal, zipper, corner, notchY, hangHole };
}

/** Front panel with rounded top corners and a tear notch in each side seal. */
function frontOutline({ width: w, height: h, corner: r, notchY: y }: PouchInfo): Vec2[] {
  const points: Vec2[] = [];
  if (r > 0) points.push(...arc([r, r], r, 180, 270, 6), ...arc([w - r, r], r, 270, 360, 6));
  else points.push([0, 0], [w, 0]);
  points.push(
    [w, y - NOTCH / 2],
    [w - NOTCH, y],
    [w, y + NOTCH / 2],
    [w, h],
    [0, h],
    [0, y + NOTCH / 2],
    [NOTCH, y],
    [0, y - NOTCH / 2],
  );
  return points;
}

/** The back panel is the front reflected across the fold, so its art prints upside down. */
const mirror = (points: readonly Vec2[], axis: number): Vec2[] =>
  points.map(([x, y]) => [x, 2 * axis - y]);

function slot(cx: number, cy: number): Vec2[] {
  const r = HOLE_HEIGHT / 2;
  const half = HOLE_WIDTH / 2 - r;
  return [...arc([cx + half, cy], r, -90, 90, 8), ...arc([cx - half, cy], r, 90, 270, 8)];
}

function buildPouch(template: string, parameters: BoxParameters, standUp: boolean): DielineSpec {
  const info = resolvePouch(parameters, standUp);
  const { width: w, height: h, gusset: g, seal, topSeal, zipper } = info;
  const axis = h + g / 2;
  const front = frontOutline(info);

  const panels: PanelSpec[] = [{ id: "front", label: "Front", role: "wall", polygon: front }];
  if (standUp) {
    panels.push(
      { id: "gusset-front", label: "Gusset", role: "flap", parent: "front", polygon: rect(0, h, w, axis) },
      { id: "gusset-back", label: "Gusset", role: "flap", parent: "gusset-front", polygon: rect(0, axis, w, h + g) },
      { id: "back", label: "Back", role: "wall", parent: "gusset-back", polygon: mirror(front, axis) },
    );
  } else {
    panels.push({ id: "back", label: "Back", role: "wall", parent: "front", polygon: mirror(front, axis) });
  }

  const guides: Guide[] = [];
  const both = (kind: Guide["kind"], points: Vec2[], closed: boolean): void => {
    guides.push({ kind, points, closed }, { kind, points: mirror(points, axis), closed });
  };
  both("seal", rect(0, 0, seal, h), true);
  both("seal", rect(w - seal, 0, w, h), true);
  both("seal", rect(0, 0, w, topSeal), true);
  if (standUp) {
    // Side seals run through the gusset, with angled corner seals where it joins each panel.
    guides.push(
      { kind: "seal", points: rect(0, h, seal, h + g), closed: true },
      { kind: "seal", points: rect(w - seal, h, w, h + g), closed: true },
    );
    const k = Math.min(g * 0.6, w / 3);
    both("seal", [[0, h], [k, h], [0, axis]], true);
    both("seal", [[w, h], [w - k, h], [w, axis]], true);
  }
  both("zipper", [[0, zipper], [w, zipper]], false);

  const innerCuts = info.hangHole
    ? [slot(w / 2, topSeal / 2), mirror(slot(w / 2, topSeal / 2), axis)]
    : [];

  return { template, panels, foldedSize: [w, h, g], openFaces: 0, guides, innerCuts, pouch: info };
}

/** Pouches are not folded boxes, so they get production checks instead of a fold test. */
export function verifyPouch(dieline: Dieline): FoldVerification {
  const p = dieline.pouch;
  if (!p) throw new DielineError("INVALID_PANEL", "This dieline is not a pouch.");
  const open = p.width - 2 * p.seal;
  const clear = p.zipper - ZIPPER_HALF_BAND - p.topSeal;
  const notchGap = p.zipper - ZIPPER_HALF_BAND - (p.notchY + NOTCH / 2);
  const mm = (value: number): string => `${tidy(value)}`;

  const checks: FoldCheck[] = [
    {
      name: "size",
      passed: true,
      detail:
        `pouch ${mm(p.width)} × ${mm(p.height)} mm` +
        (p.gusset ? ` with a ${mm(p.gusset)} mm gusset` : "") +
        `, flat blank ${mm(dieline.bounds.width)} × ${mm(dieline.bounds.height)} mm`,
    },
    {
      name: "seals",
      passed: open >= p.width * 0.6,
      detail: `${mm(p.seal)} mm side seals leave ${mm(open)} mm open inside`,
    },
    {
      name: "zipper",
      passed: clear >= 2,
      detail: `zipper ${mm(p.zipper)} mm from the top, ${mm(clear)} mm clear of the top seal`,
    },
    {
      name: "tear notch",
      passed: notchGap >= 1.5,
      detail: `tear notches sit ${mm(notchGap)} mm above the zipper`,
    },
  ];
  if (p.gusset > 0) {
    checks.push({
      name: "gusset",
      passed: p.gusset <= p.height / 2,
      detail: `${mm(p.gusset)} mm gusset folds ${mm(p.gusset / 2)} mm into the pouch`,
    });
  }
  if (p.hangHole) {
    checks.push({
      name: "hang hole",
      passed: p.topSeal >= HOLE_HEIGHT + 6,
      detail: `${HOLE_WIDTH} × ${HOLE_HEIGHT} mm slot in a ${mm(p.topSeal)} mm top seal`,
    });
  }
  return { passed: checks.every((check) => check.passed), measuredSize: [p.height, p.width, p.gusset], checks };
}

export const zipPouch: Template = {
  id: "zip-pouch",
  name: "Flat zip pouch",
  description: "Three-side seal pouch with a zipper, folded at the bottom.",
  kind: "pouch",
  labels: { length: "Width", width: null, depth: "Height" },
  defaults: { length: 120, width: 0, depth: 180, thickness: 0.1, seal: 8, zipper: 30, corner: 4, hangHole: true },
  upright: "y",
  frontPanel: "front",
  frontRotation: 0,
  build: (parameters) => buildPouch("zip-pouch", parameters, false),
  verify: verifyPouch,
};

export const standUpPouch: Template = {
  id: "stand-up-pouch",
  name: "Stand-up zip pouch",
  description: "Doypack with a zipper and a bottom gusset so it stands on a shelf.",
  kind: "pouch",
  labels: { length: "Width", width: "Gusset", depth: "Height" },
  defaults: { length: 140, width: 80, depth: 220, thickness: 0.1, seal: 8, zipper: 35, corner: 5, hangHole: false },
  upright: "y",
  frontPanel: "front",
  frontRotation: 0,
  build: (parameters) => buildPouch("stand-up-pouch", parameters, true),
  verify: verifyPouch,
};
