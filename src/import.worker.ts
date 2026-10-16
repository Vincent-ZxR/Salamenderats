import { Unzip, UnzipInflate, UnzipPassThrough, gunzipSync, unzipSync } from "fflate";
import { parseFit, parseGpx, parseTcx } from "./parse";
import { addTrack } from "./tiles";

export type WorkerIn = { type: "import"; files: File[] };
export interface ImportedActivity {
  id: string;
  filename: string;
  format: "gpx" | "tcx" | "fit";
  tiles: Float64Array;
}
export type WorkerOut =
  | { type: "progress"; processed: number; skipped: number; current: string }
  | { type: "done"; activities: ImportedActivity[]; processed: number; skipped: number };

const tiles = new Set<number>();
const activities: ImportedActivity[] = [];
let processed = 0;
let skipped = 0;

const decoder = new TextDecoder();
const post = (m: WorkerOut) => (self as unknown as Worker).postMessage(m);

const baseName = (name: string) => name.replace(/\.gz$/i, "");
const kindOf = (name: string) => /\.(gpx|tcx|fit)$/i.exec(baseName(name))?.[1].toLowerCase();
// Strava exports contain planned routes in a "routes/" folder; only activities count.
const isPlannedRoute = (name: string) => /(^|[\\/])routes[\\/]/i.test(name);
const wanted = (name: string) => kindOf(name) !== undefined || /\.zip$/i.test(name);

async function processEntry(name: string, data: Uint8Array): Promise<void> {
  try {
    if (/\.gz$/i.test(name)) data = gunzipSync(data);
    const kind = kindOf(name);
    const activityTiles = new Set<number>();
    if (kind === "gpx") addTrack(activityTiles, parseGpx(decoder.decode(data)));
    else if (kind === "tcx") addTrack(activityTiles, parseTcx(decoder.decode(data)));
    else if (kind === "fit") addTrack(activityTiles, await parseFit(data));
    else return;
    for (const tile of activityTiles) tiles.add(tile);
    const digest = await crypto.subtle.digest(
      "SHA-256",
      data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer,
    );
    const id = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
    activities.push({ id, filename: name, format: kind, tiles: Float64Array.from(activityTiles) });
    processed++;
  } catch {
    skipped++;
  }
  post({ type: "progress", processed, skipped, current: name });
}

async function streamZip(file: File): Promise<void> {
  let queue: Promise<void> = Promise.resolve();
  const unzip = new Unzip();
  unzip.register(UnzipInflate);
  unzip.register(UnzipPassThrough);
  unzip.onfile = (f) => {
    if (kindOf(f.name) === undefined || isPlannedRoute(f.name)) return;
    const chunks: Uint8Array[] = [];
    f.ondata = (err, chunk, final) => {
      if (err) {
        skipped++;
        return;
      }
      chunks.push(chunk);
      if (final) {
        const data = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
        let off = 0;
        for (const c of chunks) {
          data.set(c, off);
          off += c.length;
        }
        queue = queue.then(() => processEntry(f.name, data));
      }
    };
    f.start();
  };

  const reader = file.stream().getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      unzip.push(new Uint8Array(0), true);
      break;
    }
    unzip.push(value);
    // Keeps memory bounded: do not read further until parsed entries are consumed.
    await queue;
  }
  await queue;
}

async function bufferedZip(file: File): Promise<void> {
  const files = unzipSync(new Uint8Array(await file.arrayBuffer()), { filter: (f) => kindOf(f.name) !== undefined && !isPlannedRoute(f.name) });
  for (const [name, data] of Object.entries(files)) await processEntry(name, data);
}

async function handleFile(file: File): Promise<void> {
  if (!wanted(file.name)) {
    skipped++;
    return;
  }
  if (/\.zip$/i.test(file.name)) {
    try {
      await streamZip(file);
    } catch {
      // Some archives (e.g. unusual headers) are not streamable; retry in memory.
      await bufferedZip(file);
    }
  } else {
    await processEntry(file.name, new Uint8Array(await file.arrayBuffer()));
  }
}

self.onmessage = async (e: MessageEvent<WorkerIn>) => {
  if (e.data.type !== "import") return;
  for (const file of e.data.files) await handleFile(file);
  post({ type: "done", activities, processed, skipped });
};
