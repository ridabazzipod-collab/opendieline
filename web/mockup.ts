import { foldPanels, type Dieline, type Template, type Vec2 } from "../src/index.js";

/** An image placed over a rectangle of the dieline, in millimetres. */
export interface Art {
  source: CanvasImageSource;
  width: number;
  height: number;
  ox: number;
  oy: number;
  mmW: number;
  mmH: number;
}

export const MARGIN_MM = 10;

interface Region {
  name: string;
  pad: number;
}

/** The three ways a designer usually exports artwork made on the template. */
export function regions(bleed: number): Region[] {
  return [
    { name: "the full template page", pad: MARGIN_MM + bleed },
    { name: "the dieline with bleed", pad: bleed },
    { name: "the dieline only", pad: 0 },
  ];
}

export interface Fit {
  art: Art;
  region: string;
  /** How far the image shape is from the matched region: 0 is exact, 0.05 is 5%. */
  mismatch: number;
}

/** Matches an uploaded full-dieline artwork to the template area it was exported from. */
export function fitUpload(source: CanvasImageSource, width: number, height: number, dieline: Dieline, bleed: number): Fit {
  const { minX, minY, width: w, height: h } = dieline.bounds;
  const ratio = width / height;
  let best = { region: regions(bleed)[0]!, mismatch: Infinity };
  for (const region of regions(bleed)) {
    const mismatch = Math.abs(Math.log(ratio / ((w + 2 * region.pad) / (h + 2 * region.pad))));
    if (mismatch < best.mismatch) best = { region, mismatch };
  }
  const pad = best.region.pad;
  return {
    art: { source, width, height, ox: minX - pad, oy: minY - pad, mmW: w + 2 * pad, mmH: h + 2 * pad },
    region: best.region.name,
    mismatch: Math.exp(best.mismatch) - 1,
  };
}

function panelBox(polygon: readonly Vec2[]): { x: number; y: number; w: number; h: number } {
  const xs = polygon.map((p) => p[0]);
  const ys = polygon.map((p) => p[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

function blankCanvas(dieline: Dieline, bleed: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; art: Art } {
  const { minX, minY, width, height } = dieline.bounds;
  const mmW = width + 2 * bleed;
  const mmH = height + 2 * bleed;
  const scale = Math.min(8, 3200 / Math.max(mmW, mmH));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(mmW * scale);
  canvas.height = Math.round(mmH * scale);
  const ctx = canvas.getContext("2d")!;
  ctx.scale(canvas.width / mmW, canvas.height / mmH);
  ctx.translate(bleed - minX, bleed - minY);
  return {
    canvas,
    ctx,
    art: { source: canvas, width: canvas.width, height: canvas.height, ox: minX - bleed, oy: minY - bleed, mmW, mmH },
  };
}

/** Runs `paint` inside a panel's box, turned so the drawing reads upright on the finished pack. */
function inPanel(
  ctx: CanvasRenderingContext2D,
  polygon: readonly Vec2[],
  degrees: number,
  paint: (w: number, h: number) => void,
): void {
  const box = panelBox(polygon);
  ctx.save();
  ctx.beginPath();
  ctx.rect(box.x, box.y, box.w, box.h);
  ctx.clip();
  ctx.translate(box.x + box.w / 2, box.y + box.h / 2);
  ctx.rotate((degrees * Math.PI) / 180);
  const sideways = degrees % 180 !== 0;
  paint(sideways ? box.h : box.w, sideways ? box.w : box.h);
  ctx.restore();
}

const SAMPLE = { base: "#0f5a52", accent: "#f2b134", light: "#f7f3ea" };

function brandMark(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const size = Math.min(w, h);
  ctx.fillStyle = SAMPLE.accent;
  ctx.beginPath();
  ctx.arc(0, -h * 0.08, size * 0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = SAMPLE.light;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `700 ${size * 0.13}px "Familjen Grotesk", "Segoe UI", sans-serif`;
  ctx.fillText("YOUR", 0, -h * 0.08 - size * 0.07);
  ctx.fillText("BRAND", 0, -h * 0.08 + size * 0.08);
  ctx.font = `600 ${size * 0.055}px "Familjen Grotesk", "Segoe UI", sans-serif`;
  ctx.fillText("Sample design", 0, h * 0.32);
}

/** A placeholder design, so the mockup shows something before the designer adds theirs. */
export function sampleArt(dieline: Dieline, template: Template, bleed: number): Art {
  const { ctx, art } = blankCanvas(dieline, bleed);
  ctx.fillStyle = SAMPLE.base;
  ctx.fillRect(art.ox, art.oy, art.mmW, art.mmH);
  ctx.strokeStyle = "rgba(255,255,255,0.07)";
  ctx.lineWidth = 2;
  for (let x = art.ox - art.mmH; x < art.ox + art.mmW; x += 9) {
    ctx.beginPath();
    ctx.moveTo(x, art.oy);
    ctx.lineTo(x + art.mmH, art.oy + art.mmH);
    ctx.stroke();
  }
  const front = dieline.panels.find((panel) => panel.id === template.frontPanel);
  if (front) inPanel(ctx, front.polygon, template.frontRotation, (w, h) => brandMark(ctx, w, h));
  const back = dieline.panels.find((panel) => panel.id === "back");
  if (back && template.kind === "pouch") {
    inPanel(ctx, back.polygon, 180, (w, h) => {
      ctx.fillStyle = "rgba(247,243,234,0.85)";
      for (let i = 0; i < 6; i++) ctx.fillRect(-w * 0.3, -h * 0.1 + i * h * 0.06, w * (i % 3 === 2 ? 0.4 : 0.6), h * 0.022);
      ctx.fillStyle = SAMPLE.light;
      ctx.fillRect(-w * 0.18, h * 0.3, w * 0.36, h * 0.08);
    });
  }
  return art;
}

/** Quick mode: one image covers the front panel and the rest of the pack is one colour. */
export function frontArt(
  dieline: Dieline,
  template: Template,
  bleed: number,
  image: { source: CanvasImageSource; width: number; height: number } | null,
  colour: string,
  turns: number,
): Art {
  const { ctx, art } = blankCanvas(dieline, bleed);
  ctx.fillStyle = colour;
  ctx.fillRect(art.ox, art.oy, art.mmW, art.mmH);
  const front = dieline.panels.find((panel) => panel.id === template.frontPanel);
  if (front) {
    const degrees = (template.frontRotation + turns * 90) % 360;
    inPanel(ctx, front.polygon, degrees, (w, h) => {
      if (!image) {
        brandMark(ctx, w, h);
        return;
      }
      const scale = Math.max(w / image.width, h / image.height);
      ctx.drawImage(image.source, (-image.width * scale) / 2, (-image.height * scale) / 2, image.width * scale, image.height * scale);
    });
  }
  return art;
}

type V3 = [number, number, number];

function convexHull(points: [number, number][]): [number, number][] {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: number[], a: number[], b: number[]): number =>
    (a[0]! - o[0]!) * (b[1]! - o[1]!) - (a[1]! - o[1]!) * (b[0]! - o[0]!);
  const half = (list: [number, number][]): [number, number][] => {
    const out: [number, number][] = [];
    for (const p of list) {
      while (out.length >= 2 && cross(out[out.length - 2]!, out[out.length - 1]!, p) <= 0) out.pop();
      out.push(p);
    }
    out.pop();
    return out;
  };
  return [...half(sorted), ...half([...sorted].reverse())];
}

function trace(ctx: CanvasRenderingContext2D, points: readonly (readonly number[])[]): void {
  ctx.beginPath();
  points.forEach((p, i) => (i === 0 ? ctx.moveTo(p[0]!, p[1]!) : ctx.lineTo(p[0]!, p[1]!)));
  ctx.closePath();
}

/** Draws the image so that three flat points land on three screen points. */
function mapImage(ctx: CanvasRenderingContext2D, art: Art, flat: readonly Vec2[], screen: readonly (readonly number[])[]): void {
  const n = flat.length;
  let best = [0, 1, 2];
  let bestArea = 0;
  for (let i = 1; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const area = Math.abs((flat[i]![0] - flat[0]![0]) * (flat[j]![1] - flat[0]![1]) - (flat[j]![0] - flat[0]![0]) * (flat[i]![1] - flat[0]![1]));
      if (area > bestArea) {
        bestArea = area;
        best = [0, i, j];
      }
    }
  }
  const kx = art.width / art.mmW;
  const ky = art.height / art.mmH;
  const s = best.map((i) => [(flat[i]![0] - art.ox) * kx, (flat[i]![1] - art.oy) * ky] as const);
  const d = best.map((i) => screen[i]!);
  const [s0, s1, s2] = s as [readonly [number, number], readonly [number, number], readonly [number, number]];
  const [d0, d1, d2] = d as [readonly number[], readonly number[], readonly number[]];
  const denom = (s1[0] - s0[0]) * (s2[1] - s0[1]) - (s2[0] - s0[0]) * (s1[1] - s0[1]);
  if (Math.abs(denom) < 1e-9) return;
  const a = ((d1[0]! - d0[0]!) * (s2[1] - s0[1]) - (d2[0]! - d0[0]!) * (s1[1] - s0[1])) / denom;
  const c = ((d2[0]! - d0[0]!) * (s1[0] - s0[0]) - (d1[0]! - d0[0]!) * (s2[0] - s0[0])) / denom;
  const b = ((d1[1]! - d0[1]!) * (s2[1] - s0[1]) - (d2[1]! - d0[1]!) * (s1[1] - s0[1])) / denom;
  const e = ((d2[1]! - d0[1]!) * (s1[0] - s0[0]) - (d1[1]! - d0[1]!) * (s2[0] - s0[0])) / denom;
  ctx.transform(a, b, c, e, d0[0]! - a * s0[0] - c * s0[1], d0[1]! - b * s0[0] - e * s0[1]);
  ctx.drawImage(art.source, 0, 0, art.width, art.height);
}

export interface BoxView {
  yaw: number;
  pitch: number;
  inside: "white" | "kraft";
  finish: "gloss" | "matte";
}

/** Renders the folded carton with its artwork, seen at an angle, on a transparent canvas. */
export function renderBox(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  dieline: Dieline,
  template: Template,
  art: Art,
  view: BoxView,
): void {
  const folded = foldPanels(dieline, 1);
  // Turn the box so its upright axis points up and its front faces the camera.
  // Both maps are rotations, so artwork is never mirrored.
  const upright = template.upright === "z"
    ? ([x, y, z]: readonly number[]): V3 => [-x!, z!, y!]
    : ([x, y, z]: readonly number[]): V3 => [-x!, -y!, z!];

  const walls = folded
    .map((panel, index) => ({ panel, flat: dieline.panels[index]!.polygon }))
    .filter(({ panel }) => panel.role === "wall")
    .map(({ panel, flat }) => ({ flat, points: panel.points.map(upright) }));

  const all = walls.flatMap((wall) => wall.points);
  const middle = [0, 1, 2].map((axis) => {
    const values = all.map((p) => p[axis]!);
    return (Math.min(...values) + Math.max(...values)) / 2;
  });
  const floor = Math.min(...all.map((p) => p[1]));

  const cy = Math.cos(view.yaw);
  const sy = Math.sin(view.yaw);
  const cp = Math.cos(view.pitch);
  const sp = Math.sin(view.pitch);
  const turn = (p: readonly number[]): V3 => {
    const x = p[0]! - middle[0]!;
    const y = p[1]! - middle[1]!;
    const z = p[2]! - middle[2]!;
    const x1 = cy * x + sy * z;
    const z1 = -sy * x + cy * z;
    return [x1, cp * y - sp * z1, sp * y + cp * z1];
  };

  const faces = walls.map(({ flat, points }) => {
    const view3 = points.map(turn);
    let nx = 0;
    let ny = 0;
    let nz = 0;
    view3.forEach((p, i) => {
      const q = view3[(i + 1) % view3.length]!;
      nx += (p[1] - q[1]) * (p[2] + q[2]);
      ny += (p[2] - q[2]) * (p[0] + q[0]);
      nz += (p[0] - q[0]) * (p[1] + q[1]);
    });
    let flatArea = 0;
    flat.forEach((p, i) => {
      const q = flat[(i + 1) % flat.length]!;
      flatArea += p[0] * q[1] - q[0] * p[1];
    });
    // This normal points away from the printed side, so turn it round.
    const length = Math.hypot(nx, ny, nz) || 1;
    const orient = (flatArea > 0 ? -1 : 1) / length;
    return {
      flat,
      view3,
      normal: [nx * orient, ny * orient, nz * orient] as V3,
      depth: view3.reduce((sum, p) => sum + p[2], 0) / view3.length,
    };
  });

  const projected = faces.flatMap((face) => face.view3);
  const xs = projected.map((p) => p[0]);
  const ys = projected.map((p) => -p[1]);
  const spanX = Math.max(...xs) - Math.min(...xs);
  const spanY = Math.max(...ys) - Math.min(...ys);
  const scale = Math.min((width * 0.74) / spanX, (height * 0.7) / spanY);
  const ox = width / 2 - ((Math.max(...xs) + Math.min(...xs)) / 2) * scale;
  const oy = height * 0.47 - ((Math.max(...ys) + Math.min(...ys)) / 2) * scale;
  const screen = (p: V3): [number, number] => [ox + p[0] * scale, oy - p[1] * scale];

  // Soft shadow under the box: the outline of everything that touches the table.
  const base = all.filter((p) => Math.abs(p[1] - floor) < 1e-3).map((p) => screen(turn(p)));
  if (base.length >= 3) {
    const hull = convexHull(base);
    ctx.save();
    const away = width * 4;
    ctx.translate(-away, 0);
    ctx.shadowOffsetX = away;
    ctx.shadowColor = "rgba(20, 28, 25, 0.38)";
    ctx.shadowBlur = width * 0.035;
    ctx.shadowOffsetY = width * 0.012;
    trace(ctx, hull);
    ctx.fillStyle = "#000";
    ctx.fill();
    ctx.shadowBlur = width * 0.008;
    ctx.shadowColor = "rgba(20, 28, 25, 0.45)";
    ctx.shadowOffsetY = 0;
    ctx.fill();
    ctx.restore();
  }

  const light = normalise([-0.45, 0.75, 0.5]);
  const half = normalise([light[0], light[1], light[2] + 1]);
  const insideColour = view.inside === "kraft" ? "#b8895a" : "#f2f0ea";
  faces.sort((p, q) => p.depth - q.depth);
  ctx.lineJoin = "round";

  for (const face of faces) {
    const points = face.view3.map(screen);
    const outside = face.normal[2] > 0;
    const n = outside ? face.normal : (face.normal.map((v) => -v) as V3);
    const diffuse = Math.max(0, dot(n, light));

    ctx.save();
    trace(ctx, points);
    ctx.clip();
    if (outside) {
      ctx.save();
      mapImage(ctx, art, face.flat, points);
      ctx.restore();
      ctx.fillStyle = `rgba(10, 18, 16, ${(0.36 * (1 - diffuse)).toFixed(3)})`;
      ctx.fillRect(0, 0, width, height);
      const shine = Math.pow(Math.max(0, dot(n, half)), view.finish === "gloss" ? 18 : 6);
      ctx.fillStyle = `rgba(255, 255, 255, ${(shine * (view.finish === "gloss" ? 0.3 : 0.1)).toFixed(3)})`;
      ctx.fillRect(0, 0, width, height);
    } else {
      ctx.fillStyle = insideColour;
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = `rgba(10, 18, 16, ${(0.18 + 0.3 * (1 - diffuse)).toFixed(3)})`;
      ctx.fillRect(0, 0, width, height);
    }
    ctx.restore();
    trace(ctx, points);
    ctx.strokeStyle = "rgba(10, 18, 16, 0.22)";
    ctx.lineWidth = Math.max(1, width / 900);
    ctx.stroke();
  }
}

function normalise(v: number[]): V3 {
  const length = Math.hypot(v[0]!, v[1]!, v[2]!);
  return [v[0]! / length, v[1]! / length, v[2]! / length];
}

function dot(a: readonly number[], b: readonly number[]): number {
  return a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
}

export interface PouchView {
  side: "front" | "back";
  finish: "gloss" | "matte";
}

/** Renders a filled pouch, seen straight on, with seals, zipper and notches. */
export function renderPouch(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  dieline: Dieline,
  art: Art,
  view: PouchView,
): void {
  const p = dieline.pouch;
  if (!p) return;
  const { width: w, height: h, gusset: g, seal, topSeal, zipper, corner: r, notchY } = p;
  const lift = g > 0 ? Math.min(g * 0.16, h * 0.05) : 0;
  const scale = Math.min((width * 0.62) / w, (height * 0.8) / h);
  const notch = 3;

  ctx.save();
  ctx.translate((width - w * scale) / 2, (height - h * scale) / 2 - height * 0.015);
  ctx.scale(scale, scale);

  const outline = (): void => {
    ctx.beginPath();
    ctx.moveTo(0, r);
    ctx.arc(r, r, r, Math.PI, Math.PI * 1.5);
    ctx.lineTo(w - r, 0);
    ctx.arc(w - r, r, r, Math.PI * 1.5, Math.PI * 2);
    ctx.lineTo(w, notchY - notch / 2);
    ctx.lineTo(w - notch, notchY);
    ctx.lineTo(w, notchY + notch / 2);
    ctx.lineTo(w, h - lift);
    ctx.quadraticCurveTo(w / 2, h + lift, 0, h - lift);
    ctx.lineTo(0, notchY + notch / 2);
    ctx.lineTo(notch, notchY);
    ctx.lineTo(0, notchY - notch / 2);
    ctx.closePath();
  };

  if (g > 0) {
    const ground = ctx.createRadialGradient(w / 2, h, 0, w / 2, h, w * 0.62);
    ground.addColorStop(0, "rgba(20, 28, 25, 0.42)");
    ground.addColorStop(1, "rgba(20, 28, 25, 0)");
    ctx.save();
    ctx.translate(0, h);
    ctx.scale(1, Math.max(0.08, (g * 0.5) / w));
    ctx.translate(0, -h);
    ctx.fillStyle = ground;
    ctx.fillRect(-w * 0.2, h - w * 0.7, w * 1.4, w * 1.4);
    ctx.restore();
  }

  ctx.save();
  ctx.shadowColor = "rgba(20, 28, 25, 0.3)";
  ctx.shadowBlur = width * 0.03;
  ctx.shadowOffsetY = width * 0.012;
  outline();
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.restore();

  ctx.save();
  outline();
  ctx.clip();

  // The front panel prints the right way up. The back panel prints upside down.
  const kx = art.width / art.mmW;
  const ky = art.height / art.mmH;
  const top = view.side === "front" ? 0 : h + g;
  ctx.save();
  if (view.side === "back") {
    ctx.translate(w, h);
    ctx.rotate(Math.PI);
  }
  ctx.drawImage(art.source, (0 - art.ox) * kx, (top - art.oy) * ky, w * kx, h * ky, 0, 0, w, h);
  ctx.restore();

  const fill = (style: string | CanvasGradient, x: number, y: number, fw: number, fh: number): void => {
    ctx.fillStyle = style;
    ctx.fillRect(x, y, fw, fh);
  };

  // Pillow shape: the filled body curves away at the sides.
  const across = ctx.createLinearGradient(0, 0, w, 0);
  across.addColorStop(0, "rgba(0,0,0,0.26)");
  across.addColorStop(Math.min(0.2, (seal + 6) / w), "rgba(0,0,0,0.08)");
  across.addColorStop(0.36, "rgba(255,255,255,0.06)");
  across.addColorStop(0.55, "rgba(0,0,0,0)");
  across.addColorStop(1 - Math.min(0.2, (seal + 6) / w), "rgba(0,0,0,0.1)");
  across.addColorStop(1, "rgba(0,0,0,0.3)");
  fill(across, 0, zipper, w, h);

  const down = ctx.createLinearGradient(0, zipper, 0, h);
  down.addColorStop(0, "rgba(0,0,0,0.1)");
  down.addColorStop(0.08, "rgba(255,255,255,0.05)");
  down.addColorStop(0.75, "rgba(0,0,0,0)");
  down.addColorStop(1, g > 0 ? "rgba(0,0,0,0.22)" : "rgba(0,0,0,0.08)");
  fill(down, 0, zipper, w, h - zipper + lift);

  // Flat sealed edges, with a fine crimp texture.
  fill("rgba(255,255,255,0.08)", 0, 0, w, topSeal);
  fill("rgba(255,255,255,0.06)", 0, topSeal, seal, h);
  fill("rgba(255,255,255,0.06)", w - seal, topSeal, seal, h);
  ctx.strokeStyle = "rgba(0,0,0,0.07)";
  ctx.lineWidth = 0.25;
  ctx.beginPath();
  for (let x = 0.6; x < w; x += 1.1) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, topSeal);
  }
  for (let y = topSeal + 0.6; y < h; y += 1.1) {
    ctx.moveTo(0, y);
    ctx.lineTo(seal, y);
    ctx.moveTo(w - seal, y);
    ctx.lineTo(w, y);
  }
  ctx.stroke();
  ctx.strokeStyle = "rgba(0,0,0,0.2)";
  ctx.lineWidth = 0.45;
  ctx.beginPath();
  ctx.moveTo(seal, topSeal);
  ctx.lineTo(seal, h);
  ctx.moveTo(w - seal, topSeal);
  ctx.lineTo(w - seal, h);
  ctx.moveTo(0, topSeal);
  ctx.lineTo(w, topSeal);
  ctx.stroke();

  // Zipper ridge: a highlight above and a shadow below.
  const ridge = ctx.createLinearGradient(0, zipper - 2, 0, zipper + 4);
  ridge.addColorStop(0, "rgba(255,255,255,0)");
  ridge.addColorStop(0.3, "rgba(255,255,255,0.38)");
  ridge.addColorStop(0.45, "rgba(0,0,0,0.32)");
  ridge.addColorStop(1, "rgba(0,0,0,0)");
  fill(ridge, seal, zipper - 2, w - 2 * seal, 6);

  // Creases where the body pulls away from the seals.
  ctx.lineWidth = 0.8;
  for (const [x, dir] of [[seal + 2, 1], [w - seal - 2, -1]] as const) {
    ctx.strokeStyle = "rgba(0,0,0,0.08)";
    ctx.beginPath();
    ctx.moveTo(x, zipper + 4);
    ctx.quadraticCurveTo(x + dir * 7, zipper + h * 0.12, x + dir * 4, zipper + h * 0.3);
    ctx.stroke();
    ctx.strokeStyle = "rgba(255,255,255,0.1)";
    ctx.beginPath();
    ctx.moveTo(x + dir * 1.2, zipper + 5);
    ctx.quadraticCurveTo(x + dir * 8.2, zipper + h * 0.12, x + dir * 5.2, zipper + h * 0.3);
    ctx.stroke();
  }

  // A soft diagonal reflection.
  const strength = view.finish === "gloss" ? 0.3 : 0.08;
  const shine = ctx.createLinearGradient(w * 0.05, zipper, w * 0.62, h * 0.55);
  shine.addColorStop(0.3, "rgba(255,255,255,0)");
  shine.addColorStop(0.42, `rgba(255,255,255,${strength})`);
  shine.addColorStop(0.5, `rgba(255,255,255,${strength * 0.35})`);
  shine.addColorStop(0.62, "rgba(255,255,255,0)");
  fill(shine, 0, zipper, w, h);
  ctx.restore();

  outline();
  ctx.strokeStyle = "rgba(0,0,0,0.25)";
  ctx.lineWidth = 0.35;
  ctx.stroke();

  const hole = dieline.innerCuts[0];
  if (hole) {
    // The slot is centred, so it sits in the same place seen from either side.
    const points = hole.map(([x, y]) => [x, y]);
    ctx.save();
    ctx.globalCompositeOperation = "destination-out";
    trace(ctx, points);
    ctx.fill();
    ctx.restore();
    trace(ctx, points);
    ctx.strokeStyle = "rgba(0,0,0,0.3)";
    ctx.lineWidth = 0.35;
    ctx.stroke();
  }
  ctx.restore();
}
