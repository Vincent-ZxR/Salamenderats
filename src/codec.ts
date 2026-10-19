/** Compact, text-safe encoding of a set of tile keys: sorted, delta + varint, base64. */
export function encodeKeys(keys: Iterable<number>): string {
  const sorted = [...keys].sort((a, b) => a - b);
  const bytes: number[] = [];
  let prev = 0;
  for (const k of sorted) {
    let d = k - prev;
    prev = k;
    while (d >= 128) {
      bytes.push((d % 128) + 128);
      d = Math.floor(d / 128);
    }
    bytes.push(d);
  }
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.slice(i, i + 0x8000));
  }
  return btoa(bin);
}

export function decodeKeys(text: string): Set<number> {
  const bin = atob(text.split(".")[0]);
  const out = new Set<number>();
  let prev = 0;
  let value = 0;
  let mul = 1;
  for (let i = 0; i < bin.length; i++) {
    const b = bin.charCodeAt(i);
    value += (b & 127) * mul;
    if (b & 128) {
      mul *= 128;
    } else {
      prev += value;
      out.add(prev);
      value = 0;
      mul = 1;
    }
  }
  return out;
}

export interface PersonFile {
  version: 1;
  name: string;
  updated: string;
  /** Zoom-17 tile keys, see encodeTiles (the dates part is optional). */
  tiles17: string;
}

// Days are stored relative to 2000-01-01; 0 means "unknown".
const DAY_2000 = 10957;

/** Tile keys, optionally followed by "." and a varint first-visit day per key (in sorted key order). */
export function encodeTiles(keys: Iterable<number>, first?: Map<number, number>): string {
  const sorted = [...keys].sort((a, b) => a - b);
  const head = encodeKeys(sorted);
  if (!first?.size) return head;
  const bytes: number[] = [];
  for (const k of sorted) {
    const day = first.get(k);
    let v = day === undefined ? 0 : Math.max(1, day - DAY_2000 + 1);
    while (v >= 128) {
      bytes.push((v % 128) + 128);
      v = Math.floor(v / 128);
    }
    bytes.push(v);
  }
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.slice(i, i + 0x8000));
  return `${head}.${btoa(bin)}`;
}

export function decodeTiles(text: string): { tiles17: Set<number>; first17: Map<number, number> } {
  const tiles17 = decodeKeys(text);
  const first17 = new Map<number, number>();
  const datePart = text.split(".")[1];
  if (datePart) {
    const bin = atob(datePart);
    const keys = [...tiles17];
    let i = 0;
    let idx = 0;
    let value = 0;
    let mul = 1;
    for (; i < bin.length && idx < keys.length; i++) {
      const b = bin.charCodeAt(i);
      value += (b & 127) * mul;
      if (b & 128) {
        mul *= 128;
      } else {
        if (value > 0) first17.set(keys[idx], value - 1 + DAY_2000);
        idx++;
        value = 0;
        mul = 1;
      }
    }
  }
  return { tiles17, first17 };
}

export function toPersonFile(name: string, tiles17: Set<number>, first17?: Map<number, number>): PersonFile {
  return { version: 1, name, updated: new Date().toISOString(), tiles17: encodeTiles(tiles17, first17) };
}

export function parsePersonFile(json: unknown): { name: string; tiles17: Set<number>; first17: Map<number, number> } {
  const f = json as Partial<PersonFile>;
  if (!f || f.version !== 1 || typeof f.name !== "string" || typeof f.tiles17 !== "string") {
    throw new Error("Not a valid squadrats data file");
  }
  return { name: f.name, ...decodeTiles(f.tiles17) };
}
