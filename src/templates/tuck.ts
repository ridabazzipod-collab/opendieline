import { rect } from "../geometry.js";
import type { DielineSpec, PanelSpec } from "../model.js";
import { endFlap, resolveDimensions, sideFlap, tuckTab, type BoxParameters, type Template } from "./common.js";

const RELIEF_MM = 0.5;

function tuckBox(template: string, parameters: BoxParameters, reverse: boolean): DielineSpec {
  const { a, b, d } = resolveDimensions(parameters, 20);

  const front = 0;
  const right = a;
  const back = a + b;
  const left = 2 * a + b;
  const end = 2 * a + 2 * b;

  const glue = Math.min(15, b * 0.6);
  const tabHeight = Math.min(15, b * 0.6, d * 0.5);
  const tabRadius = Math.min(5, tabHeight * 0.6);
  const dustHeight = a * 0.45;
  const dustTaper = Math.min(dustHeight * 0.3, b * 0.2);

  const panels: PanelSpec[] = [
    { id: "back", label: "Back", role: "wall", polygon: rect(back, 0, left, d) },
    { id: "right", label: "Side", role: "wall", parent: "back", polygon: rect(right, 0, back, d) },
    { id: "front", label: "Front", role: "wall", parent: "right", polygon: rect(front, 0, right, d) },
    { id: "left", label: "Side", role: "wall", parent: "back", polygon: rect(left, 0, end, d) },
    {
      id: "glue",
      label: "Glue",
      role: "flap",
      parent: "left",
      polygon: sideFlap(end, 0, d, 1, glue, 1, glue * 0.35),
    },
    { id: "top-lid", label: "Top", role: "wall", parent: "back", polygon: rect(back, -b, left, 0) },
    {
      id: "top-tab",
      label: "Tuck",
      role: "flap",
      parent: "top-lid",
      polygon: tuckTab(back, left, -b, -1, tabHeight, 1, tabRadius),
    },
  ];

  const bottomX0 = reverse ? front : back;
  const bottomX1 = reverse ? right : left;
  panels.push(
    {
      id: "bottom-lid",
      label: "Bottom",
      role: "wall",
      parent: reverse ? "front" : "back",
      polygon: rect(bottomX0, d, bottomX1, d + b),
    },
    {
      id: "bottom-tab",
      label: "Tuck",
      role: "flap",
      parent: "bottom-lid",
      polygon: tuckTab(bottomX0, bottomX1, d + b, 1, tabHeight, 1, tabRadius),
    },
  );

  for (const [id, x0, x1] of [
    ["right", right, back],
    ["left", left, end],
  ] as const) {
    panels.push(
      {
        id: `${id}-top-dust`,
        label: "Dust",
        role: "flap",
        parent: id,
        polygon: endFlap(x0, x1, 0, -1, dustHeight, RELIEF_MM, dustTaper),
      },
      {
        id: `${id}-bottom-dust`,
        label: "Dust",
        role: "flap",
        parent: id,
        polygon: endFlap(x0, x1, d, 1, dustHeight, RELIEF_MM, dustTaper),
      },
    );
  }

  return { template, panels, foldedSize: [a, b, d], openFaces: 0 };
}

export const straightTuckEnd: Template = {
  id: "straight-tuck-end",
  name: "Straight tuck end",
  description: "Retail carton with both lids on the back panel, for a clean front face.",
  defaults: { length: 80, width: 40, depth: 120, thickness: 0.5 },
  build: (parameters) => tuckBox("straight-tuck-end", parameters, false),
};

export const reverseTuckEnd: Template = {
  id: "reverse-tuck-end",
  name: "Reverse tuck end",
  description: "Common folding carton with lids on opposite panels, which nests well on the sheet.",
  defaults: { length: 80, width: 40, depth: 120, thickness: 0.5 },
  build: (parameters) => tuckBox("reverse-tuck-end", parameters, true),
};
