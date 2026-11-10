import { rect } from "../geometry.js";
import type { DielineSpec, PanelSpec } from "../model.js";
import { resolveDimensions, sideFlap, tuckTab, type Template, CARTON_LABELS } from "./common.js";

const TAB_INSET_MM = 1;

function cornerTabs(wall: string, y0: number, y1: number, a: number, width: number): PanelSpec[] {
  const taper = width * 0.3;
  return [
    {
      id: `${wall}-tab-left`,
      label: "Glue",
      role: "flap",
      parent: wall,
      polygon: sideFlap(0, y0, y1, -1, width, TAB_INSET_MM, taper),
    },
    {
      id: `${wall}-tab-right`,
      label: "Glue",
      role: "flap",
      parent: wall,
      polygon: sideFlap(a, y0, y1, 1, width, TAB_INSET_MM, taper),
    },
  ];
}

export const tray: Template = {
  id: "tray",
  kind: "carton",
  labels: CARTON_LABELS,
  upright: "z",
  frontPanel: "south",
  frontRotation: 180,
  name: "Open tray",
  description: "Four-wall display tray with glued corners.",
  defaults: { length: 180, width: 120, depth: 40, thickness: 1 },
  build(parameters): DielineSpec {
    const { a, b, depth, thickness } = resolveDimensions(parameters, 15);
    const wall = depth + thickness / 2;
    const tabWidth = Math.min(25, b * 0.4);
    return {
      template: "tray",
      foldedSize: [a, b, wall],
      openFaces: 1,
      panels: [
        { id: "base", label: "Base", role: "wall", polygon: rect(0, 0, a, b) },
        { id: "north", label: "Wall", role: "wall", parent: "base", polygon: rect(0, -wall, a, 0) },
        { id: "south", label: "Wall", role: "wall", parent: "base", polygon: rect(0, b, a, b + wall) },
        { id: "west", label: "Wall", role: "wall", parent: "base", polygon: rect(-wall, 0, 0, b) },
        { id: "east", label: "Wall", role: "wall", parent: "base", polygon: rect(a, 0, a + wall, b) },
        ...cornerTabs("north", -wall, 0, a, tabWidth),
        ...cornerTabs("south", b, b + wall, a, tabWidth),
      ],
    };
  },
};

export const mailer: Template = {
  id: "mailer",
  kind: "carton",
  labels: CARTON_LABELS,
  upright: "z",
  frontPanel: "lid",
  frontRotation: 180,
  name: "Mailer box",
  description: "Self-closing shipping box with a hinged lid and front tuck.",
  defaults: { length: 220, width: 160, depth: 60, thickness: 1.5 },
  build(parameters): DielineSpec {
    const { a, b, d } = resolveDimensions(parameters, 20);
    const tabWidth = Math.min(25, b * 0.4);
    const tuckHeight = Math.min(30, d * 0.7);
    const earWidth = Math.min(40, d * 0.8);
    const lidTop = -d - b;
    return {
      template: "mailer",
      foldedSize: [a, b, d],
      openFaces: 0,
      panels: [
        { id: "base", label: "Base", role: "wall", polygon: rect(0, 0, a, b) },
        { id: "north", label: "Back", role: "wall", parent: "base", polygon: rect(0, -d, a, 0) },
        { id: "south", label: "Front", role: "wall", parent: "base", polygon: rect(0, b, a, b + d) },
        { id: "west", label: "Side", role: "wall", parent: "base", polygon: rect(-d, 0, 0, b) },
        { id: "east", label: "Side", role: "wall", parent: "base", polygon: rect(a, 0, a + d, b) },
        ...cornerTabs("north", -d, 0, a, tabWidth),
        ...cornerTabs("south", b, b + d, a, tabWidth),
        { id: "lid", label: "Lid", role: "wall", parent: "north", polygon: rect(0, lidTop, a, -d) },
        {
          id: "lid-tuck",
          label: "Tuck",
          role: "flap",
          parent: "lid",
          polygon: tuckTab(0, a, lidTop, -1, tuckHeight, 1, Math.min(8, tuckHeight * 0.5)),
        },
        {
          id: "lid-ear-left",
          label: "Ear",
          role: "flap",
          parent: "lid",
          polygon: sideFlap(0, lidTop, -d, -1, earWidth, TAB_INSET_MM, earWidth * 0.3),
        },
        {
          id: "lid-ear-right",
          label: "Ear",
          role: "flap",
          parent: "lid",
          polygon: sideFlap(a, lidTop, -d, 1, earWidth, TAB_INSET_MM, earWidth * 0.3),
        },
      ],
    };
  },
};
