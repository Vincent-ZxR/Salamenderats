import "./style.css";
import { decodeKeys, encodeKeys, parsePersonFile, toPersonFile, type PersonFile } from "./codec";
import { MapView } from "./map";
import { FRIENDS, makePerson, mergeInto, type Person } from "./person";
import { fetchMaps, saveMap, subscribe, syncEnabled } from "./sync";
import type { WorkerIn, WorkerOut } from "./import.worker";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const LOCAL_KEY = "squadrats.local";
const ME_KEY = "squadrats.me";

const people: Person[] = FRIENDS.map((f) => makePerson(f.name, f.color, new Set()));
const view = new MapView($("map"));

function saveLocal() {
  try {
    const files = people.filter((p) => p.tiles17.size).map((p) => toPersonFile(p.name, p.tiles17));
    localStorage.setItem(LOCAL_KEY, JSON.stringify(files));
  } catch {
    alert("Could not save your map in this browser (storage full).");
  }
}

function refresh(fit?: Person) {
  renderList();
  void view.render(people, $<HTMLInputElement>("show14").checked, $<HTMLInputElement>("show17").checked);
  if (fit) view.fitTo(fit);
}

/** Merges tiles into a person; `changed` is false when they were all known already. */
function addTiles(name: string, tiles17: Set<number>): { person: Person; changed: boolean } {
  const idx = people.findIndex((p) => p.name === name);
  const known = people[idx].tiles17;
  let changed = false;
  for (const k of tiles17) {
    if (!known.has(k)) {
      changed = true;
      break;
    }
  }
  if (changed) people[idx] = mergeInto(people[idx], tiles17);
  return { person: people[idx], changed };
}

function renderList() {
  $("people").innerHTML = people
    .map(
      (p) => `
    <div class="person" data-id="${p.id}">
      <header>
        <input type="checkbox" data-act="toggle" ${p.visible ? "checked" : ""} />
        <span class="swatch" style="background:${p.color}"></span>
        <span>${p.name}</span>
      </header>
      <table>
        <tr><td>Squadrats</td><td>${p.stats14.count}</td></tr>
        <tr class="go" data-act="go" data-kind="uber14" title="Zoom on the Übersquadrat"><td>Übersquadrat</td><td>${p.stats14.maxSquare} × ${p.stats14.maxSquare}</td></tr>
        <tr class="go" data-act="go" data-kind="yard14" title="Zoom on the Yard"><td>Yard</td><td>${p.stats14.maxCluster}</td></tr>
        <tr><td>Squadratinhos</td><td>${p.stats17.count}</td></tr>
        <tr class="go" data-act="go" data-kind="uber17" title="Zoom on the Übersquadratinho"><td>Übersquadratinho</td><td>${p.stats17.maxSquare} × ${p.stats17.maxSquare}</td></tr>
        <tr class="go" data-act="go" data-kind="yard17" title="Zoom on the Yardinho"><td>Yardinho</td><td>${p.stats17.maxCluster}</td></tr>
      </table>
    </div>`,
    )
    .join("");
}

$("people").addEventListener("click", (e) => {
  const target = (e.target as HTMLElement).closest<HTMLElement>("[data-act]");
  const act = target?.dataset.act;
  const id = target?.closest<HTMLElement>(".person")?.dataset.id;
  const person = people.find((p) => p.id === id);
  if (!target || !act || !person) return;
  if (act === "toggle") {
    person.visible = (target as HTMLInputElement).checked;
    refresh();
  } else if (act === "go") {
    const kind = target.dataset.kind;
    const z = kind?.endsWith("17") ? 17 : 14;
    const stats = z === 17 ? person.stats17 : person.stats14;
    if (kind?.startsWith("uber") && stats.maxSquareAt) {
      const { x, y } = stats.maxSquareAt;
      view.fitToBox({ minX: x, minY: y, maxX: x + stats.maxSquare - 1, maxY: y + stats.maxSquare - 1 }, z);
    } else if (kind?.startsWith("yard") && stats.maxClusterBox) {
      view.fitToBox(stats.maxClusterBox, z);
    }
  }
});

$("show14").addEventListener("change", () => refresh());
$("show17").addEventListener("change", () => refresh());

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
  const worker = new Worker(new URL("./import.worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (e: MessageEvent<WorkerOut>) => {
    const m = e.data;
    if (m.type === "progress") {
      progress.textContent = `Processed ${m.processed} activities (${m.skipped} skipped)…`;
      return;
    }
    importing = false;
    worker.terminate();
    const { person } = addTiles(name, new Set(m.tiles));
    saveLocal();
    const summary = `Done: ${m.processed} activities imported for ${name}, ${m.skipped} skipped.`;
    progress.textContent = summary;
    refresh(person);
    if (syncEnabled) {
      progress.textContent = `${summary} Sharing…`;
      push(person).then(
        () => (progress.textContent = `${summary} Shared with your friends ✓`),
        (err: Error) => (progress.textContent = `${summary} Could not share: ${err.message}`),
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

const push = (person: Person) => saveMap(person.name, encodeKeys(person.tiles17));

/** Replaces the cached view with the shared maps after a successful remote read. */
async function pull(): Promise<void> {
  const remote = await fetchMaps();
  const remoteTiles = new Map(remote.map((r) => [r.name, decodeKeys(r.tiles)]));
  let changed = false;
  for (let idx = 0; idx < people.length; idx++) {
    const person = people[idx];
    const tiles = remoteTiles.get(person.name) ?? new Set<number>();
    const same = person.tiles17.size === tiles.size && [...person.tiles17].every((tile) => tiles.has(tile));
    if (!same) {
      const replacement = makePerson(person.name, person.color, tiles);
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
      if (people.some((p) => p.name === parsed.name)) addTiles(parsed.name, parsed.tiles17);
    }
  } catch (err) {
    console.warn("Could not read saved data", err);
  }
  const me = people.find((p) => p.name === nameSelect.value);
  refresh(me?.tiles17.size ? me : undefined);
  if (syncEnabled) startSync();
}

init();
