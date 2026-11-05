/** A 2D point in millimetres. +x points right and +y points down, as in SVG. */
export type Vec2 = readonly [x: number, y: number];

/** Geometric tolerance in millimetres (one micron). */
export const TOLERANCE = 1e-3;

export function signedArea(polygon: readonly Vec2[]): number {
  let sum = 0;
  for (let i = 0; i < polygon.length; i++) {
    const [x0, y0] = polygon[i]!;
    const [x1, y1] = polygon[(i + 1) % polygon.length]!;
    sum += x0 * y1 - x1 * y0;
  }
  return sum / 2;
}

export function area(polygon: readonly Vec2[]): number {
  return Math.abs(signedArea(polygon));
}

export function centroid(polygon: readonly Vec2[]): Vec2 {
  const a = signedArea(polygon);
  if (Math.abs(a) < 1e-12) {
    const n = polygon.length;
    return [
      polygon.reduce((s, p) => s + p[0], 0) / n,
      polygon.reduce((s, p) => s + p[1], 0) / n,
    ];
  }
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < polygon.length; i++) {
    const [x0, y0] = polygon[i]!;
    const [x1, y1] = polygon[(i + 1) % polygon.length]!;
    const cross = x0 * y1 - x1 * y0;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  }
  return [cx / (6 * a), cy / (6 * a)];
}

export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

export function samePoint(a: Vec2, b: Vec2, tolerance = TOLERANCE): boolean {
  return distance(a, b) <= tolerance;
}

/** Stable hash key for a point, snapped to a one-micron grid. */
export function pointKey(p: Vec2): string {
  return `${Math.round(p[0] * 1000)},${Math.round(p[1] * 1000)}`;
}

/** Stable, direction-independent key for an edge. */
export function edgeKey(a: Vec2, b: Vec2): string {
  const ka = pointKey(a);
  const kb = pointKey(b);
  return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
}

/** Position of `p` along segment a→b (0..1), or null if `p` is not on the segment. */
export function parameterOnSegment(p: Vec2, a: Vec2, b: Vec2): number | null {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return null;
  const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lengthSquared;
  if (t < -1e-9 || t > 1 + 1e-9) return null;
  const projected: Vec2 = [a[0] + t * dx, a[1] + t * dy];
  return samePoint(p, projected) ? t : null;
}

function orientation(a: Vec2, b: Vec2, c: Vec2): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

/** True when two segments cross at a point interior to both. Shared endpoints do not count. */
export function segmentsCross(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const eps = 1e-9;
  const d1 = orientation(c, d, a);
  const d2 = orientation(c, d, b);
  const d3 = orientation(a, b, c);
  const d4 = orientation(a, b, d);
  return (
    ((d1 > eps && d2 < -eps) || (d1 < -eps && d2 > eps)) &&
    ((d3 > eps && d4 < -eps) || (d3 < -eps && d4 > eps))
  );
}

/** Removes vertices that lie on the straight line between their neighbours. */
export function simplifyClosed(points: readonly Vec2[]): Vec2[] {
  const n = points.length;
  return points.filter((p, i) => {
    const prev = points[(i - 1 + n) % n]!;
    const next = points[(i + 1) % n]!;
    return parameterOnSegment(p, prev, next) === null;
  });
}

/** Points along a circular arc, inclusive of both ends. Angles are in degrees. */
export function arc(
  center: Vec2,
  radius: number,
  startDegrees: number,
  endDegrees: number,
  steps = 8,
): Vec2[] {
  const points: Vec2[] = [];
  for (let i = 0; i <= steps; i++) {
    const radians = ((startDegrees + ((endDegrees - startDegrees) * i) / steps) * Math.PI) / 180;
    points.push([center[0] + radius * Math.cos(radians), center[1] + radius * Math.sin(radians)]);
  }
  return points;
}

export function rect(x0: number, y0: number, x1: number, y1: number): Vec2[] {
  return [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ];
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
}

export function bounds(points: readonly Vec2[]): Bounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}
