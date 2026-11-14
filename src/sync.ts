import { createClient, type Session } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const syncEnabled = Boolean(url && key);
const client = syncEnabled ? createClient(url!, key!) : null;

function configuredClient() {
  if (!client) throw new Error("Supabase is not configured");
  return client;
}

export interface RemoteMap {
  id: string;
  username: string;
  tiles: string | null;
}

export interface Relationship {
  id: string;
  username: string;
  status: "friend" | "incoming" | "outgoing";
}

export async function getSession(): Promise<Session | null> {
  const { data, error } = await configuredClient().auth.getSession();
  if (error) throw error;
  return data.session;
}

export function watchSession(userId: string | null): void {
  configuredClient().auth.onAuthStateChange((_event, session) => {
    if ((session?.user.id ?? null) !== userId) window.location.reload();
  });
}

export async function signIn(email: string, password: string): Promise<void> {
  const { error } = await configuredClient().auth.signInWithPassword({ email, password });
  if (error) throw error;
}

export async function signUp(email: string, password: string): Promise<boolean> {
  const { data, error } = await configuredClient().auth.signUp({ email, password });
  if (error) throw error;
  return Boolean(data.session);
}

export async function signOut(): Promise<void> {
  const { error } = await configuredClient().auth.signOut();
  if (error) throw error;
}

async function rpc(name: string, args?: Record<string, string>): Promise<unknown> {
  const { data, error } = await configuredClient().rpc(name, args);
  if (error) throw error;
  return data;
}

export async function createProfile(username: string): Promise<void> {
  await rpc("create_profile", { p_username: username });
}

export async function requestFriend(username: string): Promise<void> {
  await rpc("request_friend", { p_username: username.toLowerCase() });
}

export async function acceptFriend(id: string): Promise<void> {
  await rpc("accept_friend", { p_user: id });
}

export async function removeFriend(id: string): Promise<void> {
  await rpc("remove_friend", { p_user: id });
}

export async function fetchRelationships(): Promise<Relationship[]> {
  return (await rpc("list_relationships")) as Relationship[];
}

export async function fetchMaps(): Promise<RemoteMap[]> {
  return (await rpc("list_visible_maps")) as RemoteMap[];
}

export async function saveMap(tiles: string): Promise<void> {
  await rpc("save_user_map", { p_tiles: tiles });
}
