import { centroid, type Vec2 } from "../geometry.js";
import type { Dieline } from "../model.js";

export interface SvgOptions {
  /** Bleed in mm. Drawn as a guide layer outside the cut. Defaults to 3. */
  bleed?: number;
  /** Space around the blank in mm. Defaults to 10. */
  margin?: number;
  /** Draw panel names. Defaults to true. */
  labels?: boolean;
}

const number = (value: number): string => String(Math.round(value * 1000) / 1000);

export function pathData(points: readonly Vec2[]): string {
  return `M${points.map(([x, y]) => `${number(x)} ${number(y)}`).join("L")}Z`;
}

function openPathData(points: readonly Vec2[]): string {
  return `M${points.map(([x, y]) => `${number(x)} ${number(y)}`).join("L")}`;
}

function escapeXml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** A full-scale SVG with named layers: width and height are real millimetres. */
export function toSvg(dieline: Dieline, options: SvgOptions = {}): string {
  const bleed = options.bleed ?? 3;
  const margin = options.margin ?? 10;
  const { minX, minY, width, height } = dieline.bounds;
  const pad = margin + bleed;
  const w = width + 2 * pad;
  const h = height + 2 * pad;
  const outline = pathData(dieline.cut);
  const holes = dieline.innerCuts.map(pathData).join("");

  const longest = Math.max(width, height);
  const fontSize = Math.max(3, longest * 0.014);
  const lineWidth = number(Math.max(0.35, longest * 0.001));
  const dash = `${number(Math.max(3, longest * 0.008))} ${number(Math.max(2, longest * 0.005))}`;

  const creases = dieline.creases
    .map(
      ({ from, to }) =>
        `<line x1="${number(from[0])}" y1="${number(from[1])}" x2="${number(to[0])}" y2="${number(to[1])}"/>`,
    )
    .join("");
  const seals = dieline.guides
    .filter((guide) => guide.kind === "seal")
    .map((guide) => `<path d="${pathData(guide.points)}"/>`)
    .join("");
  const zippers = dieline.guides
    .filter((guide) => guide.kind === "zipper")
    .map((guide) => `<path d="${guide.closed ? pathData(guide.points) : openPathData(guide.points)}"/>`)
    .join("");

  const labels =
    (options.labels ?? true)
      ? dieline.panels
          .filter((panel) => panel.label)
          .map((panel) => {
            const [x, y] = centroid(panel.polygon);
            return `<text x="${number(x)}" y="${number(y)}">${escapeXml(panel.label!)}</text>`;
          })
          .join("")
      : "";

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${number(w)}mm" height="${number(h)}mm"`,
    ` viewBox="${number(minX - pad)} ${number(minY - pad)} ${number(w)} ${number(h)}">`,
    `<title>${escapeXml(dieline.template)} dieline</title>`,
    seals ? `<defs><clipPath id="od-blank"><path d="${outline}"/></clipPath></defs>` : "",
    bleed > 0
      ? `<g id="bleed"><path d="${outline}" fill="#d8f0e3" stroke="#d8f0e3" stroke-width="${number(bleed * 2)}" stroke-linejoin="round"/></g>`
      : "",
    `<g id="board"><path d="${outline}${holes}" fill="#ffffff" fill-rule="evenodd"/></g>`,
    seals
      ? `<g id="seal" clip-path="url(#od-blank)" fill="#7d8b99" fill-opacity="0.2" stroke="none">${seals}</g>`
      : "",
    `<g id="crease" stroke="#0091d5" stroke-width="${lineWidth}" stroke-dasharray="${dash}" fill="none">${creases}</g>`,
    zippers
      ? `<g id="zipper" stroke="#12945a" stroke-width="${number(Number(lineWidth) * 2)}" stroke-dasharray="${dash}" fill="none">${zippers}</g>`
      : "",
    `<g id="cut"><path d="${outline}${holes}" fill="none" stroke="#e6007e" stroke-width="${lineWidth}" stroke-linejoin="round"/></g>`,
    labels
      ? `<g id="labels" fill="#68707c" font-family="Helvetica,Arial,sans-serif" font-size="${number(fontSize)}" text-anchor="middle" dominant-baseline="middle">${labels}</g>`
      : "",
    `</svg>`,
  ].join("");
}
