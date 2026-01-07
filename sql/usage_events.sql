-- Usage events table and admin-only read policy.
-- Assumes a profiles table with user_id (uuid) and is_admin (boolean).

create extension if not exists pgcrypto;

create table if not exists public.usage_events (
  id uuid primary key default gen_random_uuid(),
  event_ts timestamptz not null,
  event_name text not null,
  feature text not null,
  action text not null,
  success boolean,
  user_id uuid,
  session_id text,
  anon_id text,
  plan text,
  subscription_status text,
  billing_period text,
  route text,
  section text,
  device_type text,
  os text,
  browser text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_term text,
  utm_content text,
  referrer text,
  landing_page text,
  properties jsonb not null default '{}'::jsonb,
  ingested_at timestamptz not null default now()
);

create index if not exists usage_events_event_ts_idx on public.usage_events (event_ts desc);
create index if not exists usage_events_event_name_idx on public.usage_events (event_name);
create index if not exists usage_events_feature_idx on public.usage_events (feature);
create index if not exists usage_events_user_id_idx on public.usage_events (user_id);
create index if not exists usage_events_session_id_idx on public.usage_events (session_id);
create index if not exists usage_events_plan_idx on public.usage_events (plan);
create index if not exists usage_events_route_idx on public.usage_events (route);
create index if not exists usage_events_event_ts_event_name_idx on public.usage_events (event_ts desc, event_name);
create index if not exists usage_events_properties_gin_idx on public.usage_events using gin (properties);

-- Optional helper: admin check backed by profiles table.
-- Remove this if you already have public.is_admin.
-- Keep default auth.uid() to avoid altering existing signature defaults.
create or replace function public.is_admin(user_uuid uuid default auth.uid())
returns boolean
language sql
stable
as $$
  select coalesce((select p.is_admin from public.profiles p where p.user_id = user_uuid), false);
$$;

alter table public.usage_events enable row level security;

grant select on public.usage_events to authenticated;

-- Admin-only read policy for analytics app
-- Requires auth and public.is_admin(auth.uid()) = true.
drop policy if exists "usage_events_admin_read" on public.usage_events;
create policy "usage_events_admin_read"
  on public.usage_events
  for select
  to authenticated
  using (public.is_admin(auth.uid()));

-- Optional: allow inserts from authenticated clients (uncomment if needed)
-- drop policy if exists "usage_events_insert" on public.usage_events;
-- create policy "usage_events_insert"
--   on public.usage_events
--   for insert
--   to authenticated
--   with check (true);
