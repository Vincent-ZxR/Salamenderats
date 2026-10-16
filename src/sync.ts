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

/** Calls onChange whenever any map changes. The payload is ignored (it can be truncated); callers refetch. */
export function subscribe(onChange: () => void): void {
  client
    ?.channel("maps-changes")
    .on("postgres_changes", { event: "*", schema: "public", table: "maps" }, onChange)
    .subscribe();
}
