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

/** BFS over 8-connected visited tiles; returns the last (farthest) tile reached, its distance and the parents. */
function bfs(keys: Set<number>, z: number, from: number): { far: number; dist: number; parent: Map<number, number> } {
  const parent = new Map<number, number>([[from, -1]]);
  const depth = new Map<number, number>([[from, 0]]);
  const queue = [from];
  for (let i = 0; i < queue.length; i++) {
    const k = queue[i];
    const x = xOf(k, z);
    const y = yOf(k, z);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const n = keyOf(x + dx, y + dy, z);
        if ((dx || dy) && keys.has(n) && !parent.has(n)) {
          parent.set(n, k);
          depth.set(n, depth.get(k)! + 1);
          queue.push(n);
        }
      }
    }
  }
  const far = queue[queue.length - 1];
  return { far, dist: depth.get(far)!, parent };
}

/**
 * Longest line: the diameter of the 8-connected groups of visited tiles, i.e. the largest
 * shortest-path distance (in steps between adjacent tiles) between two tiles of the same group.
 * Disconnected groups never contribute. It uses repeated BFS sweeps (double sweep), which is
 * linear in the group size and exact on tree-like shapes. Returns the path joining the two end
 * tiles, for display.
 */
export function maxLine(keys: Set<number>, z: number): { size: number; tiles: number[]; box: TileBox | null } {
  const seen = new Set<number>();
  let best = -1;
  let bestPath: number[] = [];
  for (const start of keys) {
    if (seen.has(start)) continue;
    for (const k of component(keys, z, start)) seen.add(k);
    let a = bfs(keys, z, start).far;
    let sweep = bfs(keys, z, a);
    for (let i = 0; i < 10; i++) {
      const next = bfs(keys, z, sweep.far);
      if (next.dist <= sweep.dist) break;
      a = sweep.far;
      sweep = next;
    }
    // `sweep` was computed from `a`; its parents lead back from sweep.far to a.
    if (sweep.dist > best) {
      best = sweep.dist;
      const path: number[] = [];
      for (let k = sweep.far; k !== -1; k = sweep.parent.get(k)!) path.push(k);
      bestPath = path.reverse();
    }
  }
  if (best < 0) return { size: 0, tiles: [], box: null };
  const xs = bestPath.map((k) => xOf(k, z));
  const ys = bestPath.map((k) => yOf(k, z));
  const box = { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
  return { size: best, tiles: bestPath, box };
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
