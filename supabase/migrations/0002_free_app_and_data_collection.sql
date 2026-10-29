-- TakeoffPro — 0002: app is free (no payment plan) + accuracy-improvement data collection
-- Run AFTER 0001_init.sql in Supabase Dashboard → SQL Editor.

-- ─────────────────────────────────────────────────────────────
-- 1. Remove the payment plan
-- ─────────────────────────────────────────────────────────────
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop table if exists public.payments;
drop table if exists public.usage_events;
drop table if exists public.entitlements;
drop table if exists public.notifications;

-- ─────────────────────────────────────────────────────────────
-- 2. Consent records — proof that each user agreed to the Privacy Policy
--    Insert-only from the app; only admins can read. Never updated or deleted
--    by the app, so the record stands as evidence.
-- ─────────────────────────────────────────────────────────────
create table if not exists public.consent_log (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  device_id text not null check (length(device_id) between 8 and 64),
  user_id uuid default auth.uid(),
  policy_version text not null check (length(policy_version) <= 20),
  -- the exact wording the user agreed to
  consent_text text not null check (length(consent_text) <= 2000),
  accepted boolean not null,
  user_agent text check (length(user_agent) <= 500),
  locale text check (length(locale) <= 20)
);

-- ─────────────────────────────────────────────────────────────
-- 3. Usage / accuracy events (uploads, scales, measurements, corrections)
-- ─────────────────────────────────────────────────────────────
create table if not exists public.telemetry_events (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  client_at timestamptz,
  device_id text not null check (length(device_id) between 8 and 64),
  session_id text not null check (length(session_id) between 8 and 64),
  user_id uuid default auth.uid(),
  event text not null check (length(event) <= 60),
  props jsonb not null default '{}'::jsonb check (pg_column_size(props) < 200000),
  app_version text check (length(app_version) <= 20)
);
create index if not exists telemetry_event_idx on public.telemetry_events (event, created_at desc);
create index if not exists telemetry_device_idx on public.telemetry_events (device_id, created_at desc);

alter table public.consent_log enable row level security;
alter table public.telemetry_events enable row level security;

-- Anyone using the app (guest or signed in) may INSERT; user_id can only be their own (or null for guests).
drop policy if exists "consent insert" on public.consent_log;
create policy "consent insert" on public.consent_log
  for insert to anon, authenticated
  with check (user_id is null or user_id = auth.uid());
drop policy if exists "consent admin read" on public.consent_log;
create policy "consent admin read" on public.consent_log
  for select using (public.is_admin());

drop policy if exists "telemetry insert" on public.telemetry_events;
create policy "telemetry insert" on public.telemetry_events
  for insert to anon, authenticated
  with check (user_id is null or user_id = auth.uid());
drop policy if exists "telemetry admin read" on public.telemetry_events;
create policy "telemetry admin read" on public.telemetry_events
  for select using (public.is_admin());

grant insert on public.consent_log, public.telemetry_events to anon, authenticated;

-- ─────────────────────────────────────────────────────────────
-- 4. Copies of uploaded drawings (for accuracy research)
--    Private bucket: the app can upload, only admins can read.
-- ─────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit)
values ('training-uploads', 'training-uploads', false, 52428800)
on conflict (id) do nothing;

drop policy if exists "training upload" on storage.objects;
create policy "training upload" on storage.objects
  for insert to anon, authenticated
  with check (bucket_id = 'training-uploads');
drop policy if exists "training admin read" on storage.objects;
create policy "training admin read" on storage.objects
  for select using (bucket_id = 'training-uploads' and public.is_admin());

-- ─────────────────────────────────────────────────────────────
-- 5. Retention: delete research data older than 3 years (matches the Privacy Policy).
--    Run manually, or schedule with pg_cron: select cron.schedule('purge', '0 3 * * 0', 'select public.purge_old_research_data()');
-- ─────────────────────────────────────────────────────────────
create or replace function public.purge_old_research_data()
returns void language sql security definer set search_path = public
as $$
  delete from public.telemetry_events where created_at < now() - interval '3 years';
$$;
