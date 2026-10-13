-- Run this once in Supabase → SQL Editor → New query → Run. Same as section 11 of schema.sql.

-- 11. Guest list: the beta gate asks for your name instead of the phrase. Names match without caring about
--     case or extra spaces. Admins add and remove names from the app (profile screen); nobody else can read the list.
--     The old phrase still works as a backup key.
create table if not exists public.beta_guests (
  name_key text primary key,
  name text not null,
  added_at timestamptz default now()
);
alter table public.beta_guests enable row level security;
drop policy if exists "admins manage guests" on public.beta_guests;
create policy "admins manage guests" on public.beta_guests for all to authenticated
  using (exists (select 1 from public.app_admins a where a.user_id = auth.uid()))
  with check (exists (select 1 from public.app_admins a where a.user_id = auth.uid()));
create or replace function public.guest_key(t text) returns text language sql immutable as $$
  select lower(regexp_replace(trim(coalesce(t, '')), '\s+', ' ', 'g'))
$$;
create or replace function public.check_beta_invite() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare k text := public.guest_key(new.raw_user_meta_data->>'invite');
begin
  if exists (select 1 from public.beta_guests where name_key = k) then return new; end if;
  if encode(digest(k, 'sha256'), 'hex') = '3fd2e6e75cbd1c4a26c88394aca22e9bff0827d3e95952ea10cb9571694c18e2' then return new; end if;
  raise exception 'invite required';
end $$;
insert into public.beta_guests (name_key, name) values ('thomas brown', 'Thomas Brown') on conflict do nothing;
