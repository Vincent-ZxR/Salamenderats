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

/** Segments longer than this (in zoom-17 tiles) are treated as GPS gaps, not interpolated. */
const MAX_INTERPOLATED_TILES = 40;

/**
 * Adds every zoom-17 tile touched by a track. Consecutive points are
 * interpolated so fast segments do not skip tiles.
 */
export function addTrack(tiles: Set<number>, points: Iterable<[number, number]>): void {
  let prev: [number, number] | null = null;
  for (const [lat, lon] of points) {
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || (lat === 0 && lon === 0)) {
      prev = null;
      continue;
    }
    const cur = toTileCoords(lat, lon);
    tiles.add(keyOf(Math.floor(cur[0]), Math.floor(cur[1])));
    if (prev) {
      const dx = cur[0] - prev[0];
      const dy = cur[1] - prev[1];
      const dist = Math.hypot(dx, dy);
      if (dist > 1 && dist <= MAX_INTERPOLATED_TILES) {
        const steps = Math.ceil(dist / 0.25);
        for (let i = 1; i < steps; i++) {
          const t = i / steps;
          tiles.add(keyOf(Math.floor(prev[0] + dx * t), Math.floor(prev[1] + dy * t)));
        }
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
