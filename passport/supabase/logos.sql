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
