#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { DielineError, generate, getTemplate, measure, templates, toDxf, toPdf, toSvg } from "./index.js";

const HELP = `OpenDieline: packaging dielines that are proven to fold.

Usage:
  opendieline list
  opendieline generate <template> [options]

Options:
  -l, --length <mm>      Inside length
  -w, --width <mm>       Inside width
  -d, --depth <mm>       Inside depth
  -t, --thickness <mm>   Board thickness
      --seal <mm>        Pouch side seal width
      --zipper <mm>      Pouch: distance from the top edge to the zipper
      --corner <mm>      Pouch: top corner radius
      --hang-hole <yes|no>  Pouch: add a hang hole
      --bleed <mm>       Bleed guide (default 3)
      --gsm <g/m2>       Board weight, used to estimate blank weight
  -f, --format <list>    Comma-separated: svg,pdf,dxf,json (default svg,pdf,dxf)
  -o, --out <dir>        Output folder (default .)
  -h, --help             Show this help

Pouches use --length for width, --depth for height and --width for the gusset.

Examples:
  opendieline generate reverse-tuck-end -l 80 -w 40 -d 120 -t 0.5 -o out
  opendieline generate stand-up-pouch -l 140 -w 80 -d 220 --zipper 35 -o out
`;

const FORMATS = ["svg", "pdf", "dxf", "json"] as const;
type Format = (typeof FORMATS)[number];

function numberOption(name: string, value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new DielineError("INVALID_PARAMETER", `--${name} must be a number.`);
  return parsed;
}

function run(argv: string[]): number {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      length: { type: "string", short: "l" },
      width: { type: "string", short: "w" },
      depth: { type: "string", short: "d" },
      thickness: { type: "string", short: "t" },
      seal: { type: "string" },
      zipper: { type: "string" },
      corner: { type: "string" },
      "hang-hole": { type: "string" },
      bleed: { type: "string" },
      gsm: { type: "string" },
      format: { type: "string", short: "f" },
      out: { type: "string", short: "o" },
      help: { type: "boolean", short: "h" },
    },
  });
  const [command, templateId] = positionals;

  if (values.help || !command) {
    console.log(HELP);
    return 0;
  }

  if (command === "list") {
    for (const template of templates) {
      console.log(`${template.id.padEnd(24)} ${template.kind.padEnd(7)} ${template.description}`);
    }
    return 0;
  }

  if (command !== "generate" || !templateId) {
    console.error(HELP);
    return 1;
  }

  const defaults = getTemplate(templateId).defaults;
  const hangHole = values["hang-hole"];
  if (hangHole !== undefined && hangHole !== "yes" && hangHole !== "no") {
    throw new DielineError("INVALID_PARAMETER", "--hang-hole must be yes or no.");
  }
  const parameters = {
    ...defaults,
    length: numberOption("length", values.length, defaults.length),
    width: numberOption("width", values.width, defaults.width),
    depth: numberOption("depth", values.depth, defaults.depth),
    thickness: numberOption("thickness", values.thickness, defaults.thickness),
    ...(values.seal === undefined ? {} : { seal: numberOption("seal", values.seal, 0) }),
    ...(values.zipper === undefined ? {} : { zipper: numberOption("zipper", values.zipper, 0) }),
    ...(values.corner === undefined ? {} : { corner: numberOption("corner", values.corner, 0) }),
    ...(hangHole === undefined ? {} : { hangHole: hangHole === "yes" }),
  };
  const bleed = numberOption("bleed", values.bleed, 3);
  const gsm = values.gsm === undefined ? undefined : numberOption("gsm", values.gsm, 0);

  const formats = (values.format ?? "svg,pdf,dxf").split(",").map((f) => f.trim());
  for (const format of formats) {
    if (!FORMATS.includes(format as Format)) {
      throw new DielineError("INVALID_PARAMETER", `Unknown format "${format}". Use ${FORMATS.join(", ")}.`);
    }
  }

  const { dieline, verification } = generate(templateId, parameters);
  for (const check of verification.checks) {
    console.log(`${check.passed ? "PASS" : "FAIL"}  ${check.name}: ${check.detail}`);
  }
  if (!verification.passed) {
    console.error("Fold verification failed, so no files were written.");
    return 1;
  }

  const metrics = measure(dieline, gsm);
  const out = values.out ?? ".";
  mkdirSync(out, { recursive: true });
  for (const format of formats as Format[]) {
    const path = join(out, `${templateId}.${format}`);
    if (format === "svg") writeFileSync(path, toSvg(dieline, { bleed }));
    if (format === "pdf") writeFileSync(path, toPdf(dieline, { bleed }));
    if (format === "dxf") writeFileSync(path, toDxf(dieline));
    if (format === "json") {
      writeFileSync(path, JSON.stringify({ parameters, metrics, verification, dieline }, null, 2));
    }
    console.log(`Wrote ${path}`);
  }
  console.log(
    `Blank ${metrics.blankWidth.toFixed(1)} × ${metrics.blankHeight.toFixed(1)} mm, ` +
      `board ${(metrics.boardArea / 1e6).toFixed(4)} m²`,
  );
  return 0;
}

try {
  process.exitCode = run(process.argv.slice(2));
} catch (error) {
  if (error instanceof DielineError || (error as NodeJS.ErrnoException).code?.startsWith("ERR_PARSE_ARGS")) {
    console.error(`Error: ${(error as Error).message}`);
    process.exitCode = 1;
  } else {
    throw error;
  }
}
