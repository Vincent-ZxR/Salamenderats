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
  /** Size of the largest connected group of tiles with all four neighbours visited. */
  maxCluster: number;
  /** Tiles in the largest connected group of tiles with all four neighbours visited. */
  maxClusterTiles: number[];
  /** Bounding box (inclusive tile coordinates) of the largest yard. */
  maxClusterBox: TileBox | null;
  /** Number of tiles in the longest continuous line. */
  maxLine: number;
  /** Tiles along the longest continuous line, from one end to the other. */
  maxLineTiles: number[];
  /** Bounding box of the longest continuous line. */
  maxLineBox: TileBox | null;
  /** Number of tiles in the longest straight (horizontal or vertical) run. */
  maxStraight: number;
  maxStraightTiles: number[];
  maxStraightBox: TileBox | null;
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

/** Largest 4-connected group of visited tiles whose four neighbours are also visited. */
export function maxCluster(
  keys: Set<number>,
  z: number,
): { size: number; tiles: number[]; box: TileBox | null } {
  const eligible = new Set<number>();
  for (const k of keys) {
    const x = xOf(k, z);
    const y = yOf(k, z);
    if (
      keys.has(keyOf(x + 1, y, z)) &&
      keys.has(keyOf(x - 1, y, z)) &&
      keys.has(keyOf(x, y + 1, z)) &&
      keys.has(keyOf(x, y - 1, z))
    ) {
      eligible.add(k);
    }
  }

  const seen = new Set<number>();
  let best = 0;
  let bestTiles: number[] = [];
  let bestBox: TileBox | null = null;
  for (const start of eligible) {
    if (seen.has(start)) continue;
    let size = 0;
    const tiles: number[] = [];
    const box: TileBox = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    const stack = [start];
    seen.add(start);
    while (stack.length) {
      const k = stack.pop()!;
      size++;
      tiles.push(k);
      const x = xOf(k, z);
      const y = yOf(k, z);
      if (x < box.minX) box.minX = x;
      if (x > box.maxX) box.maxX = x;
      if (y < box.minY) box.minY = y;
      if (y > box.maxY) box.maxY = y;
      for (const n of [keyOf(x + 1, y, z), keyOf(x - 1, y, z), keyOf(x, y + 1, z), keyOf(x, y - 1, z)]) {
        if (eligible.has(n) && !seen.has(n)) {
          seen.add(n);
          stack.push(n);
        }
      }
    }
    if (size > best) {
      best = size;
      bestTiles = tiles;
      bestBox = box;
    }
  }
  return { size: best, tiles: bestTiles, box: bestBox };
}

/** All tiles of the 8-connected group containing `start`. */
function component(keys: Set<number>, z: number, start: number): number[] {
  const seen = new Set<number>([start]);
  const queue = [start];
  for (let i = 0; i < queue.length; i++) {
    const k = queue[i];
    const x = xOf(k, z);
    const y = yOf(k, z);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (!dx && !dy) continue;
        const n = keyOf(x + dx, y + dy, z);
        if (keys.has(n) && !seen.has(n)) {
          seen.add(n);
          queue.push(n);
        }
      }
    }
  }
  return queue;
}

/** Convex hull (monotone chain) of integer points. */
function hull(points: [number, number][]): [number, number][] {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const cross = (o: [number, number], a: [number, number], b: [number, number]) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const build = (input: [number, number][]) => {
    const out: [number, number][] = [];
    for (const p of input) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop();
      out.push(p);
    }
    out.pop();
    return out;
  };
  return [...build(pts), ...build(pts.reverse())];
}

/**
 * Longest line: the largest straight-line distance, in tiles, between two visited tiles of the
 * same 8-connected group. It only depends on tile positions, so adding visited tiles can never
 * reduce it. The farthest pair is always on the convex hull, which keeps the search exact and fast.
 * Returns the shortest path of visited tiles joining the two end tiles, for display.
 */
export function maxLine(keys: Set<number>, z: number): { size: number; tiles: number[]; box: TileBox | null } {
  const seen = new Set<number>();
  let best = -1;
  let ends: [number, number] | null = null;
  for (const start of keys) {
    if (seen.has(start)) continue;
    const tiles = component(keys, z, start);
    for (const k of tiles) seen.add(k);
    const h = hull(tiles.map((k) => [xOf(k, z), yOf(k, z)]));
    for (let i = 0; i < h.length; i++) {
      for (let j = i + 1; j < h.length; j++) {
        const d = Math.hypot(h[i][0] - h[j][0], h[i][1] - h[j][1]);
        if (d > best) {
          best = d;
          ends = [keyOf(h[i][0], h[i][1], z), keyOf(h[j][0], h[j][1], z)];
        }
      }
    }
    if (h.length === 1 && best < 0) ends = [tiles[0], tiles[0]];
    if (h.length === 1 && best < 0) best = 0;
  }
  if (!ends) return { size: 0, tiles: [], box: null };
  const path = shortestPath(keys, z, ends[0], ends[1]);
  const xs = path.map((k) => xOf(k, z));
  const ys = path.map((k) => yOf(k, z));
  const box = { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
  return { size: Math.round(best), tiles: path, box };
}

/** Shortest 8-connected path of visited tiles from `from` to `to`, ends included. */
function shortestPath(keys: Set<number>, z: number, from: number, to: number): number[] {
  const parent = new Map<number, number>([[from, -1]]);
  const queue = [from];
  for (let i = 0; i < queue.length && !parent.has(to); i++) {
    const k = queue[i];
    const x = xOf(k, z);
    const y = yOf(k, z);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const n = keyOf(x + dx, y + dy, z);
        if ((dx || dy) && keys.has(n) && !parent.has(n)) {
          parent.set(n, k);
          queue.push(n);
        }
      }
    }
  }
  const path: number[] = [];
  for (let k = to; k !== -1; k = parent.get(k)!) path.push(k);
  return path.reverse();
}

/** Longest run of consecutive visited tiles along a single row or column. */
export function maxStraight(keys: Set<number>, z: number): { size: number; tiles: number[]; box: TileBox | null } {
  let best: number[] = [];
  for (const k of keys) {
    const x = xOf(k, z);
    const y = yOf(k, z);
    for (const [dx, dy] of [[1, 0], [0, 1]]) {
      if (keys.has(keyOf(x - dx, y - dy, z))) continue;
      const run = [k];
      for (let n = keyOf(x + dx, y + dy, z), i = 2; keys.has(n); i++) {
        run.push(n);
        n = keyOf(x + dx * i, y + dy * i, z);
      }
      if (run.length > best.length) best = run;
    }
  }
  if (!best.length) return { size: 0, tiles: [], box: null };
  const xs = best.map((k) => xOf(k, z));
  const ys = best.map((k) => yOf(k, z));
  const box = { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
  return { size: best.length, tiles: best, box };
}

export function computeStats(keys: Set<number>, z: number): Stats {
  const sq = maxSquare(keys, z);
  const cl = maxCluster(keys, z);
  const line = maxLine(keys, z);
  const straight = maxStraight(keys, z);
  return {
    maxStraight: straight.size,
    maxStraightTiles: straight.tiles,
    maxStraightBox: straight.box,
    maxLine: line.size,
    maxLineTiles: line.tiles,
    maxLineBox: line.box,
    count: keys.size,
    maxSquare: sq.size,
    maxSquareAt: sq.at,
    maxCluster: cl.size,
    maxClusterTiles: cl.tiles,
    maxClusterBox: cl.box,
  };
}
