import "./style.css";
import { decodeTiles, encodeTiles, parsePersonFile, toPersonFile, type PersonFile } from "./codec";
import { MapView } from "./map";
import { FRIENDS, makePerson, mergeInto, mixColor, type Person } from "./person";
import { fetchMaps, saveMap, subscribe, syncEnabled } from "./sync";
import type { FirstSeen } from "./tiles";
import type { WorkerIn, WorkerOut } from "./import.worker";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const LOCAL_KEY = "squadrats.local";
const ME_KEY = "squadrats.me";

const people: Person[] = FRIENDS.map((f) => makePerson(f.name, f.color, new Set()));
const view = new MapView($("map"));

function saveLocal() {
  try {
    const files = people.filter((p) => p.tiles17.size).map((p) => toPersonFile(p.name, p.tiles17, p.first17));
    localStorage.setItem(LOCAL_KEY, JSON.stringify(files));
  } catch {
    alert("Could not save your map in this browser (storage full).");
  }
}

const SEL_KEY = "squadrats.selected";
try {
  const sel = JSON.parse(localStorage.getItem(SEL_KEY) ?? "null") as string[] | null;
  if (Array.isArray(sel)) for (const p of people) p.visible = sel.includes(p.name);
} catch {
  /* keep defaults */
}

let combinedCache: { sources: Person[]; person: Person } | null = null;

/** Person built from the union of the selected players' tiles (null when none selected). */
function combinedPerson(): Person | null {
  const sel = people.filter((p) => p.visible);
  if (!sel.length) return null;
  if (sel.length === 1) return sel[0];
  if (combinedCache && combinedCache.sources.length === sel.length && sel.every((p, i) => p === combinedCache!.sources[i])) {
    return combinedCache.person;
  }
  const union = new Set<number>();
  for (const p of sel) for (const k of p.tiles17) union.add(k);
  const person = makePerson(sel.map((p) => p.name).join("+"), mixColor(sel), union);
  combinedCache = { sources: sel, person };
  return person;
}

let current: Person | null = null;

function refresh(fit?: Person) {
  current = combinedPerson();
  renderPlayers();
  renderStats();
  void view.render(
    people,
    $<HTMLInputElement>("show14").checked,
    $<HTMLInputElement>("show17").checked,
    $<HTMLInputElement>("showMap").checked,
    current,
  );
  if (fit) view.fitTo(fit);
}

/** Merges tiles into a person; `changed` is false when they were all known already. */
function addTiles(name: string, tiles17: Set<number>, first17: FirstSeen = new Map()): { person: Person; changed: boolean } {
  const idx = people.findIndex((p) => p.name === name);
  const known = people[idx].tiles17;
  const knownFirst = people[idx].first17;
  let changed = false;
  for (const k of tiles17) {
    if (!known.has(k)) {
      changed = true;
      break;
    }
  }
  if (!changed) {
    for (const [k, day] of first17) {
      const prev = knownFirst.get(k);
      if (prev === undefined || day < prev) {
        changed = true;
        break;
      }
    }
  }
  if (changed) people[idx] = mergeInto(people[idx], tiles17, first17);
  return { person: people[idx], changed };
}

function renderPlayers() {
  $("players").innerHTML = people
    .map(
      (p) =>
        `<button type="button" class="player" role="switch" aria-pressed="${p.visible}" aria-checked="${p.visible}" data-name="${p.name}" style="--c:${p.color}"><span class="swatch"></span>${p.name}</button>`,
    )
    .join("");
}

function renderStats() {
  const sel = people.filter((p) => p.visible);
  $("stats-title").textContent = sel.length ? `Stats · ${sel.map((p) => p.name).join(" + ")}` : "Stats";
  if (!current) {
    $("stats").innerHTML = `<div class="empty">Select at least one player.</div>`;
    return;
  }
  const p = current;
  $("stats").innerHTML = `
    <div class="card">
      <div class="sub">Squadrats</div>
      <table>
        <tr class="go" data-kind="dense14" title="Zoom on the densest area"><td>All</td><td>${p.stats14.count}</td></tr>
        <tr class="go" data-kind="uber14" title="Zoom on the Übersquadrat"><td>Übersquadrat</td><td>${p.stats14.maxSquare} × ${p.stats14.maxSquare}</td></tr>
        <tr class="go" data-kind="yard14" title="Zoom on the Yard"><td>Yard</td><td>${p.stats14.maxCluster}</td></tr>
      </table>
      <div class="sub">Squadratinhos</div>
      <table>
        <tr class="go" data-kind="dense17" title="Zoom on the densest area"><td>All</td><td>${p.stats17.count}</td></tr>
        <tr class="go" data-kind="uber17" title="Zoom on the Übersquadratinho"><td>Übersquadratinho</td><td>${p.stats17.maxSquare} × ${p.stats17.maxSquare}</td></tr>
        <tr class="go" data-kind="yard17" title="Zoom on the Yardinho"><td>Yardinho</td><td>${p.stats17.maxCluster}</td></tr>
      </table>
    </div>`;
}

$("players").addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLElement>("[data-name]");
  const person = people.find((p) => p.name === btn?.dataset.name);
  if (!person) return;
  person.visible = !person.visible;
  localStorage.setItem(SEL_KEY, JSON.stringify(people.filter((p) => p.visible).map((p) => p.name)));
  refresh();
});

$("stats").addEventListener("click", (e) => {
  const row = (e.target as HTMLElement).closest<HTMLElement>("tr.go");
  const kind = row?.dataset.kind;
  if (!kind || !current) return;
  const z = kind.endsWith("17") ? 17 : 14;
  if (kind.startsWith("dense")) {
    void view.fitDensest(current, z);
    return;
  }
  const stats = z === 17 ? current.stats17 : current.stats14;
  if (kind.startsWith("uber") && stats.maxSquareAt) {
    void view.highlightSquare(stats.maxSquareAt, stats.maxSquare, z, current.color);
  } else if (kind.startsWith("yard") && stats.maxClusterBox) {
    void view.highlightYard(stats.maxClusterTiles, z, stats.maxClusterBox, current.color);
  }
});

const importDialog = $<HTMLDialogElement>("import-dialog");
$("open-import").addEventListener("click", () => importDialog.showModal());
importDialog.addEventListener("click", (e) => {
  if (e.target === importDialog) importDialog.close();
});

$("show14").addEventListener("change", () => refresh());
$("show17").addEventListener("change", () => refresh());
$("showMap").addEventListener("change", () => refresh());
$("showDates").addEventListener("change", () => (view.showDates = $<HTMLInputElement>("showDates").checked));

const nameSelect = $<HTMLSelectElement>("name");
nameSelect.innerHTML = FRIENDS.map((f) => `<option value="${f.name}">${f.name}</option>`).join("");
const savedMe = localStorage.getItem(ME_KEY);
if (savedMe && FRIENDS.some((f) => f.name === savedMe)) nameSelect.value = savedMe;
nameSelect.addEventListener("change", () => localStorage.setItem(ME_KEY, nameSelect.value));

// Import
const progress = $("progress");
let importing = false;

function runImport(files: File[]) {
  const name = nameSelect.value;
  if (importing || !files.length) return;
  importing = true;
  const replace = $<HTMLInputElement>("replace").checked;
  const worker = new Worker(new URL("./import.worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (e: MessageEvent<WorkerOut>) => {
    const m = e.data;
    if (m.type === "progress") {
      progress.textContent = `Processed ${m.processed} activities (${m.skipped} skipped)…`;
      return;
    }
    importing = false;
    worker.terminate();
    const imported = new Set(m.tiles);
    const importedFirst: FirstSeen = new Map();
    for (let i = 0; i + 1 < m.dates.length; i += 2) importedFirst.set(m.dates[i], m.dates[i + 1]);
    if (replace) {
      const idx = people.findIndex((p) => p.name === name);
      const fresh = makePerson(name, people[idx].color, imported, importedFirst);
      fresh.visible = people[idx].visible;
      people[idx] = fresh;
    }
    const { person } = addTiles(name, imported, importedFirst);
    saveLocal();
    const summary = `Done: ${m.processed} activities imported for ${name}, ${m.skipped} skipped.`;
    progress.textContent = summary;
    refresh(person);
    if (syncEnabled) {
      progress.textContent = `${summary} Sharing…`;
      push(person).then(
        () => (progress.textContent = `${summary} Shared with your friends ✓`),
        (err: Error) => {
          if (/wrong passcode/i.test(err.message)) {
            alert(
              "Mot de passe incorrect. Vos activités ont été importées sur cet appareil, mais elles n'ont pas été partagées.",
            );
          }
          progress.textContent = `${summary} Could not share: ${err.message}`;
        },
      );
    }
  };
  worker.onerror = (e) => {
    importing = false;
    worker.terminate();
    // Worker load failures give a bare Event with no message.
    progress.textContent = `Import failed: ${e.message || "the import worker could not start (try a hard refresh)"}`;
  };
  progress.textContent = "Starting…";
  worker.postMessage({ type: "import", files } satisfies WorkerIn);
}

const drop = $("drop");
const fileInput = $<HTMLInputElement>("files");
drop.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => {
  runImport([...(fileInput.files ?? [])]);
  fileInput.value = "";
});
drop.addEventListener("dragover", (e) => {
  e.preventDefault();
  drop.classList.add("over");
});
drop.addEventListener("dragleave", () => drop.classList.remove("over"));
drop.addEventListener("drop", (e) => {
  e.preventDefault();
  drop.classList.remove("over");
  runImport([...(e.dataTransfer?.files ?? [])]);
});

const push = (person: Person) => saveMap(person.name, encodeTiles(person.tiles17, person.first17));

/** Replaces the cached view with the shared maps after a successful remote read. */
async function pull(): Promise<void> {
  const remote = await fetchMaps();
  const remoteTiles = new Map(remote.map((r) => [r.name, decodeTiles(r.tiles)]));
  let changed = false;
  for (let idx = 0; idx < people.length; idx++) {
    const person = people[idx];
    const { tiles17: tiles, first17 } = remoteTiles.get(person.name) ?? { tiles17: new Set<number>(), first17: new Map() };
    const same = person.tiles17.size === tiles.size && [...person.tiles17].every((tile) => tiles.has(tile));
    if (!same || first17.size > person.first17.size) {
      const replacement = makePerson(person.name, person.color, tiles, first17);
      replacement.visible = person.visible;
      people[idx] = replacement;
      changed = true;
    }
  }
  if (changed) {
    saveLocal();
    refresh();
  }
}

function startSync() {
  const sync = () => pull().catch((err: Error) => console.warn("Sync failed", err));
  pull().catch((err: Error) => console.warn("Sync failed", err));
  subscribe(sync);
  window.addEventListener("focus", sync);
}

// Startup: restore what was imported earlier in this browser
function init() {
  try {
    const saved = JSON.parse(localStorage.getItem(LOCAL_KEY) ?? "[]") as PersonFile[];
    for (const f of saved) {
      const parsed = parsePersonFile(f);
      if (people.some((p) => p.name === parsed.name)) addTiles(parsed.name, parsed.tiles17, parsed.first17);
    }
  } catch (err) {
    console.warn("Could not read saved data", err);
  }
  const me = people.find((p) => p.name === nameSelect.value);
  refresh(me?.tiles17.size ? me : undefined);
  if (syncEnabled) startSync();
}

init();
