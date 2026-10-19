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

/** BFS (8-connected) from `start`; returns the farthest tile and the parent links. */
function bfs(keys: Set<number>, z: number, start: number) {
  const parent = new Map<number, number>([[start, -1]]);
  const queue = [start];
  let last = start;
  for (let i = 0; i < queue.length; i++) {
    const k = queue[i];
    last = k;
    const x = xOf(k, z);
    const y = yOf(k, z);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (!dx && !dy) continue;
        const n = keyOf(x + dx, y + dy, z);
        if (keys.has(n) && !parent.has(n)) {
          parent.set(n, k);
          queue.push(n);
        }
      }
    }
  }
  return { last, parent, size: queue.length };
}

/**
 * Longest continuous line: the longest shortest path (in tiles) between two visited tiles
 * of the same 8-connected group. Found with repeated double-sweep BFS, which is exact on
 * line-like networks and a very close approximation otherwise.
 */
export function maxLine(keys: Set<number>, z: number): { size: number; tiles: number[]; box: TileBox | null } {
  const seen = new Set<number>();
  let bestPath: number[] = [];
  for (const start of keys) {
    if (seen.has(start)) continue;
    const first = bfs(keys, z, start);
    for (const k of first.parent.keys()) seen.add(k);
    if (first.size <= bestPath.length) continue;
    let from = first.last;
    let path: number[] = [];
    for (let i = 0; i < 4; i++) {
      const sweep = bfs(keys, z, from);
      const p: number[] = [];
      for (let k = sweep.last; k !== -1; k = sweep.parent.get(k)!) p.push(k);
      if (p.length <= path.length) break;
      path = p;
      from = sweep.last;
    }
    if (path.length > bestPath.length) bestPath = path;
  }
  if (!bestPath.length) return { size: 0, tiles: [], box: null };
  const box: TileBox = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const k of bestPath) {
    const x = xOf(k, z);
    const y = yOf(k, z);
    box.minX = Math.min(box.minX, x);
    box.maxX = Math.max(box.maxX, x);
    box.minY = Math.min(box.minY, y);
    box.maxY = Math.max(box.maxY, y);
  }
  return { size: bestPath.length, tiles: bestPath, box };
}

export function computeStats(keys: Set<number>, z: number): Stats {
  const sq = maxSquare(keys, z);
  const cl = maxCluster(keys, z);
  const line = maxLine(keys, z);
  return {
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
