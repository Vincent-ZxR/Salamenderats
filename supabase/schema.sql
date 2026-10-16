-- Run this once in the Supabase SQL editor (Dashboard -> SQL Editor -> New query).
-- Everyone can read the maps; writes only go through save_map(), which checks a shared passcode.

create table if not exists maps (
  name text primary key,
  tiles text not null,
  updated_at timestamptz not null default now()
);

create table if not exists activities (
  id text primary key,
  person text not null,
  filename text not null,
  format text not null check (format in ('gpx', 'tcx', 'fit')),
  tiles text not null,
  imported_at timestamptz not null default now()
);

alter table maps enable row level security;
drop policy if exists "maps are readable" on maps;
create policy "maps are readable" on maps for select using (true);
-- No insert/update/delete policy: the anon key cannot write to the table directly.
alter table activities enable row level security;
drop policy if exists "activities are readable" on activities;
create policy "activities are readable" on activities for select using (true);
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

create or replace function save_activity(
  p_id text,
  p_person text,
  p_passcode text,
  p_filename text,
  p_format text,
  p_tiles text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_passcode is distinct from (select passcode from app_secret where id = 1) then
    raise exception 'wrong passcode';
  end if;
  if p_person not in ('Grégoire', 'Hugo', 'Thomas', 'Vincent') then
    raise exception 'unknown name';
  end if;
  if p_format not in ('gpx', 'tcx', 'fit') then
    raise exception 'unknown activity format';
  end if;
  insert into activities (id, person, filename, format, tiles, imported_at)
  values (p_id, p_person, p_filename, p_format, p_tiles, now())
  on conflict (id) do update set
    person = excluded.person,
    filename = excluded.filename,
    format = excluded.format,
    tiles = excluded.tiles;
end;
$$;

revoke all on function save_activity(text, text, text, text, text, text) from public;
grant execute on function save_activity(text, text, text, text, text, text) to anon;

create or replace function delete_activity(p_id text, p_person text, p_passcode text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_passcode is distinct from (select passcode from app_secret where id = 1) then
    raise exception 'wrong passcode';
  end if;
  delete from activities where id = p_id and person = p_person;
  if not exists (select 1 from activities where person = p_person) then
    update maps set tiles = '', updated_at = now() where name = p_person;
  end if;
end;
$$;

revoke all on function delete_activity(text, text, text) from public;
grant execute on function delete_activity(text, text, text) to anon;

-- Live updates for the app (safe to re-run)
do $$
begin
  alter publication supabase_realtime add table maps;
exception when duplicate_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table activities;
exception when duplicate_object then null;
end $$;

-- Make the new function visible to the API immediately
notify pgrst, 'reload schema';
