import type { PixelLayout } from "./templates/custom.js";

/** Grows (`grow` true) or shrinks a mask by `radius` pixels, one direction at a time. */
function morph(mask: Uint8Array, w: number, h: number, radius: number, grow: boolean): Uint8Array {
  const pass = (input: Uint8Array, horizontal: boolean): Uint8Array => {
    const out = new Uint8Array(input.length);
    const lines = horizontal ? h : w;
    const length = horizontal ? w : h;
    for (let line = 0; line < lines; line++) {
      const at = (i: number): number => (horizontal ? line * w + i : i * w + line);
      // Distance since the last pixel of each kind, so each pixel needs one comparison.
      let last = -Infinity;
      const near = new Float64Array(length);
      for (let i = 0; i < length; i++) {
        if (input[at(i)] === (grow ? 1 : 0)) last = i;
        near[i] = i - last;
      }
      last = Infinity;
      for (let i = length - 1; i >= 0; i--) {
        if (input[at(i)] === (grow ? 1 : 0)) last = i;
        const distance = Math.min(near[i]!, last - i);
        const hit = distance <= radius;
        out[at(i)] = grow ? (hit ? 1 : 0) : hit ? 0 : 1;
      }
    }
    return out;
  };
  return pass(pass(mask, true), false);
}

/** Keeps the largest 4-connected group of set pixels. */
function largest(mask: Uint8Array, w: number, h: number): Uint8Array {
  const seen = new Uint8Array(mask.length);
  let best: number[] = [];
  const stack: number[] = [];
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;
    const group: number[] = [];
    stack.push(start);
    seen[start] = 1;
    while (stack.length) {
      const at = stack.pop()!;
      group.push(at);
      const x = at % w;
      const y = (at - x) / w;
      if (x > 0 && mask[at - 1] && !seen[at - 1]) (seen[at - 1] = 1), stack.push(at - 1);
      if (x < w - 1 && mask[at + 1] && !seen[at + 1]) (seen[at + 1] = 1), stack.push(at + 1);
      if (y > 0 && mask[at - w] && !seen[at - w]) (seen[at - w] = 1), stack.push(at - w);
      if (y < h - 1 && mask[at + w] && !seen[at + w]) (seen[at + w] = 1), stack.push(at + w);
    }
    if (group.length > best.length) best = group;
  }
  const out = new Uint8Array(mask.length);
  for (const at of best) out[at] = 1;
  return out;
}

function median(values: number[]): number {
  const sorted = [...values].sort((p, q) => p - q);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

/**
 * Reads the panels of a carton from the outline of a finished dieline picture.
 * `alpha` has one value per pixel, above 127 where the dieline is. Thin lines, such as
 * a sticker outline around the dieline, are ignored. Returns null if there is no shape.
 */
export function findCarton(alpha: ArrayLike<number>, w: number, h: number): PixelLayout | null {
  const raw = new Uint8Array(w * h);
  for (let i = 0; i < raw.length; i++) raw[i] = alpha[i]! > 127 ? 1 : 0;
  const radius = Math.max(1, Math.round(Math.max(w, h) / 600));
  const mask = largest(morph(morph(raw, w, h, radius, false), w, h, radius, true), w, h);

  const top = new Int32Array(w).fill(-1);
  const bottom = new Int32Array(w).fill(-1);
  let x0 = w;
  let x1 = -1;
  let y0 = h;
  let y1 = -1;
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      if (!mask[y * w + x]) continue;
      if (top[x]! < 0) top[x] = y;
      bottom[x] = y;
    }
    if (top[x]! >= 0) {
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, top[x]!);
      y1 = Math.max(y1, bottom[x]!);
    }
  }
  x1 += 1;
  y0 = Math.max(0, y0);
  const width = x1 - x0;
  const height = y1 + 1 - y0;
  if (width < 40 || height < 20 || width < height * 0.8) return null;

  // A panel edge shows as a sudden jump in the top or bottom of the outline.
  const jump = height * 0.12;
  const found: number[] = [];
  for (let x = x0 + 1; x < x1; x++) {
    if (Math.abs(top[x]! - top[x - 1]!) > jump || Math.abs(bottom[x]! - bottom[x - 1]!) > jump) found.push(x);
  }
  const steps: number[] = [];
  for (const x of found) {
    const previous = steps[steps.length - 1];
    if (previous !== undefined && x - previous < width * 0.015) continue;
    steps.push(x);
  }

  const columns = (from: number, to: number): number[] => {
    const xs: number[] = [];
    for (let x = Math.ceil(from); x < to; x++) if (top[x]! >= 0) xs.push(x);
    return xs;
  };

  let guessed = false;
  let breaks: PixelLayout["breaks"];
  const glueLeft = x0;
  if (steps.length === 4 && steps[0]! - x0 < (x1 - steps[0]!) * 0.12) {
    breaks = [steps[0]!, steps[1]!, steps[2]!, steps[3]!, x1];
  } else if (steps.length === 3) {
    breaks = [x0, steps[0]!, steps[1]!, steps[2]!, x1];
  } else {
    guessed = true;
    const quarter = width / 4;
    breaks = [x0, x0 + quarter, x0 + 2 * quarter, x0 + 3 * quarter, x1];
  }

  // The top of the wall row is the lowest top edge that is flat over a good share of the width.
  const bin = Math.max(1, Math.round(height * 0.01));
  const counts = new Map<number, number[]>();
  for (const x of columns(breaks[0], x1)) {
    const key = Math.round(top[x]! / bin);
    counts.set(key, [...(counts.get(key) ?? []), top[x]!]);
  }
  let rowTop = y0 + height * 0.4;
  let lowest = -Infinity;
  for (const values of counts.values()) {
    if (values.length < width * 0.08) continue;
    const value = median(values);
    if (value > lowest) {
      lowest = value;
      rowTop = value;
    }
  }
  // The bottom edge of the wall row is the highest bottom edge, where the flaps have notches.
  const bottoms = columns(breaks[0], x1).map((x) => bottom[x]!);
  const rowBottom = Math.min(...bottoms);

  // The lid sits on the panel whose outline reaches highest.
  const reach = [0, 1, 2, 3].map((i) => median(columns(breaks[i]!, breaks[i + 1]!).map((x) => top[x]!)));
  const highest = Math.min(...reach);
  const lidPanel = (reach.findIndex((value) => value === highest) % 4) as PixelLayout["lidPanel"];
  const lidReachesUp = highest < rowTop - height * 0.1;

  if (rowBottom <= rowTop) return null;
  return {
    breaks,
    glueLeft,
    rowTop,
    rowBottom,
    top: lidReachesUp ? y0 : rowTop - (rowBottom - rowTop) * 0.5,
    lidPanel: lidReachesUp ? lidPanel : 0,
    guessed: guessed || !lidReachesUp,
  };
}
