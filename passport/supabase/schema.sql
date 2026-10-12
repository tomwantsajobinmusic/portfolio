-- Rave Passport beta: run this once in Supabase → SQL Editor → New query → Run.

create extension if not exists pgcrypto;

-- 1. Beta gate: sign-ups must carry the beta password. Only its hash is stored here.
--    Case and extra spaces don't matter. This file sits in a public repo, so the answer itself is never written here.
create or replace function public.check_beta_invite() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  if encode(digest(lower(regexp_replace(trim(coalesce(new.raw_user_meta_data->>'invite', '')), '\s+', ' ', 'g')), 'sha256'), 'hex')
     <> '3fd2e6e75cbd1c4a26c88394aca22e9bff0827d3e95952ea10cb9571694c18e2' then
    raise exception 'invite required';
  end if;
  return new;
end $$;
drop trigger if exists beta_invite_gate on auth.users;
create trigger beta_invite_gate before insert on auth.users
  for each row execute function public.check_beta_invite();

-- 2. Profiles: one per traveler.
create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  username text unique check (username ~ '^[a-z0-9_.]{2,24}$'),
  name text default '',
  home text default '',
  favorite_djs text default '',
  favorite_festival text default '',
  favorite_genre text default '',
  photo_url text,
  theme jsonb default '{}'::jsonb,
  highlighted uuid[] default '{}',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create or replace function public.new_profile() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, username)
  values (new.id, lower(nullif(new.raw_user_meta_data->>'username', '')))
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.new_profile();

-- 3. Entries: one page in the book per show or festival.
create table if not exists public.entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade default auth.uid(),
  event_id bigint,
  kind text default 'show',
  title text not null,
  venue text default '',
  city text default '',
  date date not null,
  artists text[] default '{}',
  lineup text[] default '{}',
  notes text default '',
  bg jsonb default '{}'::jsonb,
  stamps jsonb default '[]'::jsonb,
  shot_it boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists entries_user_date on public.entries (user_id, date);

-- 4. Row-level security: you read and write only your own book.
alter table public.profiles enable row level security;
alter table public.entries enable row level security;
drop policy if exists "own profile" on public.profiles;
create policy "own profile" on public.profiles for all using (auth.uid() = id) with check (auth.uid() = id);
drop policy if exists "own entries" on public.entries;
create policy "own entries" on public.entries for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 5. Image storage: public to view, each person writes only inside their own folder.
insert into storage.buckets (id, name, public) values ('passport', 'passport', true) on conflict (id) do nothing;
drop policy if exists "passport upload own" on storage.objects;
create policy "passport upload own" on storage.objects for insert to authenticated
  with check (bucket_id = 'passport' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "passport delete own" on storage.objects;
create policy "passport delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'passport' and (storage.foldername(name))[1] = auth.uid()::text);

-- 6. View-only public books (/passport/?demo and ?u=username) and explicit page numbers.
alter table public.entries add column if not exists num int;
alter table public.profiles add column if not exists is_public boolean default false;
drop policy if exists "public profiles readable" on public.profiles;
create policy "public profiles readable" on public.profiles for select using (is_public);
drop policy if exists "public entries readable" on public.entries;
create policy "public entries readable" on public.entries for select
  using (exists (select 1 from public.profiles p where p.id = entries.user_id and p.is_public));
-- Community logo directory: anyone can see logos; only the logo-add function writes them.
create table if not exists public.logos (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('dj', 'festival', 'club', 'venue')),
  name text not null,
  key text not null,
  url text not null,
  source text default '',
  added_by uuid references auth.users on delete set null,
  created_at timestamptz default now()
);
create index if not exists logos_key on public.logos (key);
alter table public.logos enable row level security;
drop policy if exists "logos readable" on public.logos;
create policy "logos readable" on public.logos for select using (true);
drop policy if exists "remove own logo" on public.logos;
create policy "remove own logo" on public.logos for delete to authenticated using (added_by = auth.uid());

-- 7. Optional festival day pages (Day 1, Day 2...). Null means the whole festival.
alter table public.entries add column if not exists day smallint check (day between 1 and 7);

-- 8. Networks where someone has signed in skip the beta question (gate-check function). Keyed IP hashes only.
create table if not exists public.known_networks (
  ip_hash text primary key,
  user_id uuid references auth.users on delete cascade,
  last_seen timestamptz default now()
);
alter table public.known_networks enable row level security; -- no policies: only the gate-check function reads or writes it
