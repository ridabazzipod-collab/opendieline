import type { Vec2 } from "../geometry.js";
import type { Dieline } from "../model.js";

function line(layer: string, from: Vec2, to: Vec2, height: number): string[] {
  return [
    "0", "LINE",
    "8", layer,
    "10", from[0].toFixed(4),
    "20", (height - from[1]).toFixed(4),
    "30", "0.0",
    "11", to[0].toFixed(4),
    "21", (height - to[1]).toFixed(4),
    "31", "0.0",
  ];
}

function layer(name: string, color: number): string[] {
  return ["0", "LAYER", "2", name, "70", "0", "62", String(color), "6", "CONTINUOUS"];
}

function path(layer: string, points: readonly Vec2[], closed: boolean, shift: (p: Vec2) => Vec2, height: number): string[] {
  const out: string[] = [];
  const count = closed ? points.length : points.length - 1;
  for (let i = 0; i < count; i++) {
    out.push(...line(layer, shift(points[i]!), shift(points[(i + 1) % points.length]!), height));
  }
  return out;
}

/** An R12 ASCII DXF in millimetres, with CUT and CREASE layers for cutting tables. */
export function toDxf(dieline: Dieline): string {
  const { minX, minY, height } = dieline.bounds;
  const shift = ([x, y]: Vec2): Vec2 => [x - minX, y - minY];

  const entities: string[] = [];
  for (const cut of [dieline.cut, ...dieline.innerCuts]) {
    entities.push(...path("CUT", cut, true, shift, height));
  }
  for (const guide of dieline.guides) {
    entities.push(...path(guide.kind.toUpperCase(), guide.points, guide.closed, shift, height));
  }
  for (const crease of dieline.creases) {
    entities.push(...line("CREASE", shift(crease.from), shift(crease.to), height));
  }

  return [
    "0", "SECTION", "2", "HEADER",
    "9", "$ACADVER", "1", "AC1009",
    "9", "$INSUNITS", "70", "4",
    "0", "ENDSEC",
    "0", "SECTION", "2", "TABLES",
    "0", "TABLE", "2", "LAYER", "70", "4",
    ...layer("CUT", 1),
    ...layer("CREASE", 5),
    ...layer("SEAL", 8),
    ...layer("ZIPPER", 3),
    "0", "ENDTAB",
    "0", "ENDSEC",
    "0", "SECTION", "2", "ENTITIES",
    ...entities,
    "0", "ENDSEC",
    "0", "EOF",
    "",
  ].join("\n");
}
