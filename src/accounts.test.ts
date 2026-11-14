import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, expect, it } from "vitest";
import migration from "../supabase/accounts.sql?raw";

const db = new PGlite();
const alice = "00000000-0000-0000-0000-000000000001";
const bob = "00000000-0000-0000-0000-000000000002";
const charlie = "00000000-0000-0000-0000-000000000003";

beforeAll(async () => {
  await db.exec(`
    create role anon;
    create role authenticated;
    create schema auth;
    grant usage on schema auth to anon, authenticated;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    create table public.maps (name text primary key, tiles text);
    insert into public.maps values ('old', 'legacy');
    grant select on public.maps to anon, authenticated;
    alter table public.maps enable row level security;
    create policy "maps are readable" on public.maps for select using (true);
    create function public.save_map(text, text, text) returns void language sql as $$ select $$;
    grant execute on function public.save_map(text, text, text) to anon;
    insert into auth.users values
      ('${alice}'), ('${bob}'), ('${charlie}');
  `);
  await db.exec(migration);
  await db.exec(migration);
}, 30000);

afterAll(async () => db.close());

async function identity(id: string | null, role: "anon" | "authenticated" = "authenticated") {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id ?? ""]);
  await db.exec(`set role ${role}`);
}

async function visible() {
  const { rows } = await db.query<{ username: string; tiles: string | null }>("select * from public.list_visible_maps()");
  return rows.sort((a, b) => a.username.localeCompare(b.username));
}

it("restricts legacy access and exposes maps only to their owners and accepted friends", async () => {
  await identity(null, "anon");
  await expect(db.query("select * from public.maps")).rejects.toThrow();
  await expect(db.query("select public.save_map('old', 'anything', 'changed')")).rejects.toThrow();
  await expect(db.query("select * from public.list_visible_maps()")).rejects.toThrow();
  await expect(db.query("select public.save_user_map('x')")).rejects.toThrow();

  for (const [id, name] of [[alice, "alice"], [bob, "bob"], [charlie, "charlie"]]) {
    await identity(id);
    await expect(db.query("select public.create_profile('bad<script>')")).rejects.toThrow();
    await db.query("select public.create_profile($1)", [name]);
    await db.query("select public.save_user_map($1)", [`tiles-${name}`]);
  }
  await identity(alice);
  await expect(db.query("select public.create_profile('alice2')")).rejects.toThrow();
  await expect(db.query("select * from public.user_maps")).rejects.toThrow();
  await expect(db.query("select * from public.profiles")).rejects.toThrow();
  await expect(db.query("select * from public.friendships")).rejects.toThrow();
  await expect(db.query("update public.user_maps set tiles = 'stolen'")).rejects.toThrow();
  expect((await visible()).map((r) => r.username)).toEqual(["alice"]);
  await db.query("select public.request_friend('bob')");
  await expect(db.query("select public.request_friend('bob')")).rejects.toThrow();
  expect((await visible()).map((r) => r.username)).toEqual(["alice"]);
  await expect(db.query("select public.accept_friend($1)", [bob])).rejects.toThrow();

  await identity(charlie);
  await expect(db.query("select public.accept_friend($1)", [alice])).rejects.toThrow();
  await expect(db.query("select public.remove_friend($1)", [alice])).rejects.toThrow();
  expect((await visible()).map((r) => r.username)).toEqual(["charlie"]);

  await identity(bob);
  expect((await visible()).map((r) => r.username)).toEqual(["bob"]);
  await db.query("select public.accept_friend($1)", [alice]);
  expect((await visible()).map((r) => r.username)).toEqual(["alice", "bob"]);
  await identity(alice);
  expect(await visible()).toEqual([
    expect.objectContaining({ username: "alice", tiles: "tiles-alice" }),
    expect.objectContaining({ username: "bob", tiles: "tiles-bob" }),
  ]);
  await db.query("select public.remove_friend($1)", [bob]);
  expect((await visible()).map((r) => r.username)).toEqual(["alice"]);
  await identity(bob);
  expect((await visible()).map((r) => r.username)).toEqual(["bob"]);
  await db.exec("reset role");
  expect((await db.query("select tiles from public.maps where name = 'old'")).rows).toEqual([{ tiles: "legacy" }]);
}, 30000);
