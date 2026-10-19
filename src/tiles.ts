// Squadrats = zoom-14 Web Mercator tiles, squadratinhos = zoom-17 tiles.
// We store only zoom-17 tiles; a zoom-14 tile is (x >> 3, y >> 3).
export const Z_SQUADRAT = 14;
export const Z_SQUADRATINHO = 17;
export const Z_SHIFT = Z_SQUADRATINHO - Z_SQUADRAT;

// Keys fit in a double: x * 2^z + y < 2^34.
export const keyOf = (x: number, y: number, z = Z_SQUADRATINHO) => x * 2 ** z + y;
export const xOf = (key: number, z = Z_SQUADRATINHO) => Math.floor(key / 2 ** z);
export const yOf = (key: number, z = Z_SQUADRATINHO) => key % 2 ** z;

const MAX_LAT = 85.0511287798;
const N17 = 2 ** Z_SQUADRATINHO;

/** Fractional tile coordinates at zoom 17. */
export function toTileCoords(lat: number, lon: number): [number, number] {
  const clamped = Math.max(-MAX_LAT, Math.min(MAX_LAT, lat));
  const rad = (clamped * Math.PI) / 180;
  const x = ((lon + 180) / 360) * N17;
  const y = ((1 - Math.asinh(Math.tan(rad)) / Math.PI) / 2) * N17;
  return [x, y];
}

/** Lon/lat of the north-west corner of a tile. */
export function tileToLonLat(x: number, y: number, z: number): [number, number] {
  const n = 2 ** z;
  const lon = (x / n) * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;
  return [lon, lat];
}

/** Segments longer than this (in zoom-17 tiles, ~1 km) are treated as GPS dropouts, not interpolated. */
const MAX_INTERPOLATED_TILES = 5;

/** Earliest day (days since 1970) each zoom-17 tile was visited. */
export type FirstSeen = Map<number, number>;

const DAY_MS = 86_400_000;

export function noteVisit(first: FirstSeen, key: number, day: number): void {
  const prev = first.get(key);
  if (prev === undefined || day < prev) first.set(key, day);
}

/** Adds every tile crossed by the segment (tile coordinates), however briefly, by walking the grid. */
export function addSegment(
  tiles: Set<number>,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  first?: FirstSeen,
  day?: number,
): void {
  const add = (x: number, y: number) => {
    const k = keyOf(x, y);
    tiles.add(k);
    if (first && day !== undefined) noteVisit(first, k, day);
  };
  let cx = Math.floor(x0);
  let cy = Math.floor(y0);
  const ex = Math.floor(x1);
  const ey = Math.floor(y1);
  add(cx, cy);
  const dx = x1 - x0;
  const dy = y1 - y0;
  const stepX = Math.sign(dx);
  const stepY = Math.sign(dy);
  let tMaxX = dx > 0 ? (cx + 1 - x0) / dx : dx < 0 ? (x0 - cx) / -dx : Infinity;
  let tMaxY = dy > 0 ? (cy + 1 - y0) / dy : dy < 0 ? (y0 - cy) / -dy : Infinity;
  const tDeltaX = dx !== 0 ? 1 / Math.abs(dx) : Infinity;
  const tDeltaY = dy !== 0 ? 1 / Math.abs(dy) : Infinity;
  while (cx !== ex || cy !== ey) {
    if (cy === ey || (cx !== ex && tMaxX < tMaxY)) {
      cx += stepX;
      tMaxX += tDeltaX;
    } else {
      cy += stepY;
      tMaxY += tDeltaY;
    }
    add(cx, cy);
  }
}

/** Adds every zoom-17 tile touched by a track, including tiles only clipped by a segment. Points are [lat, lon, time ms?]. */
export function addTrack(
  tiles: Set<number>,
  points: Iterable<[number, number, number?]>,
  first?: FirstSeen,
): void {
  let prev: [number, number] | null = null;
  for (const [lat, lon, time] of points) {
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || (lat === 0 && lon === 0)) {
      prev = null;
      continue;
    }
    const day = time !== undefined && Number.isFinite(time) ? Math.floor(time / DAY_MS) : undefined;
    const cur = toTileCoords(lat, lon);
    const k = keyOf(Math.floor(cur[0]), Math.floor(cur[1]));
    tiles.add(k);
    if (first && day !== undefined) noteVisit(first, k, day);
    if (prev) {
      if (Math.hypot(cur[0] - prev[0], cur[1] - prev[1]) <= MAX_INTERPOLATED_TILES) {
        addSegment(tiles, prev[0], prev[1], cur[0], cur[1], first, day);
      }
    }
    prev = cur;
  }
}

/** Zoom-14 tile keys derived from zoom-17 keys. */
export function toSquadrats(tiles17: Iterable<number>): Set<number> {
  const out = new Set<number>();
  for (const k of tiles17) {
    out.add(keyOf(xOf(k) >> Z_SHIFT, yOf(k) >> Z_SHIFT, Z_SQUADRAT));
  }
  return out;
}

/** Earliest visit day of each zoom-14 tile, derived from zoom-17 visit days. */
export function firstOfSquadrats(first17: FirstSeen): FirstSeen {
  const out: FirstSeen = new Map();
  for (const [k, day] of first17) {
    noteVisit(out, keyOf(xOf(k) >> Z_SHIFT, yOf(k) >> Z_SHIFT, Z_SQUADRAT), day);
  }
  return out;
}
