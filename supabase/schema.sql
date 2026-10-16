-- Run this once in the Supabase SQL editor (Dashboard -> SQL Editor -> New query).
-- Everyone can read the maps; writes only go through save_map(), which checks a shared passcode.

create table if not exists maps (
  name text primary key,
  tiles text not null,
  updated_at timestamptz not null default now()
);

alter table maps enable row level security;
drop policy if exists "maps are readable" on maps;
create policy "maps are readable" on maps for select using (true);
-- No insert/update/delete policy: the anon key cannot write to the table directly.

create table if not exists app_secret (
  id int primary key default 1 check (id = 1),
  passcode text not null
);
alter table app_secret enable row level security; -- no policy: not readable through the API

-- CHANGE THE PASSCODE below, then share it with your friends. Do not commit the real passcode.
-- Re-running the script replaces the stored passcode.
insert into app_secret (id, passcode) values (1, 'CHANGE_ME')
on conflict (id) do update set passcode = excluded.passcode;

create or replace function save_map(p_name text, p_passcode text, p_tiles text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_passcode is distinct from (select passcode from app_secret where id = 1) then
    raise exception 'wrong passcode';
  end if;
  if p_name not in ('Grégoire', 'Hugo', 'Thomas', 'Vincent') then
    raise exception 'unknown name';
  end if;
  insert into maps (name, tiles, updated_at) values (p_name, p_tiles, now())
  on conflict (name) do update set tiles = excluded.tiles, updated_at = now();
end;
$$;

revoke all on function save_map(text, text, text) from public;
grant execute on function save_map(text, text, text) to anon;

-- Live updates for the app (safe to re-run)
do $$
begin
  alter publication supabase_realtime add table maps;
exception when duplicate_object then null;
end $$;

-- Make the new function visible to the API immediately
notify pgrst, 'reload schema';
