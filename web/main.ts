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
  type Dieline,
} from "../src/index.js";

interface Downloads {
  save(request: { filename: string; data: string | Uint8Array }): Promise<{ status: string }>;
}
declare global {
  interface Window {
    claude?: { use(name: "downloads"): Promise<Downloads | null> };
  }
}

const el = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const numberInput = (id: string): number => el<HTMLInputElement>(id).valueAsNumber;

const select = el<HTMLSelectElement>("template");
const canvas = el<HTMLCanvasElement>("view");
const context = canvas.getContext("2d")!;
const foldInput = el<HTMLInputElement>("fold");
const note = el("note");
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

let current: Dieline | null = null;
let yaw = -0.7;
let pitch = 0.55;
let animation = 0;
let downloads: Downloads | null = null;

for (const template of templates) select.add(new Option(template.name, template.id));

function fillDefaults(): void {
  const template = getTemplate(select.value);
  for (const key of ["length", "width", "depth", "thickness"] as const) {
    el<HTMLInputElement>(key).value = String(template.defaults[key]);
  }
  el("description").textContent = template.description;
}

function update(): void {
  const error = el("error");
  try {
    const { dieline, verification } = generate(select.value, {
      length: numberInput("length"),
      width: numberInput("width"),
      depth: numberInput("depth"),
      thickness: numberInput("thickness"),
    });
    current = dieline;
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
    const rows: [string, string][] = [
      ["Blank size", `${metrics.blankWidth.toFixed(1)} × ${metrics.blankHeight.toFixed(1)}`],
      ["Board area", `${(metrics.boardArea / 1e6).toFixed(4)} m²`],
      ["Rectangle used", `${(metrics.rectangleUse * 100).toFixed(0)}%`],
      ["Cut length", `${(metrics.cutLength / 1000).toFixed(2)} m`],
      ["Crease length", `${(metrics.creaseLength / 1000).toFixed(2)} m`],
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
  } catch (caught) {
    if (!(caught instanceof DielineError)) throw caught;
    error.textContent = caught.message;
    error.hidden = false;
  }
}

function bleed(): number {
  const value = numberInput("bleed");
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

/** Painter's-algorithm view of the folding blank. No 3D library needed. */
function draw(): void {
  const dieline = current;
  if (!dieline) return;
  const ratio = devicePixelRatio || 1;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (canvas.width !== width * ratio || canvas.height !== height * ratio) {
    canvas.width = width * ratio;
    canvas.height = height * ratio;
  }
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);

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
    // Newell normal, oriented so it points out of the printed side.
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
  const key = (face: (typeof faces)[number]): number =>
    face.depth + (face.role === "flap" ? flapBias : 0);
  faces.sort((p, q) => key(q) - key(p));

  context.lineJoin = "round";
  context.lineWidth = 1;
  for (const face of faces) {
    // In view space the camera looks along +z, so a printed side faces it when nz is not positive.
    const printedSide = face.nz <= 0;
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
  if (reducedMotion) {
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

async function save(format: string): Promise<void> {
  if (!current) return;
  const filename = `${select.value}.${format}`;
  const data: string | Uint8Array =
    format === "svg"
      ? toSvg(current, { bleed: bleed() })
      : format === "pdf"
        ? toPdf(current, { bleed: bleed() })
        : toDxf(current);

  if (downloads) {
    try {
      await downloads.save({ filename, data });
      note.textContent = `Saved ${filename}.`;
    } catch (caught) {
      note.textContent =
        (caught as { code?: string }).code === "declined" ? "" : `Could not save ${filename}.`;
    }
    return;
  }
  const url = URL.createObjectURL(new Blob([data as BlobPart]));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
  note.textContent = `Saved ${filename}.`;
}

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
  button.addEventListener("click", () => void save(button.dataset.format!));
});

let dragging: { x: number; y: number } | null = null;
canvas.addEventListener("pointerdown", (event) => {
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
new ResizeObserver(draw).observe(canvas);

el<HTMLInputElement>("bleed").value = "3";
el<HTMLInputElement>("gsm").value = "350";
fillDefaults();
update();
foldInput.value = "0";
play(72);

// Inside Claude, saves go through the viewer. That route has no DXF type, so DXF is only offered on the open web.
window.claude?.use("downloads").then((namespace) => {
  downloads = namespace;
  if (namespace) el("dxf").hidden = true;
});
