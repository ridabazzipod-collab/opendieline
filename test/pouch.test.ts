import { describe, expect, it } from "vitest";
import { compile, DielineError, generate, getTemplate, measure, toDxf, toPdf, toSvg, verifyPouch } from "../src/index.js";
import type { BoxParameters } from "../src/index.js";
import { rect } from "../src/geometry.js";

const flat = getTemplate("zip-pouch").defaults;
const standing = getTemplate("stand-up-pouch").defaults;

function code(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(DielineError);
    return (error as DielineError).code;
  }
  return undefined;
}

describe("flat zip pouch", () => {
  const { dieline, verification } = generate("zip-pouch", flat);

  it("passes its production checks", () => {
    expect(verification.passed).toBe(true);
    expect(verification.checks.map((check) => check.name)).toContain("hang hole");
  });

  it("lays the back below the front, joined by one bottom fold", () => {
    expect(dieline.panels.map((panel) => panel.id)).toEqual(["front", "back"]);
    expect(dieline.creases).toHaveLength(1);
    expect(dieline.bounds.width).toBeCloseTo(120, 6);
    expect(dieline.bounds.height).toBeCloseTo(360, 6);
  });

  it("cuts four tear notches into the outline", () => {
    const notchTips = dieline.cut.filter(([x]) => Math.abs(x - 3) < 1e-6 || Math.abs(x - 117) < 1e-6);
    expect(notchTips).toHaveLength(4);
  });

  it("punches the hang hole through both panels", () => {
    expect(dieline.innerCuts).toHaveLength(2);
    expect(generate("zip-pouch", { ...flat, hangHole: false }).dieline.innerCuts).toHaveLength(0);
  });

  it("marks seals and two zipper lines", () => {
    expect(dieline.guides.filter((guide) => guide.kind === "zipper")).toHaveLength(2);
    expect(dieline.guides.filter((guide) => guide.kind === "seal").length).toBeGreaterThanOrEqual(6);
  });

  it("subtracts the hang holes from the board area", () => {
    const withHole = measure(dieline).boardArea;
    const without = measure(generate("zip-pouch", { ...flat, hangHole: false }).dieline).boardArea;
    expect(without - withHole).toBeGreaterThan(200);
  });

  it("works with square corners", () => {
    expect(generate("zip-pouch", { ...flat, corner: 0 }).verification.passed).toBe(true);
  });
});

describe("stand-up zip pouch", () => {
  const { dieline, verification } = generate("stand-up-pouch", standing);

  it("passes its production checks", () => {
    expect(verification.passed).toBe(true);
    expect(verification.measuredSize).toEqual([220, 140, 80]);
  });

  it("puts the gusset between front and back", () => {
    expect(dieline.panels.map((panel) => panel.id)).toEqual(["front", "gusset-front", "gusset-back", "back"]);
    expect(dieline.creases).toHaveLength(3);
    expect(dieline.bounds.height).toBeCloseTo(2 * 220 + 80, 6);
  });

  it.each([0.5, 0.75, 1, 1.5, 2.5])("still builds at %s× size", (scale) => {
    const parameters: BoxParameters = {
      ...standing,
      length: standing.length * scale,
      width: standing.width * scale,
      depth: standing.depth * scale,
    };
    expect(generate("stand-up-pouch", parameters).verification.passed).toBe(true);
  });
});

describe("pouch limits", () => {
  it.each<[string, string, BoxParameters]>([
    ["a gusset deeper than half the height", "stand-up-pouch", { ...standing, width: 130 }],
    ["a tiny gusset", "stand-up-pouch", { ...standing, width: 5 }],
    ["a zipper inside the top seal", "stand-up-pouch", { ...standing, zipper: 10 }],
    ["a zipper too far down", "stand-up-pouch", { ...standing, zipper: 120 }],
    ["seals that are too wide", "zip-pouch", { ...flat, seal: 30 }],
    ["a corner larger than the notch allows", "zip-pouch", { ...flat, corner: 40 }],
    ["a hang hole on a narrow pouch", "zip-pouch", { ...flat, length: 45 }],
    ["a height too small for the zipper", "zip-pouch", { ...flat, depth: 60, hangHole: true }],
    ["a missing size", "zip-pouch", { ...flat, length: Number.NaN }],
  ])("rejects %s", (_name, id, parameters) => {
    expect(code(() => generate(id, parameters))).toBe("INVALID_PARAMETER");
  });

  it("rejects an inner cut outside the blank", () => {
    const spec = {
      template: "test",
      foldedSize: [10, 10, 0] as const,
      openFaces: 0,
      panels: [{ id: "root", role: "wall" as const, polygon: rect(0, 0, 10, 10) }],
      innerCuts: [rect(20, 20, 22, 22)],
    };
    expect(code(() => compile(spec))).toBe("INVALID_PANEL");
  });

  it("only verifies pouches", () => {
    const carton = generate("sleeve", getTemplate("sleeve").defaults).dieline;
    expect(code(() => verifyPouch(carton))).toBe("INVALID_PANEL");
  });
});

describe("pouch exports", () => {
  const { dieline } = generate("zip-pouch", flat);

  it("adds seal and zipper layers to the SVG and cuts holes from the board", () => {
    const svg = toSvg(dieline);
    expect(svg).toContain('id="seal"');
    expect(svg).toContain('id="zipper"');
    expect(svg).toContain('fill-rule="evenodd"');
    expect(svg).not.toContain("NaN");
  });

  it("puts holes on the DXF cut layer and guides on their own layers", () => {
    const dxf = toDxf(dieline);
    const holeEdges = dieline.innerCuts.reduce((sum, hole) => sum + hole.length, 0);
    expect(dxf.match(/\nLINE\n8\nCUT\n/g)).toHaveLength(dieline.cut.length + holeEdges);
    expect(dxf).toContain("\nLINE\n8\nSEAL\n");
    expect(dxf.match(/\nLINE\n8\nZIPPER\n/g)).toHaveLength(2);
  });

  it("writes a valid PDF with seal and zipper spot colours", () => {
    const text = new TextDecoder().decode(toPdf(dieline));
    expect(text).toContain("/Separation /Seal");
    expect(text).toContain("/Separation /Zipper");
    const start = Number(/startxref\n(\d+)/.exec(text)![1]);
    expect(text.slice(start, start + 4)).toBe("xref");
    const declared = Number(/\/Length (\d+)/.exec(text)![1]);
    expect(/stream\n([\s\S]*?)\nendstream/.exec(text)![1]!.length).toBe(declared);
  });
});
