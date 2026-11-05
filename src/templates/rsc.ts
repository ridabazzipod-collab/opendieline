import { rect } from "../geometry.js";
import { DielineError, type PanelSpec } from "../model.js";
import { resolveDimensions, sideFlap, type Template } from "./common.js";

export const regularSlottedCarton: Template = {
  id: "regular-slotted-carton",
  name: "Regular slotted carton",
  description: "Standard corrugated shipper (FEFCO 0201 style) with flaps that meet in the middle.",
  defaults: { length: 300, width: 200, depth: 200, thickness: 3 },
  build(parameters) {
    const { a, b, d, length, width, thickness } = resolveDimensions(parameters, 30);
    if (width > length) {
      throw new DielineError(
        "INVALID_PARAMETER",
        `length (${length}) must be at least width (${width}) so the major flaps can meet.`,
      );
    }
    const slot = Math.max(2, thickness * 2);
    if (a < slot * 12) {
      throw new DielineError("INVALID_PARAMETER", `length is too small for ${thickness} mm board.`);
    }

    const flap = b / 2;
    const end = 2 * a + 2 * b;
    const glue = Math.min(35, b * 0.4);
    const columns = [
      { id: "front", label: "Front", x0: 0, x1: a, parent: "right", major: true },
      { id: "right", label: "Side", x0: a, x1: a + b, parent: "back", major: false },
      { id: "back", label: "Back", x0: a + b, x1: 2 * a + b, major: true },
      { id: "left", label: "Side", x0: 2 * a + b, x1: end, parent: "back", major: false },
    ] as const;

    const panels: PanelSpec[] = [];
    for (const column of columns) {
      const { id, label, x0, x1, major } = column;
      const parent = "parent" in column ? { parent: column.parent } : {};
      panels.push({ id, label, role: "wall", ...parent, polygon: rect(x0, 0, x1, d) });
      const role = major ? "wall" : "flap";
      const flapLabel = major ? "Major flap" : "Minor flap";
      panels.push(
        {
          id: `${id}-top-flap`,
          label: flapLabel,
          role,
          parent: id,
          polygon: rect(x0 + slot / 2, -flap, x1 - slot / 2, 0),
        },
        {
          id: `${id}-bottom-flap`,
          label: flapLabel,
          role,
          parent: id,
          polygon: rect(x0 + slot / 2, d, x1 - slot / 2, d + flap),
        },
      );
    }
    panels.push({
      id: "glue",
      label: "Glue",
      role: "flap",
      parent: "left",
      polygon: sideFlap(end, 0, d, 1, glue, 2, glue * 0.3),
    });

    return { template: "regular-slotted-carton", foldedSize: [a, b, d], openFaces: 0, panels };
  },
};
