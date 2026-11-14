import { keyOf, xOf, yOf } from "./tiles";

export interface Square {
  x: number;
  y: number;
  size: number;
  z: 14 | 17;
}

export function missingTiles(tiles: Set<number>, square: Square): number[] {
  const missing: number[] = [];
  for (let x = square.x; x < square.x + square.size; x++) {
    for (let y = square.y; y < square.y + square.size; y++) {
      const key = keyOf(x, y, square.z);
      if (!tiles.has(key)) missing.push(key);
    }
  }
  return missing;
}

/** Finds the grid-aligned square with the most visited tiles, breaking ties by x then y. */
export function suggestSquare(tiles: Set<number>, size: number, z: 14 | 17): Square | null {
  if (!tiles.size) return null;
  const limit = 2 ** z - size;
  const events: { x: number; lo: number; hi: number; delta: number }[] = [];
  const ys = new Set<number>();
  for (const key of tiles) {
    const x = xOf(key, z);
    const y = yOf(key, z);
    const left = Math.max(0, x - size + 1);
    const right = Math.min(limit, x);
    const lo = Math.max(0, y - size + 1);
    const hi = Math.min(limit, y);
    events.push({ x: left, lo, hi, delta: 1 }, { x: right + 1, lo, hi, delta: -1 });
    ys.add(lo);
    ys.add(hi + 1);
  }
  const coords = [...ys].sort((a, b) => a - b);
  const indices = new Map(coords.map((y, i) => [y, i]));
  const count = coords.length - 1;
  const max = new Int32Array(count * 4);
  const lazy = new Int32Array(count * 4);

  const add = (node: number, left: number, right: number, lo: number, hi: number, value: number): void => {
    if (lo <= left && right <= hi) {
      max[node] += value;
      lazy[node] += value;
      return;
    }
    const mid = Math.floor((left + right) / 2);
    if (lo <= mid) add(node * 2, left, mid, lo, hi, value);
    if (hi > mid) add(node * 2 + 1, mid + 1, right, lo, hi, value);
    max[node] = lazy[node] + Math.max(max[node * 2], max[node * 2 + 1]);
  };
  const bestY = (): number => {
    let node = 1, left = 0, right = count - 1;
    while (left < right) {
      const mid = Math.floor((left + right) / 2);
      if (max[node * 2] >= max[node * 2 + 1]) {
        node *= 2;
        right = mid;
      } else {
        node = node * 2 + 1;
        left = mid + 1;
      }
    }
    return coords[left];
  };

  events.sort((a, b) => a.x - b.x);
  let best = 0;
  let square: Square | null = null;
  for (let i = 0; i < events.length;) {
    const x = events[i].x;
    while (i < events.length && events[i].x === x) {
      const event = events[i++];
      add(1, 0, count - 1, indices.get(event.lo)!, indices.get(event.hi + 1)! - 1, event.delta);
    }
    if (x <= limit && max[1] > best) {
      best = max[1];
      square = { x, y: bestY(), size, z };
    }
  }
  return square;
}
