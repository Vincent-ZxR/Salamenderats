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
