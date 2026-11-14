-- Run in the Supabase SQL editor, in a single transaction. Legacy maps are
-- retained for an administrator but are no longer exposed through the API.
begin;

do $$
begin
  if to_regclass('public.maps') is not null then
    execute 'drop policy if exists "maps are readable" on public.maps';
    execute 'revoke all on public.maps from public, anon, authenticated';
  end if;
  if to_regprocedure('public.save_map(text,text,text)') is not null then
    execute 'revoke all on function public.save_map(text,text,text) from public, anon, authenticated';
  end if;
end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9_]{3,24}$')
);

create table if not exists public.friendships (
  user_low uuid not null references public.profiles(id) on delete cascade,
  user_high uuid not null references public.profiles(id) on delete cascade,
  requested_by uuid not null references public.profiles(id) on delete cascade,
  accepted boolean not null default false,
  primary key (user_low, user_high),
  check (user_low < user_high),
  check (requested_by = user_low or requested_by = user_high)
);

create table if not exists public.user_maps (
  owner_id uuid primary key references public.profiles(id) on delete cascade,
  tiles text not null,
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.friendships enable row level security;
alter table public.user_maps enable row level security;
revoke all on public.profiles, public.friendships, public.user_maps from public, anon, authenticated;

create or replace function public.create_profile(p_username text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if p_username is null or p_username !~ '^[a-z0-9_]{3,24}$' then
    raise exception 'Username must be 3–24 lowercase letters, digits or underscores';
  end if;
  insert into public.profiles(id, username) values (auth.uid(), p_username);
exception when unique_violation then
  raise exception 'Username is taken or profile already exists';
end $$;

create or replace function public.request_friend(p_username text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare target uuid; me uuid := auth.uid();
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then
    raise exception 'Create a profile first';
  end if;
  select id into target from public.profiles where username = lower(p_username);
  if target is null then raise exception 'User not found'; end if;
  if target = me then raise exception 'You cannot add yourself'; end if;
  insert into public.friendships(user_low, user_high, requested_by)
  values (least(me, target), greatest(me, target), me)
  on conflict do nothing;
  if not found then raise exception 'Friendship or request already exists'; end if;
end $$;

create or replace function public.accept_friend(p_user uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.friendships set accepted = true
  where user_low = least(auth.uid(), p_user) and user_high = greatest(auth.uid(), p_user)
    and requested_by = p_user and accepted = false;
  if not found then raise exception 'No incoming request found'; end if;
end $$;

create or replace function public.remove_friend(p_user uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  delete from public.friendships
  where user_low = least(auth.uid(), p_user) and user_high = greatest(auth.uid(), p_user)
    and auth.uid() in (user_low, user_high);
  if not found then raise exception 'Friendship not found'; end if;
end $$;

create or replace function public.list_relationships()
returns table (id uuid, username text, status text)
language sql stable security definer set search_path = public, pg_temp as $$
  select p.id, p.username,
    case when f.accepted then 'friend'
         when f.requested_by = auth.uid() then 'outgoing'
         else 'incoming' end
  from public.friendships f
  join public.profiles p on p.id = case when f.user_low = auth.uid() then f.user_high else f.user_low end
  where auth.uid() in (f.user_low, f.user_high)
  order by p.username;
$$;

create or replace function public.list_visible_maps()
returns table (id uuid, username text, tiles text)
language sql stable security definer set search_path = public, pg_temp as $$
  select p.id, p.username, m.tiles
  from public.profiles p
  left join public.user_maps m on m.owner_id = p.id
  where p.id = auth.uid() or exists (
    select 1 from public.friendships f
    where f.user_low = least(auth.uid(), p.id) and f.user_high = greatest(auth.uid(), p.id)
      and f.accepted
  )
  order by p.username;
$$;

create or replace function public.save_user_map(p_tiles text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null or not exists (select 1 from public.profiles where id = auth.uid()) then
    raise exception 'Create a profile first';
  end if;
  if p_tiles is null then raise exception 'Tiles are required'; end if;
  insert into public.user_maps(owner_id, tiles) values (auth.uid(), p_tiles)
  on conflict (owner_id) do update set tiles = excluded.tiles, updated_at = now();
end $$;

revoke all on function public.create_profile(text), public.request_friend(text),
  public.accept_friend(uuid), public.remove_friend(uuid), public.list_relationships(),
  public.list_visible_maps(), public.save_user_map(text) from public, anon, authenticated;
grant execute on function public.create_profile(text), public.request_friend(text),
  public.accept_friend(uuid), public.remove_friend(uuid), public.list_relationships(),
  public.list_visible_maps(), public.save_user_map(text) to authenticated;

notify pgrst, 'reload schema';
commit;
