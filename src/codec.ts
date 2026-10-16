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
  const bin = atob(text);
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
  /** Zoom-17 tile keys, see encodeKeys. */
  tiles17: string;
}

export interface ActivityFile {
  version: 1;
  id: string;
  filename: string;
  format: "gpx" | "tcx" | "fit";
  imported: string;
  tiles17: string;
}

export function toPersonFile(name: string, tiles17: Set<number>): PersonFile {
  return { version: 1, name, updated: new Date().toISOString(), tiles17: encodeKeys(tiles17) };
}

export function toActivityFile(activity: {
  id: string;
  filename: string;
  format: "gpx" | "tcx" | "fit";
  imported: string;
  tiles17: Set<number>;
}): ActivityFile {
  return {
    version: 1,
    id: activity.id,
    filename: activity.filename,
    format: activity.format,
    imported: activity.imported,
    tiles17: encodeKeys(activity.tiles17),
  };
}

export function parseActivityFile(json: unknown): {
  id: string;
  filename: string;
  format: "gpx" | "tcx" | "fit";
  imported: string;
  tiles17: Set<number>;
} {
  const f = json as Partial<ActivityFile>;
  if (
    !f ||
    f.version !== 1 ||
    typeof f.id !== "string" ||
    typeof f.filename !== "string" ||
    !["gpx", "tcx", "fit"].includes(f.format as string) ||
    typeof f.imported !== "string" ||
    typeof f.tiles17 !== "string"
  ) {
    throw new Error("Not a valid activity data file");
  }
  return {
    id: f.id,
    filename: f.filename,
    format: f.format as "gpx" | "tcx" | "fit",
    imported: f.imported,
    tiles17: decodeKeys(f.tiles17),
  };
}

export function parsePersonFile(json: unknown): { name: string; tiles17: Set<number> } {
  const f = json as Partial<PersonFile>;
  if (!f || f.version !== 1 || typeof f.name !== "string" || typeof f.tiles17 !== "string") {
    throw new Error("Not a valid squadrats data file");
  }
  return { name: f.name, tiles17: decodeKeys(f.tiles17) };
}
