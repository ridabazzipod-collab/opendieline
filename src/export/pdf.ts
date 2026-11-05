import { centroid, type Vec2 } from "../geometry.js";
import type { Dieline } from "../model.js";

export interface PdfOptions {
  /** Bleed in mm, drawn as a guide outside the cut. Defaults to 3. */
  bleed?: number;
  /** Space around the blank in mm. Defaults to 10. */
  margin?: number;
  /** Draw panel names. Defaults to true. */
  labels?: boolean;
}

const POINTS_PER_MM = 72 / 25.4;
const fixed = (value: number): string => value.toFixed(3);

function escapePdfText(text: string): string {
  return text.replace(/[^\x20-\x7e]/g, "?").replace(/([\\()])/g, "\\$1");
}

/**
 * A one-page, full-scale vector PDF. Cut and crease lines use the spot colours
 * "CutContour" and "Crease", so RIPs and cutting tables can separate them from
 * artwork.
 */
export function toPdf(dieline: Dieline, options: PdfOptions = {}): Uint8Array {
  const bleed = options.bleed ?? 3;
  const margin = options.margin ?? 10;
  const pad = bleed + margin;
  const { minX, minY, width, height } = dieline.bounds;
  const pageW = (width + 2 * pad) * POINTS_PER_MM;
  const pageH = (height + 2 * pad) * POINTS_PER_MM;

  const toPage = ([x, y]: Vec2): string =>
    `${fixed((x - minX + pad) * POINTS_PER_MM)} ${fixed(pageH - (y - minY + pad) * POINTS_PER_MM)}`;

  const outline =
    dieline.cut.map((point, i) => `${toPage(point)} ${i === 0 ? "m" : "l"}`).join("\n") + "\nh\n";

  const content: string[] = ["q", "1 j 1 J"];
  if (bleed > 0) {
    content.push(
      "0.847 0.941 0.89 RG 0.847 0.941 0.89 rg",
      `${fixed(bleed * 2 * POINTS_PER_MM)} w`,
      `${outline}B`,
    );
  }
  content.push("1 1 1 rg", `${outline}f`);

  content.push("/Crease CS 1 SCN", `${fixed(0.25 * POINTS_PER_MM)} w`, "[8.5 5.7] 0 d");
  for (const { from, to } of dieline.creases) {
    content.push(`${toPage(from)} m ${toPage(to)} l S`);
  }

  content.push("[] 0 d", "/CutContour CS 1 SCN", `${outline}S`);

  if (options.labels ?? true) {
    const fontSize = Math.max(7, Math.max(width, height) * 0.014 * POINTS_PER_MM);
    content.push("BT", "0.41 0.44 0.49 rg", `/F1 ${fixed(fontSize)} Tf`);
    for (const panel of dieline.panels) {
      if (!panel.label) continue;
      const text = escapePdfText(panel.label);
      const offset = text.length * fontSize * 0.25;
      const [x, y] = centroid(panel.polygon);
      const anchor = toPage([x, y]).split(" ").map(Number) as [number, number];
      content.push(
        `1 0 0 1 ${fixed(anchor[0] - offset)} ${fixed(anchor[1] - fontSize * 0.35)} Tm`,
        `(${text}) Tj`,
      );
    }
    content.push("ET");
  }
  content.push("Q");
  const stream = content.join("\n");

  const separation = (name: string, cmyk: string): string =>
    `[/Separation /${name} /DeviceCMYK << /FunctionType 2 /Domain [0 1] ` +
    `/C0 [0 0 0 0] /C1 [${cmyk}] /N 1 >>]`;

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${fixed(pageW)} ${fixed(pageH)}] ` +
      `/Contents 4 0 R /Resources << /Font << /F1 5 0 R >> ` +
      `/ColorSpace << /CutContour ${separation("CutContour", "0 1 0 0")} ` +
      `/Crease ${separation("Crease", "1 0 0 0")} >> >> >>`,
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Title (${escapePdfText(`${dieline.template} dieline`)}) /Producer (OpenDieline) >>`,
  ];

  let pdf = "%PDF-1.5\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf +=
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 6 0 R >>\n` +
    `startxref\n${xrefOffset}\n%%EOF\n`;

  return new TextEncoder().encode(pdf);
}
