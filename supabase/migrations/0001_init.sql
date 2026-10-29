-- TakeoffPro — initial schema (Stage 1)
-- Run in Supabase Dashboard → SQL Editor, or with `supabase db push`.
-- Covers all stages so later stages only add functions, not breaking changes.

create extension if not exists pgcrypto;

-- ─────────────────────────────────────────────────────────────
-- Admins
-- ─────────────────────────────────────────────────────────────
create table if not exists public.app_admins (
  email text primary key
);
insert into public.app_admins (email) values ('cha462029@gmail.com')
  on conflict do nothing;

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.app_admins
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

-- ─────────────────────────────────────────────────────────────
-- Profiles: user-editable preferences
-- ─────────────────────────────────────────────────────────────
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text,
  company text,
  unit_system text not null default 'metric' check (unit_system in ('metric', 'imperial')),
  currency text not null default 'USD' check (currency in ('USD', 'ZMW')),
  zmw_per_usd numeric(12, 4) not null default 26.0 check (zmw_per_usd > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────
-- Entitlements: free uses + subscription. SERVER-WRITE ONLY.
-- Clients can read their own row but never insert/update/delete it.
-- ─────────────────────────────────────────────────────────────
create table if not exists public.entitlements (
  user_id uuid primary key references auth.users (id) on delete cascade,
  free_uses_total int not null default 3,
  free_uses_used int not null default 0 check (free_uses_used >= 0),
  sub_status text not null default 'trial' check (sub_status in ('trial', 'active', 'expired')),
  sub_expires_at timestamptz,
  sub_method text check (sub_method in ('card_recurring', 'mobile_money', 'manual')),
  pesapal_account_number text,
  updated_at timestamptz not null default now()
);

-- One row per drawing sheet that has consumed a free use (re-exports are free).
create table if not exists public.usage_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  sheet_id uuid not null,
  kind text not null check (kind in ('image', 'table')),
  created_at timestamptz not null default now(),
  unique (user_id, sheet_id)
);

-- ─────────────────────────────────────────────────────────────
-- Takeoff data (client-generated UUIDs so records can be created offline)
-- ─────────────────────────────────────────────────────────────
create table if not exists public.projects (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  client text,
  site_location text,
  project_date date,
  -- categories, default waste factors, unit rates library, etc.
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by_device text,
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists projects_user_idx on public.projects (user_id, updated_at desc);

create table if not exists public.sheets (
  id uuid primary key,
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  sort_order int not null default 0,
  source_type text not null check (source_type in ('pdf', 'png', 'jpg', 'camera')),
  page_index int,                 -- page number when split from a PDF
  storage_path text,              -- path in the `drawings` bucket
  width_px int,
  height_px int,
  -- default scale for the sheet + per-region scales (drawings often mix 1:50 / 1:75 / 1:100 views)
  scale jsonb,
  regions jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists sheets_project_idx on public.sheets (project_id);

create table if not exists public.measurements (
  id uuid primary key,
  sheet_id uuid not null references public.sheets (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  type text not null check (type in ('linear', 'area', 'count', 'volume')),
  name text not null,
  description text,               -- SMM description column
  category text not null,         -- work section
  color text not null default '#F97316',
  timesing numeric not null default 1,   -- SMM "2/" multiplier
  is_deduction boolean not null default false,  -- SMM "Ddt"
  waste_pct numeric not null default 0,
  unit_rate numeric not null default 0,  -- stored in USD
  depth_m numeric,                -- volume = area × depth
  geometry jsonb not null default '{}'::jsonb,  -- points / holes in sheet pixel space
  sort_order int not null default 0,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists measurements_project_idx on public.measurements (project_id);

-- Older copy kept when two devices edited the same project (newest wins).
create table if not exists public.project_backups (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  snapshot jsonb not null,
  reason text not null default 'sync_conflict',
  created_at timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────
-- Payments (written only by Edge Functions with the service role)
-- ─────────────────────────────────────────────────────────────
create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  merchant_reference text not null unique,
  order_tracking_id text unique,
  amount numeric(12, 2) not null,
  currency text not null,
  status text not null default 'PENDING',
  payment_method text,
  notification_type text,         -- IPNCHANGE | RECURRING | CALLBACKURL
  is_recurring boolean not null default false,
  confirmation_code text,
  period_start timestamptz,
  period_end timestamptz,
  raw jsonb,
  receipt_sent_at timestamptz,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz
);
create index if not exists payments_user_idx on public.payments (user_id, created_at desc);

-- In-app notifications (renewal reminders etc.)
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null,
  title text not null,
  body text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────
-- New user → profile + entitlement (3 free uses)
-- ─────────────────────────────────────────────────────────────
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'))
  on conflict (id) do nothing;
  insert into public.entitlements (user_id) values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Keep updated_at fresh on profile edits.
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

-- ─────────────────────────────────────────────────────────────
-- Row Level Security
-- ─────────────────────────────────────────────────────────────
alter table public.app_admins enable row level security;
alter table public.profiles enable row level security;
alter table public.entitlements enable row level security;
alter table public.usage_events enable row level security;
alter table public.projects enable row level security;
alter table public.sheets enable row level security;
alter table public.measurements enable row level security;
alter table public.project_backups enable row level security;
alter table public.payments enable row level security;
alter table public.notifications enable row level security;

-- app_admins: no client access at all (is_admin() is security definer).

drop policy if exists "profiles self read" on public.profiles;
create policy "profiles self read" on public.profiles
  for select using (id = auth.uid() or public.is_admin());
drop policy if exists "profiles self update" on public.profiles;
create policy "profiles self update" on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());
-- Email is managed by auth; users may only change their preferences.
revoke update on public.profiles from authenticated;
grant update (full_name, company, unit_system, currency, zmw_per_usd) on public.profiles to authenticated;

-- Entitlements / usage / payments: read-only for the owner, read for admin.
-- No insert/update/delete policies → only the service role (Edge Functions) can write.
drop policy if exists "entitlements self read" on public.entitlements;
create policy "entitlements self read" on public.entitlements
  for select using (user_id = auth.uid() or public.is_admin());

drop policy if exists "usage self read" on public.usage_events;
create policy "usage self read" on public.usage_events
  for select using (user_id = auth.uid() or public.is_admin());

drop policy if exists "payments self read" on public.payments;
create policy "payments self read" on public.payments
  for select using (user_id = auth.uid() or public.is_admin());

-- Takeoff data: full CRUD on own rows.
do $$
declare t text;
begin
  foreach t in array array['projects', 'sheets', 'measurements', 'project_backups', 'notifications'] loop
    execute format('drop policy if exists "%1$s owner all" on public.%1$I', t);
    execute format(
      'create policy "%1$s owner all" on public.%1$I for all
         using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────
-- Storage: private bucket, each user writes under <user_id>/...
-- ─────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('drawings', 'drawings', false)
on conflict (id) do nothing;

drop policy if exists "drawings owner read" on storage.objects;
create policy "drawings owner read" on storage.objects
  for select using (bucket_id = 'drawings' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "drawings owner write" on storage.objects;
create policy "drawings owner write" on storage.objects
  for insert with check (bucket_id = 'drawings' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "drawings owner update" on storage.objects;
create policy "drawings owner update" on storage.objects
  for update using (bucket_id = 'drawings' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "drawings owner delete" on storage.objects;
create policy "drawings owner delete" on storage.objects
  for delete using (bucket_id = 'drawings' and (storage.foldername(name))[1] = auth.uid()::text);
