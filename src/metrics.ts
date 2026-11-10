import { area, distance, type Vec2 } from "./geometry.js";
import type { Dieline } from "./model.js";

export interface Metrics {
  /** Bounding size of the flat blank in mm. */
  blankWidth: number;
  blankHeight: number;
  /** Board area of one blank in mm². */
  boardArea: number;
  /** Share of the blank's bounding rectangle that is board, from 0 to 1. */
  rectangleUse: number;
  cutLength: number;
  creaseLength: number;
  /** Weight of one blank in grams, when a grammage is given. */
  weightGrams?: number;
}

function pathLength(path: readonly Vec2[]): number {
  return path.reduce((sum, point, i) => sum + distance(point, path[(i + 1) % path.length]!), 0);
}

export function measure(dieline: Dieline, gsm?: number): Metrics {
  const holes = dieline.innerCuts.reduce((sum, hole) => sum + area(hole), 0);
  const boardArea = dieline.panels.reduce((sum, panel) => sum + panel.area, 0) - holes;
  const { width, height } = dieline.bounds;
  return {
    blankWidth: width,
    blankHeight: height,
    boardArea,
    rectangleUse: boardArea / (width * height),
    cutLength: [dieline.cut, ...dieline.innerCuts].reduce((sum, path) => sum + pathLength(path), 0),
    creaseLength: dieline.creases.reduce((sum, c) => sum + distance(c.from, c.to), 0),
    ...(gsm === undefined ? {} : { weightGrams: (boardArea / 1e6) * gsm }),
  };
}

export interface ImpositionOptions {
  sheetWidth: number;
  sheetHeight: number;
  /** Gap between blanks in mm. Defaults to 5. */
  gutter?: number;
  /** Unprintable margin on each sheet edge in mm. Defaults to 10. */
  margin?: number;
}

export interface Imposition {
  count: number;
  columns: number;
  rows: number;
  rotated: boolean;
}

/** Simple grid count using each blank's bounding rectangle. Real nesting can fit more. */
export function impose(dieline: Dieline, options: ImpositionOptions): Imposition {
  const gutter = options.gutter ?? 5;
  const margin = options.margin ?? 10;
  const usableW = options.sheetWidth - 2 * margin;
  const usableH = options.sheetHeight - 2 * margin;
  const fit = (blankW: number, blankH: number): [number, number] => [
    Math.max(0, Math.floor((usableW + gutter) / (blankW + gutter))),
    Math.max(0, Math.floor((usableH + gutter) / (blankH + gutter))),
  ];
  const { width, height } = dieline.bounds;
  const [columns, rows] = fit(width, height);
  const [turnedColumns, turnedRows] = fit(height, width);
  return turnedColumns * turnedRows > columns * rows
    ? { count: turnedColumns * turnedRows, columns: turnedColumns, rows: turnedRows, rotated: true }
    : { count: columns * rows, columns, rows, rotated: false };
}
