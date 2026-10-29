-- TakeoffPro — 0003: Auto takeoff (AI) run log, used for per-user daily limits and cost tracking.
-- Written only by the auto-takeoff Edge Function (service role). Users can see their own runs; admins see all.

create table if not exists public.ai_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  model text,
  sheets int,
  items int,
  status text not null default 'running' check (status in ('running', 'ok', 'error')),
  input_tokens int,
  output_tokens int,
  error text
);
create index if not exists ai_runs_user_idx on public.ai_runs (user_id, created_at desc);

alter table public.ai_runs enable row level security;
drop policy if exists "ai_runs read" on public.ai_runs;
create policy "ai_runs read" on public.ai_runs
  for select using (user_id = auth.uid() or public.is_admin());
