-- ============================================================================
-- Quay 1 — Mission Control schema
-- Apply in the Supabase SQL editor (project dqszbqiimbfvmmnpgpsb).
-- Idempotent: safe to re-run. All tables prefixed mc_.
--
-- Access model:
--   * SELECT on every mc_ table is gated to superusers (staff.is_super).
--   * The local collector writes with the SERVICE ROLE key, which bypasses RLS
--     entirely, so the collector-owned tables need NO insert/update policy.
--   * mc_app_usage + mc_issues additionally allow any signed-in (authenticated)
--     user to INSERT — so usage pings and issue reports work from every app.
-- ============================================================================

-- helper: may the calling user see Mission Control data?
-- TRUE if the signed-in user is a superuser (PIN login maps to a staff row),
-- OR their auth email is in the owner allow-list below (Google "Login with
-- Google" users, who may not have a staff row at all). Edit the array to add
-- your own Google / Workspace address(es).
create or replace function public.mc_is_super()
returns boolean
language sql stable security definer set search_path = public as $$
  select
    exists (
      select 1 from public.staff
      where auth_user_id = auth.uid() and is_super = true
    )
    or lower(coalesce(auth.jwt() ->> 'email', '')) = any (array[
      'claude@quay1.co.za'          -- <- Mission Control owner (edit / add here)
    ]);
$$;

-- ---------------------------------------------------------------------------
-- 1. mc_app_usage — one row per app open (who opened what, when)
-- ---------------------------------------------------------------------------
create table if not exists public.mc_app_usage (
  id         bigint generated always as identity primary key,
  site       text not null,
  staff_id   text,
  name       text,
  is_super   boolean,
  path       text,
  user_agent text,
  ts         timestamptz not null default now()
);
create index if not exists mc_app_usage_ts_idx   on public.mc_app_usage (ts desc);
create index if not exists mc_app_usage_site_idx on public.mc_app_usage (site, ts desc);
alter table public.mc_app_usage enable row level security;

drop policy if exists mc_app_usage_super_read on public.mc_app_usage;
create policy mc_app_usage_super_read on public.mc_app_usage
  for select to authenticated using (public.mc_is_super());

drop policy if exists mc_app_usage_auth_insert on public.mc_app_usage;
create policy mc_app_usage_auth_insert on public.mc_app_usage
  for insert to authenticated with check (true);

-- ---------------------------------------------------------------------------
-- 2. mc_issues — issues/bugs logged by people
-- ---------------------------------------------------------------------------
create table if not exists public.mc_issues (
  id                bigint generated always as identity primary key,
  created_at        timestamptz not null default now(),
  reporter_staff_id text,
  reporter_name     text,
  site              text,
  severity          text not null default 'medium'
                      check (severity in ('low','medium','high','critical')),
  title             text not null,
  body              text,
  status            text not null default 'open'
                      check (status in ('open','ack','closed')),
  resolved_at       timestamptz,
  resolved_by       text
);
create index if not exists mc_issues_status_idx on public.mc_issues (status, created_at desc);
alter table public.mc_issues enable row level security;

drop policy if exists mc_issues_super_read on public.mc_issues;
create policy mc_issues_super_read on public.mc_issues
  for select to authenticated using (public.mc_is_super());

drop policy if exists mc_issues_auth_insert on public.mc_issues;
create policy mc_issues_auth_insert on public.mc_issues
  for insert to authenticated with check (true);

drop policy if exists mc_issues_super_update on public.mc_issues;
create policy mc_issues_super_update on public.mc_issues
  for update to authenticated using (public.mc_is_super()) with check (public.mc_is_super());

-- ---------------------------------------------------------------------------
-- 3. mc_job_health — launchd / cron job state (collector-written)
-- ---------------------------------------------------------------------------
create table if not exists public.mc_job_health (
  job                   text primary key,          -- launchd Label, e.g. com.quay1.dialfire-live
  label                 text,                       -- friendly name
  category              text,                       -- 'daemon' | 'scheduled' | 'disabled' | 'other'
  state                 text,                       -- 'ok'|'stalled'|'error'|'idle'|'disabled'|'unknown'
  last_exit             integer,                    -- launchd LastExitStatus
  pid                   integer,                    -- running PID or null
  last_log_ts           timestamptz,                -- newest log activity seen
  expected_interval_secs integer,                   -- for stall detection
  error_count_24h       integer default 0,
  latest_error          text,
  program               text,                       -- ProgramArguments joined
  log_path              text,
  updated_at            timestamptz not null default now()
);
alter table public.mc_job_health enable row level security;
drop policy if exists mc_job_health_super_read on public.mc_job_health;
create policy mc_job_health_super_read on public.mc_job_health
  for select to authenticated using (public.mc_is_super());

-- ---------------------------------------------------------------------------
-- 4. mc_code_errors — deduped error lines pulled from logs (collector-written)
-- ---------------------------------------------------------------------------
create table if not exists public.mc_code_errors (
  fingerprint text primary key,                     -- hash(job|normalised message)
  job         text,
  log_path    text,
  level       text,                                 -- 'ERROR'|'CRITICAL'|'TRACEBACK'|'WARN'
  message     text,
  first_seen  timestamptz,
  last_seen   timestamptz,
  count       integer default 1,
  updated_at  timestamptz not null default now()
);
create index if not exists mc_code_errors_last_idx on public.mc_code_errors (last_seen desc);
alter table public.mc_code_errors enable row level security;
drop policy if exists mc_code_errors_super_read on public.mc_code_errors;
create policy mc_code_errors_super_read on public.mc_code_errors
  for select to authenticated using (public.mc_is_super());

-- ---------------------------------------------------------------------------
-- 5. mc_site_health — per-site up/down ping (collector-written)
-- ---------------------------------------------------------------------------
create table if not exists public.mc_site_health (
  site        text primary key,
  label       text,
  url         text,
  http_status integer,
  ok          boolean,
  response_ms integer,
  checked_at  timestamptz not null default now()
);
alter table public.mc_site_health enable row level security;
drop policy if exists mc_site_health_super_read on public.mc_site_health;
create policy mc_site_health_super_read on public.mc_site_health
  for select to authenticated using (public.mc_is_super());

-- ---------------------------------------------------------------------------
-- 6. mc_collector_heartbeat — single row, collector freshness
-- ---------------------------------------------------------------------------
create table if not exists public.mc_collector_heartbeat (
  id          integer primary key default 1 check (id = 1),
  last_run    timestamptz,
  duration_ms integer,
  host        text,
  version     text,
  note        text,
  updated_at  timestamptz not null default now()
);
alter table public.mc_collector_heartbeat enable row level security;
drop policy if exists mc_collector_heartbeat_super_read on public.mc_collector_heartbeat;
create policy mc_collector_heartbeat_super_read on public.mc_collector_heartbeat
  for select to authenticated using (public.mc_is_super());

-- ---------------------------------------------------------------------------
-- 7. Super read-only access to existing clock tables so the Clock section can
--    query live punches / leave / names client-side. Read-only; does not touch
--    the existing write-guard model.
-- ---------------------------------------------------------------------------
drop policy if exists mc_staff_super_read_all on public.staff;
create policy mc_staff_super_read_all on public.staff
  for select to authenticated using (public.mc_is_super());

drop policy if exists mc_events_super_read_all on public.events;
create policy mc_events_super_read_all on public.events
  for select to authenticated using (public.mc_is_super());

drop policy if exists mc_requests_super_read_all on public.requests;
create policy mc_requests_super_read_all on public.requests
  for select to authenticated using (public.mc_is_super());
