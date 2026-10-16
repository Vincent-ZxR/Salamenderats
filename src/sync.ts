import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

const PASS_KEY = "squadrats.passcode";

export const syncEnabled = Boolean(url && key);
const client = syncEnabled ? createClient(url!, key!) : null;

export interface RemoteMap {
  name: string;
  tiles: string;
}

export interface RemoteActivity {
  id: string;
  person: string;
  filename: string;
  format: "gpx" | "tcx" | "fit";
  tiles: string;
  imported_at: string;
}

export async function fetchActivities(): Promise<RemoteActivity[]> {
  if (!client) return [];
  const { data, error } = await client.from("activities").select("id,person,filename,format,tiles,imported_at");
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function fetchMaps(): Promise<RemoteMap[]> {
  if (!client) return [];
  const { data, error } = await client.from("maps").select("name,tiles");
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** Asks for the shared passcode once and remembers it in this browser. */
function passcode(): string | null {
  const saved = localStorage.getItem(PASS_KEY);
  if (saved) return saved;
  const entered = window.prompt("Enter the group passcode to share your map:")?.trim();
  if (!entered) return null;
  localStorage.setItem(PASS_KEY, entered);
  return entered;
}

export async function saveMap(name: string, tiles: string): Promise<void> {
  if (!client) return;
  const code = passcode();
  if (!code) throw new Error("no passcode given");
  const { error } = await client.rpc("save_map", { p_name: name, p_passcode: code, p_tiles: tiles });
  if (error) {
    if (/wrong passcode/i.test(error.message)) localStorage.removeItem(PASS_KEY);
    throw new Error(error.message);
  }
}

export async function saveActivity(
  id: string,
  person: string,
  filename: string,
  format: string,
  tiles: string,
): Promise<void> {
  if (!client) return;
  const code = passcode();
  if (!code) throw new Error("no passcode given");
  const { error } = await client.rpc("save_activity", {
    p_id: id,
    p_person: person,
    p_passcode: code,
    p_filename: filename,
    p_format: format,
    p_tiles: tiles,
  });
  if (error) {
    if (/wrong passcode/i.test(error.message)) localStorage.removeItem(PASS_KEY);
    throw new Error(error.message);
  }
}

export async function deleteActivity(id: string, person: string): Promise<void> {
  if (!client) return;
  const code = passcode();
  if (!code) throw new Error("no passcode given");
  const { error } = await client.rpc("delete_activity", { p_id: id, p_person: person, p_passcode: code });
  if (error) {
    if (/wrong passcode/i.test(error.message)) localStorage.removeItem(PASS_KEY);
    throw new Error(error.message);
  }
}

/** Calls onChange whenever any map changes. The payload is ignored (it can be truncated); callers refetch. */
export function subscribe(onChange: () => void): void {
  client
    ?.channel("maps-changes")
    .on("postgres_changes", { event: "*", schema: "public", table: "maps" }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "activities" }, onChange)
    .subscribe();
}
