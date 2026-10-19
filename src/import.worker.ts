import { Unzip, UnzipInflate, UnzipPassThrough, gunzipSync, unzipSync } from "fflate";
import { normalizeArchivePath, parseFit, parseGpx, parseTcx, virtualActivityFiles } from "./parse";
import { addTrack, type FirstSeen } from "./tiles";

export type WorkerIn = { type: "import"; files: File[] };
export type WorkerOut =
  | { type: "progress"; processed: number; skipped: number; current: string }
  | { type: "done"; tiles: Float64Array; dates: Float64Array; processed: number; skipped: number };

const tiles = new Set<number>();
const first: FirstSeen = new Map();
let processed = 0;
let skipped = 0;

const decoder = new TextDecoder();
const post = (m: WorkerOut) => (self as unknown as Worker).postMessage(m);

const baseName = (name: string) => name.replace(/\.gz$/i, "");
const kindOf = (name: string) => /\.(gpx|tcx|fit)$/i.exec(baseName(name))?.[1].toLowerCase();
const isPlannedRoute = (name: string) => /(^|[\\/])routes[\\/]/i.test(name);
const wanted = (name: string) => kindOf(name) !== undefined || /\.zip$/i.test(name);

// Virtual activities (e.g. Zwift) listed in the archive's activities.csv are not imported.
let virtualFiles = new Set<string>();
const isActivitiesCsv = (name: string) => /(^|[\\/])activities\.csv$/i.test(name);

async function readVirtualFiles(file: File): Promise<Set<string>> {
  try {
    let csv: Uint8Array | undefined;
    const unzip = new Unzip();
    unzip.register(UnzipInflate);
    unzip.register(UnzipPassThrough);
    unzip.onfile = (f) => {
      if (!isActivitiesCsv(f.name)) return;
      const chunks: Uint8Array[] = [];
      f.ondata = (err, chunk, final) => {
        if (err) return;
        chunks.push(chunk);
        if (final) {
          csv = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
          let off = 0;
          for (const c of chunks) {
            csv.set(c, off);
            off += c.length;
          }
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
    }
    return csv ? virtualActivityFiles(decoder.decode(csv)) : new Set();
  } catch {
    try {
      const files = unzipSync(new Uint8Array(await file.arrayBuffer()), { filter: (f) => isActivitiesCsv(f.name) });
      const csv = Object.values(files)[0];
      return csv ? virtualActivityFiles(decoder.decode(csv)) : new Set();
    } catch {
      return new Set();
    }
  }
}

async function processEntry(name: string, data: Uint8Array): Promise<void> {
  if (virtualFiles.has(normalizeArchivePath(name))) {
    skipped++;
    post({ type: "progress", processed, skipped, current: name });
    return;
  }
  try {
    if (/\.gz$/i.test(name)) data = gunzipSync(data);
    const kind = kindOf(name);
    if (kind === "gpx") addTrack(tiles, parseGpx(decoder.decode(data)), first);
    else if (kind === "tcx") addTrack(tiles, parseTcx(decoder.decode(data)), first);
    else if (kind === "fit") addTrack(tiles, await parseFit(data), first);
    else return;
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
  const files = unzipSync(new Uint8Array(await file.arrayBuffer()), {
    filter: (f) => kindOf(f.name) !== undefined && !isPlannedRoute(f.name),
  });
  for (const [name, data] of Object.entries(files)) await processEntry(name, data);
}

async function handleFile(file: File): Promise<void> {
  if (!wanted(file.name)) {
    skipped++;
    return;
  }
  if (/\.zip$/i.test(file.name)) {
    virtualFiles = await readVirtualFiles(file);
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
  post({ type: "done", tiles: Float64Array.from(tiles), dates: Float64Array.from([...first].flat()), processed, skipped });
};
