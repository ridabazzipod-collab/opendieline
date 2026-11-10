import { rect } from "../geometry.js";
import { resolveDimensions, sideFlap, type Template, CARTON_LABELS } from "./common.js";

export const sleeve: Template = {
  id: "sleeve",
  kind: "carton",
  labels: CARTON_LABELS,
  upright: "y",
  frontPanel: "front",
  frontRotation: 0,
  name: "Sleeve",
  description: "Open-ended wrap that slides over a tray or product.",
  defaults: { length: 120, width: 80, depth: 160, thickness: 0.5 },
  build(parameters) {
    const { a, b, depth: height } = resolveDimensions(parameters, 10);
    const glue = Math.min(15, b * 0.6);
    const end = 2 * a + 2 * b;
    return {
      template: "sleeve",
      foldedSize: [a, b, height],
      openFaces: 2,
      panels: [
        { id: "back", label: "Back", role: "wall", polygon: rect(a + b, 0, 2 * a + b, height) },
        { id: "right", label: "Side", role: "wall", parent: "back", polygon: rect(a, 0, a + b, height) },
        { id: "front", label: "Front", role: "wall", parent: "right", polygon: rect(0, 0, a, height) },
        { id: "left", label: "Side", role: "wall", parent: "back", polygon: rect(2 * a + b, 0, end, height) },
        {
          id: "glue",
          label: "Glue",
          role: "flap",
          parent: "left",
          polygon: sideFlap(end, 0, height, 1, glue, 1, glue * 0.35),
        },
      ],
    };
  },
};
