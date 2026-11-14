import {
  DielineError,
  customCartonTemplate,
  findCarton,
  foldPanels,
  generate,
  getTemplate,
  measure,
  templates,
  toDxf,
  toPdf,
  layoutFromPixels,
  toSvg,
  type BoxParameters,
  type Dieline,
  type PixelLayout,
  type Template,
} from "../src/index.js";
import { fitUpload, frontArt, renderBox, renderPouch, sampleArt, type Art } from "./mockup.js";

interface Downloads {
  save(request: { filename: string; data: string | Blob | Uint8Array }): Promise<{ status: string }>;
}
declare global {
  interface Window {
    claude?: { use(name: "downloads"): Promise<Downloads | null> };
  }
}

const el = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const input = (id: string): HTMLInputElement => el<HTMLInputElement>(id);
const numberInput = (id: string): number => input(id).valueAsNumber;

const select = el<HTMLSelectElement>("template");
const canvas = el<HTMLCanvasElement>("view");
const context = canvas.getContext("2d")!;
const foldInput = input("fold");
const stage = el("stage");
const mockCanvas = el<HTMLCanvasElement>("mockup");
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

let template: Template = templates[0]!;
let current: Dieline | null = null;
let yaw = -0.7;
let pitch = 0.55;
let animation = 0;
let downloads: Downloads | null = null;

interface Upload {
  source: CanvasImageSource;
  width: number;
  height: number;
  name: string;
  /** Changes with every upload, so cached mockup art is rebuilt. */
  id: number;
}
let uploads = 0;
const studio = {
  mode: "full" as "full" | "front",
  upload: null as Upload | null,
  turns: 0,
  background: "clear" as "clear" | "white",
  side: "front" as "front" | "back",
  yaw: -0.62,
  pitch: 0.42,
};
let artCache: { key: string; art: Art } | null = null;

/** A carton read from the uploaded dieline picture. Its panel lines are in picture pixels. */
const CUSTOM_ID = "from-image";
let custom: { template: Template; layout: PixelLayout; upload: Upload } | null = null;

function templateFor(id: string): Template {
  return id === CUSTOM_ID && custom ? custom.template : getTemplate(id);
}

for (const option of templates) select.add(new Option(option.name, option.id));

function fillDefaults(): void {
  template = templateFor(select.value);
  const { defaults, labels } = template;
  for (const key of ["length", "width", "depth", "thickness"] as const) input(key).value = String(defaults[key]);
  el("lengthLabel").textContent = `${labels.length} mm`;
  el("depthLabel").textContent = `${labels.depth} mm`;
  el("widthLabel").textContent = `${labels.width ?? "Width"} mm`;
  el("widthField").hidden = labels.width === null;
  el("depthField").hidden = template.id === CUSTOM_ID;
  el("guides").hidden = !(custom && template.id === CUSTOM_ID);

  const pouch = template.kind === "pouch";
  el("pouchFields").hidden = !pouch;
  el("thicknessField").hidden = pouch || template.id === CUSTOM_ID;
  if (pouch) {
    input("seal").value = String(defaults.seal ?? 8);
    input("zipper").value = String(defaults.zipper ?? 30);
    input("corner").value = String(defaults.corner ?? 0);
    input("hangHole").checked = defaults.hangHole ?? false;
    input("gsm").value = "90";
  } else if (input("gsm").value === "90") {
    input("gsm").value = "350";
  }
  el("gsmLabel").textContent = pouch ? "Film g/m²" : "Board g/m²";
  el("description").textContent = template.description;
  el("flatTag").textContent = pouch
    ? "FLAT LAYOUT · cut solid, fold dashed, seals grey, zipper green"
    : "FLAT BLANK · cut solid, crease dashed";
  el("viewTag").textContent = pouch ? "FILLED POUCH" : "FOLDED · drag to turn";
  el("foldbar").hidden = pouch;
  canvas.classList.toggle("full", pouch);
  el("checksTitle").textContent = pouch ? "Pouch checks" : "Fold verification";

  el("insideField").hidden = pouch;
  el("sideField").hidden = !pouch;
  el("stageTip").hidden = pouch;
  mockCanvas.classList.toggle("turnable", !pouch);
  studio.turns = 0;
  studio.side = "front";
  syncStudio();
}

function parameters(): BoxParameters {
  const base: BoxParameters = {
    length: numberInput("length"),
    width: template.labels.width === null ? template.defaults.width : numberInput("width"),
    depth: numberInput("depth"),
    thickness: template.kind === "pouch" ? template.defaults.thickness : numberInput("thickness"),
  };
  if (template.kind !== "pouch") return base;
  return {
    ...base,
    seal: numberInput("seal"),
    zipper: numberInput("zipper"),
    corner: numberInput("corner"),
    hangHole: input("hangHole").checked,
  };
}

function bleed(): number {
  const value = numberInput("bleed");
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

function update(): void {
  const error = el("error");
  try {
    const { dieline, verification } = generate(template, parameters());
    current = dieline;
    artCache = null;
    error.hidden = true;

    el("flat").innerHTML = toSvg(dieline, { bleed: bleed() });
    const svg = el("flat").querySelector("svg")!;
    svg.removeAttribute("width");
    svg.removeAttribute("height");

    el("checks").replaceChildren(
      ...verification.checks.map((check) => {
        const item = document.createElement("li");
        item.className = check.passed ? "pass" : "fail";
        const pill = document.createElement("span");
        pill.className = "pill";
        pill.textContent = check.passed ? "PASS" : "FAIL";
        const text = document.createElement("span");
        text.textContent = `${check.name[0]!.toUpperCase()}${check.name.slice(1)}: ${check.detail}`;
        item.append(pill, text);
        return item;
      }),
    );

    const gsm = numberInput("gsm");
    const metrics = measure(dieline, Number.isFinite(gsm) ? gsm : undefined);
    const material = template.kind === "pouch" ? "Film area" : "Board area";
    const rows: [string, string][] = [
      ["Blank size", `${metrics.blankWidth.toFixed(1)} × ${metrics.blankHeight.toFixed(1)}`],
      [material, `${(metrics.boardArea / 1e6).toFixed(4)} m²`],
      ["Rectangle used", `${(metrics.rectangleUse * 100).toFixed(0)}%`],
      ["Cut length", `${(metrics.cutLength / 1000).toFixed(2)} m`],
      [template.kind === "pouch" ? "Fold length" : "Crease length", `${(metrics.creaseLength / 1000).toFixed(2)} m`],
    ];
    if (metrics.weightGrams !== undefined) rows.push(["Weight", `${metrics.weightGrams.toFixed(1)} g`]);
    el("metrics").replaceChildren(
      ...rows.map(([term, value]) => {
        const row = document.createElement("div");
        const dt = document.createElement("dt");
        const dd = document.createElement("dd");
        dt.textContent = term;
        dd.textContent = value;
        row.append(dt, dd);
        return row;
      }),
    );
    draw();
    renderMockup();
  } catch (caught) {
    if (!(caught instanceof DielineError)) throw caught;
    error.textContent = caught.message;
    error.hidden = false;
  }
}

function sizeCanvas(target: HTMLCanvasElement): [number, number, CanvasRenderingContext2D] {
  const ratio = devicePixelRatio || 1;
  const width = target.clientWidth;
  const height = target.clientHeight;
  if (target.width !== Math.round(width * ratio) || target.height !== Math.round(height * ratio)) {
    target.width = Math.round(width * ratio);
    target.height = Math.round(height * ratio);
  }
  const ctx = target.getContext("2d")!;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.imageSmoothingQuality = "high";
  return [width, height, ctx];
}

/** The right-hand pane: an animated fold for cartons, a filled pouch for pouches. */
function draw(): void {
  const dieline = current;
  if (!dieline) return;
  if (template.kind === "pouch") {
    const [width, height, ctx] = sizeCanvas(canvas);
    renderPouch(ctx, width, height, dieline, art(), { side: "front", finish: finish() });
    return;
  }
  const [width, height] = sizeCanvas(canvas);

  const progress = Number(foldInput.value) / 100;
  const panels = foldPanels(dieline, progress);
  const all = panels.flatMap((panel) => [...panel.points]);
  const middle = [0, 1, 2].map((axis) => {
    const values = all.map((p) => p[axis]!);
    return (Math.min(...values) + Math.max(...values)) / 2;
  });
  const radius = Math.max(
    ...all.map((p) => Math.hypot(p[0] - middle[0]!, p[1] - middle[1]!, p[2] - middle[2]!)),
  );

  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const scale = (Math.min(width, height) / (2 * radius)) * 0.86;
  const camera = radius * 4;

  const toView = (p: readonly number[]): [number, number, number] => {
    const x = p[0]! - middle[0]!;
    const y = p[1]! - middle[1]!;
    const z = p[2]! - middle[2]!;
    const x1 = cy * x + sy * z;
    const z1 = -sy * x + cy * z;
    return [x1, cp * y - sp * z1, sp * y + cp * z1];
  };

  const faces = panels.map((panel, index) => {
    const view = panel.points.map(toView);
    let nx = 0;
    let ny = 0;
    let nz = 0;
    view.forEach((p, i) => {
      const q = view[(i + 1) % view.length]!;
      nx += (p[1] - q[1]) * (p[2] + q[2]);
      ny += (p[2] - q[2]) * (p[0] + q[0]);
      nz += (p[0] - q[0]) * (p[1] + q[1]);
    });
    const polygon = dieline.panels[index]!.polygon;
    let flatArea = 0;
    polygon.forEach((p, i) => {
      const q = polygon[(i + 1) % polygon.length]!;
      flatArea += p[0] * q[1] - q[0] * p[1];
    });
    const orient = (flatArea > 0 ? 1 : -1) / (Math.hypot(nx, ny, nz) || 1);
    nx *= orient;
    ny *= orient;
    nz *= orient;
    const depth = view.reduce((sum, p) => sum + p[2], 0) / view.length;
    return { view, role: panel.role, nx, ny, nz, depth };
  });

  // Flaps sit inside the box, so they are drawn before the walls that share their plane.
  const flapBias = radius * 0.2 * progress;
  const key = (face: (typeof faces)[number]): number => face.depth + (face.role === "flap" ? flapBias : 0);
  faces.sort((p, q) => key(q) - key(p));

  context.lineJoin = "round";
  context.lineWidth = 1;
  for (const face of faces) {
    // The viewer looks along +z. The oriented normal points away from the printed side,
    // so the printed side faces the viewer when that normal points away too.
    const printedSide = face.nz > 0;
    // A flap on a closed box is hidden behind a wall. It shares that wall's plane, so skip it.
    if (face.role === "flap" && printedSide && progress >= 0.98) continue;
    context.beginPath();
    face.view.forEach(([x, y, z], i) => {
      const perspective = camera / (camera + z);
      const sx = width / 2 + x * scale * perspective;
      const sy2 = height / 2 + y * scale * perspective;
      if (i === 0) context.moveTo(sx, sy2);
      else context.lineTo(sx, sy2);
    });
    context.closePath();
    const light = 0.72 + 0.28 * Math.abs(0.35 * face.nx - 0.55 * face.ny - 0.75 * face.nz);
    const base = printedSide ? [250, 250, 247] : [201, 164, 118];
    context.fillStyle = `rgb(${base.map((channel) => Math.round(channel * light)).join(",")})`;
    context.strokeStyle = "rgba(14,58,50,0.55)";
    context.fill();
    context.stroke();
  }
}

function setFold(value: number): void {
  foldInput.value = String(value);
  el("foldValue").textContent = `${Math.round(value)}%`;
  draw();
}

function play(to: number): void {
  cancelAnimationFrame(animation);
  if (reducedMotion || template.kind === "pouch") {
    setFold(to);
    return;
  }
  const from = Number(foldInput.value);
  const start = performance.now();
  const duration = 1100;
  const step = (now: number): void => {
    const t = Math.min(1, (now - start) / duration);
    const eased = t * t * (3 - 2 * t);
    setFold(from + (to - from) * eased);
    if (t < 1) animation = requestAnimationFrame(step);
  };
  animation = requestAnimationFrame(step);
}

async function saveFile(filename: string, data: string | Blob | Uint8Array, type: string): Promise<boolean> {
  if (downloads) {
    try {
      await downloads.save({ filename, data });
      return true;
    } catch (caught) {
      if ((caught as { code?: string }).code !== "declined") throw caught;
      return false;
    }
  }
  const blob = data instanceof Blob ? data : new Blob([data as BlobPart], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}

async function saveDieline(format: string): Promise<void> {
  if (!current) return;
  const note = el("note");
  const filename = `${template.id}.${format}`;
  const data =
    format === "svg"
      ? toSvg(current, { bleed: bleed() })
      : format === "pdf"
        ? toPdf(current, { bleed: bleed() })
        : toDxf(current);
  const type = format === "svg" ? "image/svg+xml" : format === "pdf" ? "application/pdf" : "application/dxf";
  try {
    if (await saveFile(filename, data, type)) note.textContent = `Saved ${filename}.`;
  } catch {
    note.textContent = `Could not save ${filename}.`;
  }
}

/* ---------- Mockup studio ---------- */

function finish(): "gloss" | "matte" {
  return el<HTMLSelectElement>("finish").value === "matte" ? "matte" : "gloss";
}

function art(): Art {
  const dieline = current!;
  const upload = studio.upload;
  const key = [
    template.id,
    JSON.stringify(dieline.bounds),
    bleed(),
    studio.mode,
    upload?.id ?? "",
    input("fill").value,
    studio.turns,
    template.id === CUSTOM_ID ? `${JSON.stringify(custom?.layout)}|${input("length").value}` : "",
  ].join("|");
  if (artCache?.key === key) return artCache.art;

  let result: Art;
  const status = el("artStatus");
  status.classList.remove("warn");
  if (studio.mode === "front") {
    result = frontArt(dieline, template, bleed(), upload, input("fill").value, studio.turns);
    status.textContent = upload ? `${upload.name} fills the front panel.` : "";
  } else if (upload && template.id === CUSTOM_ID && custom && custom.upload.id === upload.id) {
    result = customArt(upload, custom.layout, numberInput("length"));
    status.textContent = custom.layout.guessed
      ? `${upload.name}: the panel edges are a guess. Move the panel lines to fit.`
      : `${upload.name} was read as a four-panel carton. Move the panel lines if an edge is off.`;
    if (custom.layout.guessed) status.classList.add("warn");
  } else if (upload) {
    const fit = fitUpload(upload.source, upload.width, upload.height, dieline, bleed());
    result = fit.art;
    if (fit.mismatch > 0.03) {
      status.textContent =
        `${upload.name} is a different shape from this dieline, so it was stretched to fit. ` +
        "Export the whole artboard of the downloaded template, or check the sizes match.";
      status.classList.add("warn");
    } else {
      status.textContent = `${upload.name} matched ${fit.region}.`;
    }
  } else {
    result = sampleArt(dieline, template, bleed());
    status.textContent = "";
  }
  el("sampleChip").hidden = upload !== null;
  artCache = { key, art: result };
  return result;
}

function paint(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  if (!current) return;
  if (template.kind === "pouch") {
    renderPouch(ctx, width, height, current, art(), { side: studio.side, finish: finish() });
  } else {
    renderBox(ctx, width, height, current, template, art(), {
      yaw: studio.yaw,
      pitch: studio.pitch,
      inside: el<HTMLSelectElement>("inside").value === "kraft" ? "kraft" : "white",
      finish: finish(),
    });
  }
}

function renderMockup(): void {
  if (!current) return;
  const [width, height, ctx] = sizeCanvas(mockCanvas);
  paint(ctx, width, height);
}

function syncStudio(): void {
  const front = studio.mode === "front";
  el("modeFull").setAttribute("aria-pressed", String(!front));
  el("modeFront").setAttribute("aria-pressed", String(front));
  el("fillField").hidden = !front;
  el("turnField").hidden = !front;
  el("modeHint").textContent = front
    ? "Use one image for the front. The rest of the pack takes the pack colour."
    : "Design on the downloaded SVG or PDF template, hide the dieline layers, and export the whole artboard as an image.";
  el("bgClear").setAttribute("aria-pressed", String(studio.background === "clear"));
  el("bgWhite").setAttribute("aria-pressed", String(studio.background === "white"));
  stage.classList.toggle("clear", studio.background === "clear");
  el("detect").hidden = !(studio.upload && !front && template.kind === "carton");
  el("sideFront").setAttribute("aria-pressed", String(studio.side === "front"));
  el("sideBack").setAttribute("aria-pressed", String(studio.side === "back"));
}

const ACCEPTED = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];

async function loadDesign(file: File): Promise<void> {
  const status = el("artStatus");
  status.classList.add("warn");
  if (!ACCEPTED.includes(file.type)) {
    status.textContent = "Use a PNG, JPG, WebP or SVG image. Export a PDF design as PNG first.";
    return;
  }
  if (file.size > 60 * 1024 * 1024) {
    status.textContent = "That file is larger than 60 MB. Export a smaller image.";
    return;
  }
  status.classList.remove("warn");
  status.textContent = `Opening ${file.name}…`;
  const image = await openImage(file);
  if (!image) {
    status.classList.add("warn");
    status.textContent =
      file.type === "image/svg+xml"
        ? "That SVG could not be opened. Export it as PNG, or give the SVG a width and height."
        : "That image could not be opened. Try exporting it again as PNG.";
    return;
  }
  studio.upload = { ...image, name: file.name, id: ++uploads };
  artCache = null;
  const upload = studio.upload;
  syncStudio();
  const carton = template.kind === "carton" || template.id === CUSTOM_ID;
  if (studio.mode === "full" && carton) {
    const own = template.id === CUSTOM_ID;
    const fit = !own && current ? fitUpload(upload.source, upload.width, upload.height, current, bleed()) : null;
    // A picture that fits the chosen dieline is used as it is. Anything else is read as its own carton.
    if (own || (fit && fit.mismatch > 0.03)) {
      if (readPicture(upload)) return;
      status.classList.add("warn");
      status.textContent = fit
        ? `${file.name} does not match this dieline, and no panels could be read from it. ` +
          "Save it as a PNG with a transparent background around the dieline, or pick the matching pack style."
        : `No panels could be read from ${file.name}. Save it as a PNG with a transparent background around the dieline.`;
    }
  }
  draw();
  renderMockup();
}

/** Reads the carton in a picture and switches to a template made from it. */
function readPicture(upload: Upload): boolean {
  const layout = readCarton(upload);
  if (!layout) return false;
  custom = { template: customCartonTemplate(layoutFromPixels(layout)), layout, upload };
  if (![...select.options].some((option) => option.value === CUSTOM_ID)) select.add(new Option("From your dieline picture", CUSTOM_ID));
  select.value = CUSTOM_ID;
  fillDefaults();
  update();
  buildGuides();
  return true;
}

/** Finds the dieline in a picture with a transparent background. Numbers come back in picture pixels. */
function readCarton(upload: Upload): PixelLayout | null {
  const scale = Math.min(1, 1600 / Math.max(upload.width, upload.height));
  const w = Math.max(1, Math.round(upload.width * scale));
  const h = Math.max(1, Math.round(upload.height * scale));
  const surface = document.createElement("canvas");
  surface.width = w;
  surface.height = h;
  const ctx = surface.getContext("2d", { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(upload.source, 0, 0, w, h);
  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(0, 0, w, h).data;
  } catch {
    return null;
  }
  const alpha = new Uint8Array(w * h);
  let solid = 0;
  for (let i = 0; i < alpha.length; i++) {
    alpha[i] = data[i * 4 + 3]!;
    if (alpha[i]! > 127) solid++;
  }
  // Without a transparent background there is no outline to read.
  if (solid > alpha.length * 0.97) return null;
  const found = findCarton(alpha, w, h);
  if (!found) return null;
  const back = 1 / scale;
  return {
    ...found,
    breaks: found.breaks.map((value) => value * back) as PixelLayout["breaks"],
    glueLeft: found.glueLeft * back,
    rowTop: found.rowTop * back,
    rowBottom: found.rowBottom * back,
    top: found.top * back,
  };
}

/** Places the picture so each panel line sits on its panel. */
function customArt(upload: Upload, layout: PixelLayout, length: number): Art {
  const front = (layout.lidPanel + 2) % 4;
  const mmPerPixel = length / (layout.breaks[front + 1]! - layout.breaks[front]!);
  return {
    source: upload.source,
    width: upload.width,
    height: upload.height,
    ox: -layout.breaks[0] * mmPerPixel,
    oy: -layout.rowTop * mmPerPixel,
    mmW: upload.width * mmPerPixel,
    mmH: upload.height * mmPerPixel,
  };
}

/* ---------- Panel lines ---------- */

const GUIDE_FIELDS: { label: string; axis: "x" | "y"; get(l: PixelLayout): number; set(l: PixelLayout, v: number): void }[] = [
  { label: "Glue edge", axis: "x", get: (l) => l.glueLeft, set: (l, v) => (l.glueLeft = v) },
  ...[0, 1, 2, 3, 4].map((i) => ({
    label: i === 0 ? "Panel 1 left" : `Panel ${i} | ${i + 1}`.replace(`Panel 4 | 5`, "Panel 4 right"),
    axis: "x" as const,
    get: (l: PixelLayout) => l.breaks[i]!,
    set: (l: PixelLayout, v: number) => (l.breaks[i] = v),
  })),
  { label: "Lid top", axis: "y", get: (l) => l.top, set: (l, v) => (l.top = v) },
  { label: "Walls top", axis: "y", get: (l) => l.rowTop, set: (l, v) => (l.rowTop = v) },
  { label: "Walls bottom", axis: "y", get: (l) => l.rowBottom, set: (l, v) => (l.rowBottom = v) },
];

function buildGuides(): void {
  const box = el("guides");
  const host = el("guideControls");
  if (!custom) {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  const { upload } = custom;
  const rows = GUIDE_FIELDS.map((field) => {
    const row = document.createElement("label");
    row.className = "guide-row";
    const name = document.createElement("span");
    name.textContent = field.label;
    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = "0";
    slider.max = String(field.axis === "x" ? upload.width : upload.height);
    slider.step = "1";
    slider.value = String(Math.round(field.get(custom!.layout)));
    slider.setAttribute("aria-label", field.label);
    slider.addEventListener("input", () => {
      if (!custom) return;
      field.set(custom.layout, Number(slider.value));
      applyGuides();
    });
    row.append(name, slider);
    return row;
  });
  const lid = document.createElement("label");
  lid.className = "guide-row";
  const lidName = document.createElement("span");
  lidName.textContent = "Lid on panel";
  const picker = document.createElement("select");
  for (let i = 0; i < 4; i++) picker.add(new Option(`Panel ${i + 1}`, String(i)));
  picker.value = String(custom.layout.lidPanel);
  picker.addEventListener("change", () => {
    if (!custom) return;
    custom.layout.lidPanel = Number(picker.value) as PixelLayout["lidPanel"];
    applyGuides();
  });
  lid.append(lidName, picker);
  host.replaceChildren(lid, ...rows);
  drawGuides();
}

function applyGuides(): void {
  if (!custom) return;
  const { layout } = custom;
  layout.guessed = false;
  const edges = layout.breaks;
  const ordered = edges.every((value, i) => i === 0 || value > edges[i - 1]!) && layout.rowBottom > layout.rowTop && layout.top < layout.rowTop;
  const error = el("error");
  if (!ordered) {
    error.textContent = "Panel lines must go in order: left to right, and the lid top above the walls.";
    error.hidden = false;
    drawGuides();
    return;
  }
  custom.template = customCartonTemplate(layoutFromPixels({ ...layout, glueLeft: Math.min(layout.glueLeft, edges[0]) }));
  template = custom.template;
  artCache = null;
  update();
  drawGuides();
}

function drawGuides(): void {
  if (!custom) return;
  const view = el<HTMLCanvasElement>("guideView");
  const { upload, layout } = custom;
  const width = 560;
  const scale = width / upload.width;
  view.width = width;
  view.height = Math.max(1, Math.round(upload.height * scale));
  const ctx = view.getContext("2d")!;
  ctx.fillStyle = "#8aa0b4";
  ctx.fillRect(0, 0, view.width, view.height);
  ctx.drawImage(upload.source, 0, 0, view.width, view.height);
  ctx.lineWidth = 1.5;
  const line = (x0: number, y0: number, x1: number, y1: number, colour: string): void => {
    ctx.strokeStyle = colour;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  };
  for (const x of [...layout.breaks, layout.glueLeft]) line(x * scale, 0, x * scale, view.height, "#00e0ff");
  for (const y of [layout.top, layout.rowTop, layout.rowBottom]) line(0, y * scale, view.width, y * scale, "#ffe600");
  const back = layout.lidPanel;
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.font = "600 12px sans-serif";
  ctx.fillText("lid", ((layout.breaks[back]! + layout.breaks[back + 1]!) / 2) * scale - 8, layout.top * scale + 14);
}

type Opened = { source: CanvasImageSource; width: number; height: number };

/**
 * Some pages, such as file previews, block blob: or data: image URLs. So this tries
 * several ways to read the file, starting with one that needs no URL at all.
 */
async function openImage(file: File): Promise<Opened | null> {
  if (file.type !== "image/svg+xml" && typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file);
      if (bitmap.width && bitmap.height) return { source: bitmap, width: bitmap.width, height: bitmap.height };
    } catch {
      // Fall through to the next way.
    }
  }
  const tryUrl = (url: string): Promise<Opened | null> =>
    new Promise((resolve) => {
      const image = new Image();
      image.onload = () =>
        resolve(image.naturalWidth && image.naturalHeight ? { source: image, width: image.naturalWidth, height: image.naturalHeight } : null);
      image.onerror = () => resolve(null);
      image.src = url;
    });
  const blobUrl = URL.createObjectURL(file);
  const fromBlob = await tryUrl(blobUrl);
  // The image keeps its pixels after loading, so the URL can go.
  URL.revokeObjectURL(blobUrl);
  if (fromBlob) return fromBlob;
  const dataUrl = await new Promise<string | null>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
  return dataUrl ? tryUrl(dataUrl) : null;
}

async function saveMockup(): Promise<void> {
  if (!current) return;
  const note = el("mockNote");
  const size = Number(el<HTMLSelectElement>("size").value) || 2500;
  const layer = document.createElement("canvas");
  layer.width = size;
  layer.height = size;
  const ctx = layer.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  paint(ctx, size, size);

  let output = layer;
  if (studio.background === "white") {
    output = document.createElement("canvas");
    output.width = size;
    output.height = size;
    const final = output.getContext("2d")!;
    final.fillStyle = "#ffffff";
    final.fillRect(0, 0, size, size);
    final.drawImage(layer, 0, 0);
  }
  const blob = await new Promise<Blob | null>((resolve) => output.toBlob(resolve, "image/png"));
  if (!blob) {
    note.textContent = "The image was too large for this browser. Choose a smaller size.";
    return;
  }
  const side = template.kind === "pouch" ? `-${studio.side}` : "";
  const filename = `${template.id}${side}-mockup-${studio.background === "white" ? "white" : "transparent"}.png`;
  try {
    if (await saveFile(filename, blob, "image/png")) note.textContent = `Saved ${filename}.`;
  } catch {
    note.textContent = `Could not save ${filename}.`;
  }
}

/* ---------- Events ---------- */

select.addEventListener("change", () => {
  fillDefaults();
  update();
  foldInput.value = "0";
  play(72);
});
el("controls").addEventListener("input", (event) => {
  if (event.target !== select) update();
});
el("controls").addEventListener("submit", (event) => event.preventDefault());
foldInput.addEventListener("input", () => {
  cancelAnimationFrame(animation);
  setFold(Number(foldInput.value));
});
el("play").addEventListener("click", () => play(Number(foldInput.value) > 50 ? 0 : 100));
document.querySelectorAll<HTMLButtonElement>("[data-format]").forEach((button) => {
  button.addEventListener("click", () => void saveDieline(button.dataset.format!));
});

let dragging: { x: number; y: number } | null = null;
canvas.addEventListener("pointerdown", (event) => {
  if (template.kind === "pouch") return;
  dragging = { x: event.clientX, y: event.clientY };
  canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener("pointermove", (event) => {
  if (!dragging) return;
  yaw += (event.clientX - dragging.x) * 0.01;
  pitch = Math.max(-1.5, Math.min(1.5, pitch + (event.clientY - dragging.y) * 0.01));
  dragging = { x: event.clientX, y: event.clientY };
  draw();
});
canvas.addEventListener("pointerup", () => (dragging = null));
canvas.addEventListener("pointercancel", () => (dragging = null));

let turning: { x: number; y: number } | null = null;
mockCanvas.addEventListener("pointerdown", (event) => {
  if (template.kind === "pouch") return;
  turning = { x: event.clientX, y: event.clientY };
  mockCanvas.setPointerCapture(event.pointerId);
});
mockCanvas.addEventListener("pointermove", (event) => {
  if (!turning) return;
  studio.yaw += (event.clientX - turning.x) * 0.008;
  studio.pitch = Math.max(-0.15, Math.min(1.3, studio.pitch + (event.clientY - turning.y) * 0.008));
  turning = { x: event.clientX, y: event.clientY };
  renderMockup();
});
mockCanvas.addEventListener("pointerup", () => (turning = null));
mockCanvas.addEventListener("pointercancel", () => (turning = null));

const studioButton = (id: string, action: () => void): void => {
  el(id).addEventListener("click", () => {
    action();
    syncStudio();
    draw();
    renderMockup();
  });
};
studioButton("modeFull", () => (studio.mode = "full"));
studioButton("modeFront", () => (studio.mode = "front"));
studioButton("bgClear", () => (studio.background = "clear"));
studioButton("bgWhite", () => (studio.background = "white"));
studioButton("sideFront", () => (studio.side = "front"));
studioButton("sideBack", () => (studio.side = "back"));
studioButton("turnArt", () => (studio.turns = (studio.turns + 1) % 4));
for (const id of ["fill", "inside", "finish"]) {
  el(id).addEventListener("input", () => {
    draw();
    renderMockup();
  });
}
input("artFile").addEventListener("change", () => {
  const file = input("artFile").files?.[0];
  if (file) void loadDesign(file);
  input("artFile").value = "";
});
for (const zone of [el("drop"), stage]) {
  zone.addEventListener("dragover", (event) => {
    event.preventDefault();
    el("drop").classList.add("over");
  });
  zone.addEventListener("dragleave", () => el("drop").classList.remove("over"));
  zone.addEventListener("drop", (event) => {
    event.preventDefault();
    el("drop").classList.remove("over");
    const file = event.dataTransfer?.files[0];
    if (file) void loadDesign(file);
  });
}
el("detect").addEventListener("click", () => {
  const upload = studio.upload;
  if (!upload || readPicture(upload)) return;
  const status = el("artStatus");
  status.classList.add("warn");
  status.textContent = `No panels could be read from ${upload.name}. Save it as a PNG with a transparent background around the dieline.`;
});
el("saveMockup").addEventListener("click", () => void saveMockup());

new ResizeObserver(() => {
  draw();
  renderMockup();
}).observe(canvas);
new ResizeObserver(renderMockup).observe(mockCanvas);

input("bleed").value = "3";
input("gsm").value = "350";
fillDefaults();
update();
foldInput.value = "0";
play(72);
void document.fonts?.ready.then(() => {
  artCache = null;
  draw();
  renderMockup();
});

// Inside Claude, saves go through the viewer. That route has no DXF type, so DXF is only offered on the open web.
// Inside a Claude page this offers a save dialog. Elsewhere, such as a file preview,
// `use` may be missing, and plain browser downloads are used instead.
if (typeof window.claude?.use === "function") {
  window.claude
    .use("downloads")
    .then((namespace) => {
      downloads = namespace;
      if (namespace) el("dxf").hidden = true;
    })
    .catch(() => {
      downloads = null;
    });
}
