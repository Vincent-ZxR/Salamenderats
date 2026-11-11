-- Apply to an existing project after adding Seb; this does not change the passcode.
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
  if p_name not in ('Hugo', 'Thomas', 'Vincent', 'Seb') then
    raise exception 'unknown name';
  end if;
  insert into maps (name, tiles, updated_at) values (p_name, p_tiles, now())
  on conflict (name) do update set tiles = excluded.tiles, updated_at = now();
end;
$$;

revoke all on function save_map(text, text, text) from public;
grant execute on function save_map(text, text, text) to anon;
notify pgrst, 'reload schema';
