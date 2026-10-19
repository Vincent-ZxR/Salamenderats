import FitParser from "fit-file-parser";

/** A point with NaN coordinates marks a break in the track. */
export type Point = [number, number];
const BREAK: Point = [NaN, NaN];

export function* parseGpx(text: string): Generator<Point> {
  const re = /<trkseg\b|<trkpt\b[^>]*>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m[0].startsWith("<trkseg")) {
      yield BREAK;
      continue;
    }
    const lat = /\blat\s*=\s*["']([^"']+)["']/.exec(m[0]);
    const lon = /\blon\s*=\s*["']([^"']+)["']/.exec(m[0]);
    if (lat && lon) yield [parseFloat(lat[1]), parseFloat(lon[1])];
  }
}

export function* parseTcx(text: string): Generator<Point> {
  const re =
    /<LatitudeDegrees>\s*([^<\s]+)\s*<\/LatitudeDegrees>\s*<LongitudeDegrees>\s*([^<\s]+)\s*<\/LongitudeDegrees>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) yield [parseFloat(m[1]), parseFloat(m[2])];
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
    } else field += c;
  }
  if (field || row.length) rows.push([...row, field]);
  return rows;
}

export const normalizeArchivePath = (name: string) => name.replace(/\\/g, "/").toLowerCase();

/** Archive file names of virtual activities (Zwift etc.) listed in Strava's activities.csv. */
export function virtualActivityFiles(csv: string): Set<string> {
  const [header, ...rows] = parseCsv(csv.replace(/^\uFEFF/, ""));
  const out = new Set<string>();
  if (!header) return out;
  // The archive is localized ("Vélo virtuel", "Nom du fichier"...), so locate columns by content when headers differ.
  const named = header.findIndex((h) => /^(activity type|type d.activit)/i.test(h.trim()));
  const type = named >= 0 ? named : 3;
  const filePattern = /^activities[\\/]/i;
  const file = header.findIndex((_, i) => rows.some((r) => filePattern.test(r[i] ?? "")));
  if (file < 0) return out;
  for (const r of rows) {
    if (/virtu/i.test(r[type] ?? "") && r[file]) out.add(normalizeArchivePath(r[file]));
  }
  return out;
}

export async function parseFit(data: Uint8Array): Promise<Point[]> {
  const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
  const parsed = await new FitParser({ force: true, mode: "list" }).parseAsync(buffer);
  const out: Point[] = [];
  for (const r of parsed.records ?? []) {
    if (typeof r.position_lat === "number" && typeof r.position_long === "number") {
      out.push([r.position_lat, r.position_long]);
    }
  }
  return out;
}
