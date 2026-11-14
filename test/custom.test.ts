import { describe, expect, it } from "vitest";
import { compile, customCartonTemplate, findCarton, foldPanels, generate, layoutFromPixels, verifyFold } from "../src/index.js";
import type { PixelLayout } from "../src/index.js";

/** Draws a carton outline like a finished dieline: lid, wall row, dust flaps, bottom flaps, glue. */
function picture(w: number, h: number, ring: boolean): Uint8Array {
  const alpha = new Uint8Array(w * h);
  const box = (x0: number, y0: number, x1: number, y1: number): void => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) alpha[y * w + x] = 255;
  };
  box(40, 300, 1040, 600); // walls row, 4 panels
  box(20, 330, 40, 570); // glue
  box(40, 100, 340, 300); // lid on panel 1
  box(340, 220, 540, 300); // dust flap on panel 2
  box(840, 220, 1040, 300); // dust flap on panel 4
  box(40, 600, 340, 700); // bottom flaps
  box(540, 600, 840, 740);
  box(340, 600, 540, 700);
  box(840, 600, 1040, 700);
  // Notches between bottom flaps so the wall row's bottom edge shows.
  for (const x of [340, 540, 840]) for (let y = 610; y < 700; y++) for (let dx = -2; dx < 2; dx++) alpha[y * w + x + dx] = 0;
  if (ring) {
    for (let x = 0; x < w; x++) for (const y of [10, h - 10]) alpha[y * w + x] = 255;
    for (let y = 10; y < h - 10; y++) for (const x of [10, w - 10]) alpha[y * w + x] = 255;
  }
  return alpha;
}

const layout: PixelLayout = {
  breaks: [40, 340, 540, 840, 1040],
  glueLeft: 20,
  rowTop: 300,
  rowBottom: 600,
  top: 100,
  lidPanel: 0,
  guessed: false,
};

describe("custom carton", () => {
  it("folds into a closed box", () => {
    const { verification } = generate(customCartonTemplate(layoutFromPixels(layout)), { length: 90, width: 60, depth: 80, thickness: 0 });
    expect(verification.checks.filter((check) => !check.passed)).toEqual([]);
  });

  it("keeps the panel sizes measured from the picture", () => {
    const template = customCartonTemplate(layoutFromPixels(layout));
    const dieline = compile(template.build({ length: 100, width: 60, depth: 80, thickness: 0 }));
    const front = dieline.panels.find((panel) => panel.id === "front")!;
    const xs = front.polygon.map((p) => p[0]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(100, 6);
    const side = dieline.panels.find((panel) => panel.id === "side-1")!;
    const sideXs = side.polygon.map((p) => p[0]);
    expect(Math.max(...sideXs) - Math.min(...sideXs)).toBeCloseTo((200 / 300) * 100, 6);
  });

  it("works with the lid on any panel", () => {
    for (const lidPanel of [0, 1, 2, 3] as const) {
      const { dieline } = generate(customCartonTemplate(layoutFromPixels({ ...layout, lidPanel })), {
        length: 90,
        width: 60,
        depth: 80,
        thickness: 0,
      });
      expect(dieline.panels.find((panel) => panel.id === "back")).toBeDefined();
      expect(foldPanels(dieline, 1).length).toBe(dieline.panels.length);
    }
  });

  it("works without a glue flap", () => {
    const { dieline } = generate(customCartonTemplate(layoutFromPixels({ ...layout, glueLeft: 40 })), {
      length: 90,
      width: 60,
      depth: 80,
      thickness: 0,
    });
    expect(dieline.panels.some((panel) => panel.id === "glue")).toBe(false);
    expect(verifyFold(dieline).measuredSize).toBeDefined();
  });

  it("rejects sizes that are not usable", () => {
    expect(() => customCartonTemplate({ ...layoutFromPixels(layout), height: 0 })).toThrow(/not usable/);
  });

  it("reports panels that are far from matching", () => {
    const skewed = layoutFromPixels({ ...layout, breaks: [40, 340, 540, 740, 1040] });
    const { verification } = generate(customCartonTemplate(skewed), { length: 90, width: 60, depth: 80, thickness: 0 });
    expect(verification.checks.some((check) => check.name.startsWith("panels") && !check.passed)).toBe(true);
  });
});

describe("findCarton", () => {
  it.each([false, true])("reads the panels from an outline (sticker ring %s)", (ring) => {
    const found = findCarton(picture(1100, 760, ring), 1100, 760)!;
    expect(found.guessed).toBe(false);
    expect(found.lidPanel).toBe(0);
    [40, 340, 540, 840, 1040].forEach((expected, i) => expect(Math.abs(found.breaks[i]! - expected)).toBeLessThan(6));
    expect(Math.abs(found.rowTop - 300)).toBeLessThan(6);
    expect(Math.abs(found.rowBottom - 600)).toBeLessThan(14);
    expect(Math.abs(found.top - 100)).toBeLessThan(6);
    expect(found.glueLeft).toBeLessThan(found.breaks[0]);
  });

  it("returns nothing for an empty picture", () => {
    expect(findCarton(new Uint8Array(100 * 100), 100, 100)).toBeNull();
  });

  it("guesses when the outline shows no panel edges", () => {
    const alpha = new Uint8Array(800 * 400);
    for (let y = 50; y < 350; y++) for (let x = 20; x < 780; x++) alpha[y * 800 + x] = 255;
    const found = findCarton(alpha, 800, 400)!;
    expect(found.guessed).toBe(true);
    expect(found.breaks).toHaveLength(5);
  });
});
