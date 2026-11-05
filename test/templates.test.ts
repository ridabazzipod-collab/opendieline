import { describe, expect, it } from "vitest";
import { generate, measure, templates, toSvg } from "../src/index.js";

const SWEEP = [0.5, 0.75, 1, 1.5, 2.5];

describe.each(templates.map((template) => [template.id, template] as const))("%s", (id, template) => {
  it("compiles and folds at its default size", () => {
    const { verification } = generate(id, template.defaults);
    expect(verification.checks.filter((check) => !check.passed)).toEqual([]);
  });

  it("makes one continuous cut path", () => {
    const { dieline } = generate(id, template.defaults);
    expect(dieline.cut.length).toBeGreaterThan(3);
    expect(dieline.creases).toHaveLength(dieline.panels.length - 1);
  });

  it.each(SWEEP)("still folds at %s× size", (scale) => {
    const { defaults } = template;
    const { verification } = generate(id, {
      ...defaults,
      length: defaults.length * scale,
      width: defaults.width * scale,
      depth: defaults.depth * scale,
    });
    expect(verification.checks.filter((check) => !check.passed)).toEqual([]);
  });

  it("adds board thickness to every crease-to-crease size", () => {
    const { defaults } = template;
    const thin = generate(id, { ...defaults, thickness: 0 }).dieline;
    const thick = generate(id, { ...defaults, thickness: 2 }).dieline;
    expect(measure(thick).boardArea).toBeGreaterThan(measure(thin).boardArea);
  });

  it("never produces NaN in exported geometry", () => {
    expect(toSvg(generate(id, template.defaults).dieline)).not.toContain("NaN");
  });
});

describe("exhaustive proportions", () => {
  const sizes = [40, 75, 130, 260];
  for (const template of templates) {
    it(`${template.id} folds across box proportions`, () => {
      for (const length of sizes) {
        for (const width of sizes) {
          for (const depth of sizes) {
            const carton = template.id === "regular-slotted-carton";
            if (carton && width > length) continue;
            const thickness = carton ? 1 : template.defaults.thickness;
            const parameters = { length, width, depth, thickness };
            const { verification } = generate(template.id, parameters);
            expect(
              verification.checks.filter((check) => !check.passed),
              JSON.stringify(parameters),
            ).toEqual([]);
          }
        }
      }
    });
  }
});
