import { describe, expect, it } from "vitest";
import { generate, impose, measure, templates, toDxf, toPdf, toSvg } from "../src/index.js";

const params = { length: 80, width: 40, depth: 120, thickness: 0.5 };
const { dieline } = generate("reverse-tuck-end", params);

describe("toSvg", () => {
  it("has separate cut and crease layers", () => {
    const svg = toSvg(dieline);
    expect(svg).toContain('id="cut"');
    expect(svg).toContain('id="crease"');
    expect(svg.match(/<line /g)).toHaveLength(dieline.creases.length);
  });

  it("is sized in real millimetres", () => {
    const svg = toSvg(dieline, { bleed: 0, margin: 0 });
    expect(svg).toContain(`width="${Math.round(dieline.bounds.width * 1000) / 1000}mm"`);
  });

  it("omits the bleed layer when bleed is zero", () => {
    expect(toSvg(dieline, { bleed: 0 })).not.toContain('id="bleed"');
  });

  it("omits labels on request", () => {
    expect(toSvg(dieline, { labels: false })).not.toContain('id="labels"');
  });

  it("escapes label text", () => {
    const hostile = {
      ...dieline,
      panels: dieline.panels.map((panel) => ({ ...panel, label: `<script>"&` })),
    };
    const svg = toSvg(hostile);
    expect(svg).not.toContain("<script>");
    expect(svg).toContain("&lt;script&gt;");
  });
});

describe("toPdf", () => {
  const text = new TextDecoder().decode(toPdf(dieline));

  it("has a correct cross-reference table", () => {
    const startxref = Number(/startxref\n(\d+)/.exec(text)![1]);
    expect(text.slice(startxref, startxref + 4)).toBe("xref");
    const offsets = [...text.matchAll(/^(\d{10}) 00000 n $/gm)].map((match) => Number(match[1]));
    expect(offsets.length).toBeGreaterThan(0);
    offsets.forEach((offset, i) => {
      expect(text.slice(offset).startsWith(`${i + 1} 0 obj`)).toBe(true);
    });
  });

  it("declares a stream length that matches", () => {
    const declared = Number(/\/Length (\d+)/.exec(text)![1]);
    const stream = /stream\n([\s\S]*?)\nendstream/.exec(text)![1]!;
    expect(stream.length).toBe(declared);
  });

  it("uses spot colours for cut and crease", () => {
    expect(text).toContain("/Separation /CutContour");
    expect(text).toContain("/Separation /Crease");
  });

  it("is full scale", () => {
    const pad = 13;
    const expected = ((dieline.bounds.width + 2 * pad) * 72) / 25.4;
    const width = Number(/MediaBox \[0 0 ([\d.]+)/.exec(text)![1]);
    expect(width).toBeCloseTo(expected, 2);
  });
});

describe("toDxf", () => {
  const dxf = toDxf(dieline);

  it("writes each cut segment and crease as a line on the right layer", () => {
    expect(dxf.match(/\nLINE\n8\nCUT\n/g)).toHaveLength(dieline.cut.length);
    expect(dxf.match(/\nLINE\n8\nCREASE\n/g)).toHaveLength(dieline.creases.length);
  });

  it("ends with an EOF marker", () => {
    expect(dxf.trimEnd().endsWith("EOF")).toBe(true);
  });
});

describe("metrics", () => {
  it("measures a known rectangle-based blank", () => {
    const sleeve = generate("sleeve", { length: 100, width: 50, depth: 200, thickness: 0 });
    const metrics = measure(sleeve.dieline, 300);
    const walls = 2 * (100 + 50) * 200;
    expect(metrics.boardArea).toBeGreaterThan(walls);
    expect(metrics.blankHeight).toBeCloseTo(200, 6);
    expect(metrics.weightGrams).toBeCloseTo((metrics.boardArea / 1e6) * 300, 6);
    expect(metrics.rectangleUse).toBeLessThanOrEqual(1);
  });

  it("every template uses a sensible share of its rectangle", () => {
    for (const template of templates) {
      const { rectangleUse } = measure(generate(template.id, template.defaults).dieline);
      expect(rectangleUse).toBeGreaterThan(0.3);
    }
  });

  it("counts blanks on a sheet and tries both orientations", () => {
    const { bounds } = dieline;
    const fit = impose(dieline, { sheetWidth: 2000, sheetHeight: 2000, gutter: 0, margin: 0 });
    expect(fit.count).toBe(fit.columns * fit.rows);
    expect(fit.count).toBeGreaterThanOrEqual(
      Math.floor(2000 / bounds.width) * Math.floor(2000 / bounds.height),
    );
  });

  it("returns zero when a blank does not fit", () => {
    expect(impose(dieline, { sheetWidth: 10, sheetHeight: 10 }).count).toBe(0);
  });
});
