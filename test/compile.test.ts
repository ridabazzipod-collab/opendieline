import { describe, expect, it } from "vitest";
import { compile, DielineError, generate, getTemplate } from "../src/index.js";
import type { DielineErrorCode, DielineSpec, PanelSpec } from "../src/index.js";
import { rect } from "../src/geometry.js";

function spec(panels: PanelSpec[]): DielineSpec {
  return { template: "test", panels, foldedSize: [10, 10, 10], openFaces: 0 };
}

function expectCode(run: () => unknown, code: DielineErrorCode): void {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(DielineError);
    expect((error as DielineError).code).toBe(code);
    return;
  }
  throw new Error(`Expected ${code}`);
}

const root: PanelSpec = { id: "root", role: "wall", polygon: rect(0, 0, 10, 10) };

describe("compile", () => {
  it("derives a crease from a shared edge and cuts from everything else", () => {
    const dieline = compile(
      spec([root, { id: "b", role: "wall", parent: "root", polygon: rect(10, 0, 20, 10) }]),
    );
    expect(dieline.creases).toHaveLength(1);
    expect(dieline.cut).toHaveLength(4);
  });

  it("handles a child narrower than its parent edge", () => {
    const dieline = compile(
      spec([root, { id: "b", role: "flap", parent: "root", polygon: rect(10, 2, 15, 8) }]),
    );
    expect(dieline.creases[0]).toMatchObject({ panels: ["root", "b"] });
    expect(dieline.cut).toHaveLength(8);
  });

  it("rejects two root panels", () => {
    expectCode(
      () => compile(spec([root, { id: "b", role: "wall", polygon: rect(10, 0, 20, 10) }])),
      "INVALID_HIERARCHY",
    );
  });

  it("rejects a parent cycle", () => {
    expectCode(
      () =>
        compile(
          spec([
            root,
            { id: "b", role: "wall", parent: "c", polygon: rect(10, 0, 20, 10) },
            { id: "c", role: "wall", parent: "b", polygon: rect(20, 0, 30, 10) },
          ]),
        ),
      "INVALID_HIERARCHY",
    );
  });

  it("rejects an unknown parent", () => {
    expectCode(
      () => compile(spec([root, { id: "b", role: "wall", parent: "nope", polygon: rect(10, 0, 20, 10) }])),
      "INVALID_HIERARCHY",
    );
  });

  it("rejects duplicate ids", () => {
    expectCode(
      () => compile(spec([root, { ...root, parent: "root", polygon: rect(10, 0, 20, 10) }])),
      "INVALID_PANEL",
    );
  });

  it("rejects a zero-area panel", () => {
    expectCode(
      () => compile(spec([root, { id: "b", role: "wall", parent: "root", polygon: rect(10, 0, 10, 10) }])),
      "INVALID_PANEL",
    );
  });

  it("rejects a panel that does not touch its parent", () => {
    expectCode(
      () => compile(spec([root, { id: "b", role: "wall", parent: "root", polygon: rect(30, 0, 40, 10) }])),
      "MISSING_HINGE",
    );
  });

  it("rejects panels that touch without a hinge", () => {
    expectCode(
      () =>
        compile(
          spec([
            root,
            { id: "b", role: "wall", parent: "root", polygon: rect(10, 0, 20, 10) },
            { id: "c", role: "wall", parent: "b", polygon: rect(20, 0, 30, 10) },
            { id: "d", role: "wall", parent: "root", polygon: rect(0, 10, 10, 20) },
            { id: "e", role: "wall", parent: "c", polygon: rect(20, 10, 30, 20) },
            { id: "f", role: "wall", parent: "d", polygon: rect(10, 10, 20, 20) },
          ]),
        ),
      "MISSING_HINGE",
    );
  });

  it("rejects panels that overlap", () => {
    expectCode(
      () =>
        compile(
          spec([
            root,
            { id: "b", role: "wall", parent: "root", polygon: rect(10, 0, 20, 10) },
            { id: "c", role: "wall", parent: "b", polygon: rect(10, 10, 20, 20) },
            { id: "d", role: "wall", parent: "c", polygon: rect(2, 12, 10, 20) },
            { id: "e", role: "flap", parent: "d", polygon: rect(3, 5, 9, 12) },
          ]),
        ),
      "SELF_INTERSECTION",
    );
  });

  it("rejects corners that touch at a single point", () => {
    expectCode(
      () =>
        compile(
          spec([
            root,
            { id: "b", role: "wall", parent: "root", polygon: rect(10, 0, 20, 10) },
            { id: "c", role: "wall", parent: "b", polygon: rect(10, -10, 20, 0) },
            {
              id: "d",
              role: "flap",
              parent: "c",
              polygon: [
                [10, -10],
                [10, -2],
                [0, 0],
              ],
            },
          ]),
        ),
      "OPEN_OUTLINE",
    );
  });
});

describe("parameters", () => {
  const box = getTemplate("reverse-tuck-end").defaults;

  it.each([
    ["negative length", { ...box, length: -5 }],
    ["zero depth", { ...box, depth: 0 }],
    ["NaN width", { ...box, width: Number.NaN }],
    ["infinite length", { ...box, length: Number.POSITIVE_INFINITY }],
    ["oversized length", { ...box, length: 50000 }],
    ["negative thickness", { ...box, thickness: -1 }],
    ["huge thickness", { ...box, thickness: 100 }],
  ])("rejects %s", (_name, parameters) => {
    expectCode(() => generate("reverse-tuck-end", parameters), "INVALID_PARAMETER");
  });

  it("rejects an unknown template", () => {
    expectCode(() => generate("nope", box), "UNKNOWN_TEMPLATE");
  });

  it("requires length ≥ width on a slotted carton", () => {
    expectCode(
      () => generate("regular-slotted-carton", { length: 100, width: 200, depth: 100, thickness: 3 }),
      "INVALID_PARAMETER",
    );
  });

  it("rejects a slotted carton too small for its board", () => {
    expectCode(
      () => generate("regular-slotted-carton", { length: 30, width: 30, depth: 30, thickness: 5 }),
      "INVALID_PARAMETER",
    );
  });
});
