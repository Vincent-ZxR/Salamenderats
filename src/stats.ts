import { keyOf, xOf, yOf } from "./tiles";

export interface TileBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface Stats {
  count: number;
  /** Size of the largest fully-visited square (Übersquadrat / Übersquadratinho). */
  maxSquare: number;
  /** Top-left tile of the largest fully-visited square. */
  maxSquareAt: { x: number; y: number } | null;
  /** Size of the largest connected group (Yard / Yardinho). */
  maxCluster: number;
  /** Bounding box (inclusive tile coordinates) of the largest cluster. */
  maxClusterBox: TileBox | null;
}

/** Largest N x N block of visited tiles (dynamic programming on a sparse grid). */
export function maxSquare(keys: Set<number>, z: number) {
  const sorted = [...keys].sort((a, b) => a - b);
  const dp = new Map<number, number>();
  let best = 0;
  let at: { x: number; y: number } | null = null;
  for (const k of sorted) {
    const x = xOf(k, z);
    const y = yOf(k, z);
    const s =
      1 +
      Math.min(
        dp.get(keyOf(x - 1, y, z)) ?? 0,
        dp.get(keyOf(x, y - 1, z)) ?? 0,
        dp.get(keyOf(x - 1, y - 1, z)) ?? 0,
      );
    dp.set(k, s);
    if (s > best) {
      best = s;
      at = { x: x - s + 1, y: y - s + 1 };
    }
  }
  return { size: best, at };
}

/** Size and bounding box of the largest 4-connected group of visited tiles. */
export function maxCluster(keys: Set<number>, z: number): { size: number; box: TileBox | null } {
  const seen = new Set<number>();
  let best = 0;
  let bestBox: TileBox | null = null;
  for (const start of keys) {
    if (seen.has(start)) continue;
    let size = 0;
    const box: TileBox = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    const stack = [start];
    seen.add(start);
    while (stack.length) {
      const k = stack.pop()!;
      size++;
      const x = xOf(k, z);
      const y = yOf(k, z);
      if (x < box.minX) box.minX = x;
      if (x > box.maxX) box.maxX = x;
      if (y < box.minY) box.minY = y;
      if (y > box.maxY) box.maxY = y;
      for (const n of [keyOf(x + 1, y, z), keyOf(x - 1, y, z), keyOf(x, y + 1, z), keyOf(x, y - 1, z)]) {
        if (keys.has(n) && !seen.has(n)) {
          seen.add(n);
          stack.push(n);
        }
      }
    }
    if (size > best) {
      best = size;
      bestBox = box;
    }
  }
  return { size: best, box: bestBox };
}

export function computeStats(keys: Set<number>, z: number): Stats {
  const sq = maxSquare(keys, z);
  const cl = maxCluster(keys, z);
  return {
    count: keys.size,
    maxSquare: sq.size,
    maxSquareAt: sq.at,
    maxCluster: cl.size,
    maxClusterBox: cl.box,
  };
}
