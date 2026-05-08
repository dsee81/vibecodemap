create extension if not exists pgcrypto;

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  share_key text not null,
  edit_pin_hash text,
  created_at timestamptz not null default now()
);

create table if not exists public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create table if not exists public.places (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  title text not null,
  lat double precision not null,
  lng double precision not null,
  category text not null check (category in ('food', 'attraction', 'museum', 'cafe', 'hike', 'shopping', 'movie', 'custom')),
  marker_icon text not null check (marker_icon in ('food', 'attraction', 'museum', 'cafe', 'hike', 'shopping', 'movie', 'custom')),
  visited boolean not null default false,
  date_visited date,
  source_type text not null check (source_type in ('search', 'custom')),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.places
add column if not exists date_visited date;

alter table public.places
drop constraint if exists places_category_check;

alter table public.places
add constraint places_category_check
check (category in ('food', 'attraction', 'museum', 'cafe', 'hike', 'shopping', 'movie', 'custom'));

alter table public.places
drop constraint if exists places_marker_icon_check;

alter table public.places
add constraint places_marker_icon_check
check (marker_icon in ('food', 'attraction', 'museum', 'cafe', 'hike', 'shopping', 'movie', 'custom'));

create table if not exists public.entries (
  place_id uuid primary key references public.places(id) on delete cascade,
  comment text not null default '',
  rating integer check (rating between 1 and 5),
  favorite boolean not null default false,
  tags text[] not null default '{}',
  photo_paths text[] not null default '{}',
  editor_session_id text,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);

alter table public.entries
add column if not exists tags text[] not null default '{}';

alter table public.entries
add column if not exists photo_paths text[] not null default '{}';

alter table public.entries
add column if not exists favorite boolean not null default false;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_places_updated_at on public.places;
create trigger set_places_updated_at
before update on public.places
for each row
execute function public.set_updated_at();

create or replace function public.join_workspace(p_slug text, p_share_key text)
returns public.workspaces
language plpgsql
security definer
set search_path = public
as $$
declare
  target_workspace public.workspaces;
begin
  select *
  into target_workspace
  from public.workspaces
  where slug = p_slug
    and share_key = p_share_key;

  if not found then
    raise exception 'Invalid workspace link';
  end if;

  insert into public.workspace_members (workspace_id, user_id)
  values (target_workspace.id, auth.uid())
  on conflict do nothing;

  return target_workspace;
end;
$$;

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.places enable row level security;
alter table public.entries enable row level security;

drop policy if exists workspace_members_select on public.workspace_members;
create policy workspace_members_select
on public.workspace_members
for select
using (user_id = auth.uid());

drop policy if exists places_read on public.places;
create policy places_read
on public.places
for select
using (
  exists (
    select 1
    from public.workspace_members members
    where members.workspace_id = places.workspace_id
      and members.user_id = auth.uid()
  )
);

drop policy if exists places_write on public.places;
create policy places_write
on public.places
for all
using (
  exists (
    select 1
    from public.workspace_members members
    where members.workspace_id = places.workspace_id
      and members.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.workspace_members members
    where members.workspace_id = places.workspace_id
      and members.user_id = auth.uid()
  )
);

drop policy if exists entries_read on public.entries;
create policy entries_read
on public.entries
for select
using (
  exists (
    select 1
    from public.places
    join public.workspace_members members on members.workspace_id = places.workspace_id
    where places.id = entries.place_id
      and members.user_id = auth.uid()
  )
);

drop policy if exists entries_write on public.entries;
create policy entries_write
on public.entries
for all
using (
  exists (
    select 1
    from public.places
    join public.workspace_members members on members.workspace_id = places.workspace_id
    where places.id = entries.place_id
      and members.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.places
    join public.workspace_members members on members.workspace_id = places.workspace_id
    where places.id = entries.place_id
      and members.user_id = auth.uid()
  )
);

grant usage on schema public to anon, authenticated;
grant select on public.workspaces to authenticated;
grant execute on function public.join_workspace(text, text) to anon, authenticated;
grant select, insert, update on public.workspace_members to authenticated;
grant select, insert, update, delete on public.places to authenticated;
grant select, insert, update, delete on public.entries to authenticated;

insert into storage.buckets (id, name, public)
values ('place-photos', 'place-photos', true)
on conflict (id) do update set public = true;

drop policy if exists place_photos_public_read on storage.objects;
create policy place_photos_public_read
on storage.objects
for select
to public
using (bucket_id = 'place-photos');

drop policy if exists place_photos_authenticated_insert on storage.objects;
create policy place_photos_authenticated_insert
on storage.objects
for insert
to authenticated
with check (bucket_id = 'place-photos');

drop policy if exists place_photos_authenticated_delete on storage.objects;
create policy place_photos_authenticated_delete
on storage.objects
for delete
to authenticated
using (bucket_id = 'place-photos');
