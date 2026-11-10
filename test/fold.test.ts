import { describe, expect, it } from "vitest";
import { compile, foldPanels, generate, verifyFold } from "../src/index.js";
import type { DielineSpec } from "../src/index.js";
import { rect } from "../src/geometry.js";

describe("foldPanels", () => {
  it("leaves the blank flat at progress 0", () => {
    const { dieline } = generate("reverse-tuck-end", { length: 80, width: 40, depth: 120, thickness: 0.5 });
    for (const panel of foldPanels(dieline, 0)) {
      for (const point of panel.points) expect(Math.abs(point[2])).toBeLessThan(1e-9);
    }
  });

  it("keeps every panel rigid at any fold stage", () => {
    const { dieline } = generate("mailer", { length: 220, width: 160, depth: 60, thickness: 1.5 });
    const length = (p: readonly number[], q: readonly number[]): number =>
      Math.hypot(p[0]! - q[0]!, p[1]! - q[1]!, p[2]! - q[2]!);
    const flat = foldPanels(dieline, 0);
    for (const progress of [0.2, 0.6, 1]) {
      foldPanels(dieline, progress).forEach((panel, i) => {
        const [p0, p1] = panel.points;
        const [q0, q1] = flat[i]!.points;
        expect(length(p0!, p1!)).toBeCloseTo(length(q0!, q1!), 6);
      });
    }
  });

  it("folds every panel away from the printed side, towards +z", () => {
    const { dieline } = generate("tray", { length: 180, width: 120, depth: 40, thickness: 1 });
    const zs = foldPanels(dieline, 1).flatMap((panel) => panel.points.map((p) => p[2]));
    expect(Math.min(...zs)).toBeGreaterThan(-1e-6);
  });
});

describe("verifyFold", () => {
  const params = { length: 80, width: 40, depth: 120, thickness: 0.5 };

  it("measures inside size plus one board thickness", () => {
    const { verification } = generate("straight-tuck-end", params);
    expect(verification.measuredSize[0]).toBeCloseTo(120.5, 6);
    expect(verification.measuredSize[1]).toBeCloseTo(80.5, 6);
    expect(verification.measuredSize[2]).toBeCloseTo(40.5, 6);
  });

  const cube: DielineSpec = {
    template: "broken",
    foldedSize: [10, 10, 10],
    openFaces: 0,
    panels: [
      { id: "root", role: "wall", polygon: rect(0, 0, 10, 10) },
      { id: "a", role: "wall", parent: "root", polygon: rect(10, 0, 20, 10) },
    ],
  };

  it("fails a blank that does not close", () => {
    const result = verifyFold(compile(cube));
    expect(result.passed).toBe(false);
    expect(result.checks.find((check) => check.name === "closure")?.passed).toBe(false);
  });

  it("fails a flap that folds outside the box", () => {
    const spec: DielineSpec = {
      template: "broken",
      foldedSize: [10, 10, 0],
      openFaces: 5,
      panels: [
        { id: "root", role: "wall", polygon: rect(0, 0, 10, 10) },
        { id: "flap", role: "flap", parent: "root", polygon: rect(10, 0, 15, 10) },
      ],
    };
    const result = verifyFold(compile(spec));
    expect(result.checks.find((check) => check.name === "containment")?.passed).toBe(false);
  });

  it("fails a blank with the wrong size", () => {
    const { dieline } = generate("sleeve", params);
    const result = verifyFold({ ...dieline, foldedSize: [999, 999, 999] });
    expect(result.checks.find((check) => check.name === "size")?.passed).toBe(false);
  });

  it("detects a wall folded to the wrong angle", () => {
    const { dieline } = generate("sleeve", params);
    const bent = {
      ...dieline,
      panels: dieline.panels.map((panel) =>
        panel.id === "left" && panel.hinge
          ? { ...panel, hinge: { ...panel.hinge, angle: panel.hinge.angle / 2 } }
          : panel,
      ),
    };
    expect(verifyFold(bent).passed).toBe(false);
  });
});
