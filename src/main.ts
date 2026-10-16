import "./style.css";
import {
  decodeKeys,
  encodeKeys,
  parseActivityFile,
  parsePersonFile,
  toActivityFile,
  toPersonFile,
  type ActivityFile,
  type PersonFile,
} from "./codec";
import { MapView } from "./map";
import { FRIENDS, makePerson, mergeInto, personFromActivities, type Activity, type Person } from "./person";
import { fetchActivities, fetchMaps, saveActivity, deleteActivity, subscribe, syncEnabled } from "./sync";
import type { WorkerIn, WorkerOut } from "./import.worker";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const LOCAL_KEY = "squadrats.local";
const ACTIVITIES_KEY = "squadrats.activities";
const ME_KEY = "squadrats.me";

let people: Person[] = FRIENDS.map((f) => makePerson(f.name, f.color, new Set()));
const activities = new Map<string, Activity[]>();
const view = new MapView($("map"));
const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);

function saveLocal() {
  try {
    const files = people.filter((p) => p.tiles17.size).map((p) => toPersonFile(p.name, p.tiles17));
    localStorage.setItem(LOCAL_KEY, JSON.stringify(files));
    const imported = [...activities].flatMap(([name, items]) =>
      items.map((activity) => ({ name, ...toActivityFile(activity) })),
    );
    localStorage.setItem(ACTIVITIES_KEY, JSON.stringify(imported));
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

function replaceFromActivities(name: string): void {
  const idx = people.findIndex((p) => p.name === name);
  const current = people[idx];
  const next = personFromActivities(current, activities.get(name) ?? []);
  if (next.tiles17.size || activities.has(name)) people[idx] = next;
}

function addActivity(name: string, activity: Activity): void {
  const current = activities.get(name) ?? [];
  if (!current.some((a) => a.id === activity.id)) current.push(activity);
  activities.set(name, current);
  replaceFromActivities(name);
}

function removeActivity(name: string, id: string): void {
  const remaining = (activities.get(name) ?? []).filter((activity) => activity.id !== id);
  activities.set(name, remaining);
  replaceFromActivities(name);
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
  const rows = FRIENDS.flatMap((friend) =>
    (activities.get(friend.name) ?? []).map(
      (activity) => `
        <div class="activity" data-person="${friend.name}" data-id="${activity.id}">
          <span class="swatch" style="background:${friend.color}"></span>
          <span class="activity-name" title="${escapeHtml(activity.filename)}">${escapeHtml(activity.filename)}</span>
          <small>${activity.format.toUpperCase()}</small>
          <button data-act="delete-activity" title="Remove this activity">Delete</button>
        </div>`,
    ),
  );
  $("activities").innerHTML = rows.length ? rows.join("") : '<p class="hint">No activities imported yet.</p>';
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

$("activities").addEventListener("click", (e) => {
  const target = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-act='delete-activity']");
  const row = target?.closest<HTMLElement>(".activity");
  if (!target || !row) return;
  const name = row.dataset.person!;
  const id = row.dataset.id!;
  const activity = (activities.get(name) ?? []).find((item) => item.id === id);
  if (!activity || !window.confirm(`Remove ${activity.filename} from ${name}'s activities?`)) return;
  removeActivity(name, id);
  saveLocal();
  refresh();
  if (syncEnabled) {
    progress.textContent = "Removing activity…";
    deleteActivity(`${name}:${id}`, name).then(
      () => (progress.textContent = "Activity removed and shared with your friends."),
      (err: Error) => (progress.textContent = `Could not remove activity: ${err.message}`),
    );
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
    for (const imported of m.activities) {
      addActivity(name, {
        id: imported.id,
        filename: imported.filename,
        format: imported.format,
        imported: new Date().toISOString(),
        tiles17: new Set(imported.tiles),
      });
    }
    const person = people.find((p) => p.name === name)!;
    saveLocal();
    const summary = `Done: ${m.processed} activities imported for ${name}, ${m.skipped} skipped.`;
    progress.textContent = summary;
    refresh(person);
    if (syncEnabled) {
      progress.textContent = `${summary} Sharing…`;
      Promise.all((activities.get(name) ?? []).map((activity) => pushActivity(name, activity))).then(
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

const pushActivity = (name: string, activity: Activity) =>
  saveActivity(`${name}:${activity.id}`, name, activity.filename, activity.format, encodeKeys(activity.tiles17));

async function pull(): Promise<void> {
  const remoteActivities = await fetchActivities();
  const remotePeople = new Set<string>();
  for (const remote of remoteActivities) {
    if (!people.some((p) => p.name === remote.person)) continue;
    remotePeople.add(remote.person);
    addActivity(remote.person, {
      id: remote.id.includes(":") ? remote.id.slice(remote.id.indexOf(":") + 1) : remote.id,
      filename: remote.filename,
      format: remote.format,
      imported: remote.imported_at,
      tiles17: decodeKeys(remote.tiles),
    });
  }
  for (const name of remotePeople) replaceFromActivities(name);
  const me = nameSelect.value;
  for (const activity of activities.get(me) ?? []) {
    if (!remoteActivities.some((remote) => remote.id === `${me}:${activity.id}`)) await pushActivity(me, activity);
  }
  // Backward compatibility for data written before activities were introduced.
  const remote = await fetchMaps();
  let changed = false;
  for (const r of remote) {
    if (activities.has(r.name)) continue;
    if (!people.some((p) => p.name === r.name)) continue;
    const tiles = decodeKeys(r.tiles);
    const idx = people.findIndex((p) => p.name === r.name);
    const current = people[idx];
    const next = makePerson(current.name, current.color, tiles);
    next.visible = current.visible;
    if (current.tiles17.size !== next.tiles17.size || [...current.tiles17].some((tile) => !next.tiles17.has(tile))) {
      people[idx] = next;
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
  // A map imported before sharing existed is uploaded once for the person using this browser.
  pull()
    .catch((err: Error) => console.warn("Sync failed", err));
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
    const savedActivities = JSON.parse(localStorage.getItem(ACTIVITIES_KEY) ?? "[]") as Array<
      { name: string } & ActivityFile
    >;
    for (const saved of savedActivities) {
      if (!people.some((p) => p.name === saved.name)) continue;
      addActivity(saved.name, parseActivityFile(saved));
    }
  } catch (err) {
    console.warn("Could not read saved data", err);
  }
  const me = people.find((p) => p.name === nameSelect.value);
  refresh(me?.tiles17.size ? me : undefined);
  if (syncEnabled) startSync();
}

init();
