import {
  DielineError,
  foldPanels,
  generate,
  getTemplate,
  measure,
  templates,
  toDxf,
  toPdf,
  toSvg,
  type BoxParameters,
  type Dieline,
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

for (const option of templates) select.add(new Option(option.name, option.id));

function fillDefaults(): void {
  template = getTemplate(select.value);
  const { defaults, labels } = template;
  for (const key of ["length", "width", "depth", "thickness"] as const) input(key).value = String(defaults[key]);
  el("lengthLabel").textContent = `${labels.length} mm`;
  el("depthLabel").textContent = `${labels.depth} mm`;
  el("widthLabel").textContent = `${labels.width ?? "Width"} mm`;
  el("widthField").hidden = labels.width === null;

  const pouch = template.kind === "pouch";
  el("pouchFields").hidden = !pouch;
  el("thicknessField").hidden = pouch;
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
    const { dieline, verification } = generate(template.id, parameters());
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
  ].join("|");
  if (artCache?.key === key) return artCache.art;

  let result: Art;
  const status = el("artStatus");
  status.classList.remove("warn");
  if (studio.mode === "front") {
    result = frontArt(dieline, template, bleed(), upload, input("fill").value, studio.turns);
    status.textContent = upload ? `${upload.name} fills the front panel.` : "";
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
  draw();
  renderMockup();
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
