-- v1.20 Block B (StudyDesk#202) — Focus Sync: one shared focus timer per account.
-- APPLIED to production 2026-10-29 with the owner's OK (history version 20261029181521).
--
-- One row per user, holding the timer every device mirrors. StudyDesk-only, like
-- planned_sessions: NCC reads none of it, and nothing here is study time. A
-- finished block still becomes a study_sessions row through the normal save,
-- with the run's id as its id, so a second save of the same block is the same
-- row (src/lib/focusSync.js).
--
-- state (written by src/lib/focusTimer.js, v: 1):
--   { v, runId, origin, by, mode, phase, running, customFocus, session, task,
--     courseId, planId, startedAt, secsAtStart, secsLeft, phaseStartedAt }
--   Times are server epoch ms, so devices with skewed clocks agree.
--
-- Writes are version-guarded: a client updates `where version = <the one it
-- read>` and sends version + 1. The trigger below makes that the only update
-- the table accepts, so a client that skipped the guard cannot silently
-- overwrite a newer write either.
--
-- Not in the supabase_realtime publication. Devices learn of a change from the
-- private `user:<uid>` hint (limecore#68, table name `focus_timers`) and resync
-- on resume and on every channel rejoin.
--
-- Additive (P1). RLS in the same migration (P2). ON DELETE CASCADE, so the
-- delete-account function's auth.admin.deleteUser still erases everything.

create table if not exists public.focus_timers (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  version    integer not null default 1 check (version > 0),
  state      jsonb not null check (
               jsonb_typeof(state) = 'object'
               and pg_column_size(state) <= 4096
             ),
  updated_at timestamptz not null default now()
);

alter table public.focus_timers enable row level security;

drop policy if exists "focus_timers: own row" on public.focus_timers;
create policy "focus_timers: own row"
  on public.focus_timers
  for all
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create or replace function public.focus_timers_version_guard()
returns trigger
language plpgsql
set search_path to ''
as $$
begin
  if new.user_id is distinct from old.user_id then
    raise exception 'focus_timers: user_id cannot change' using errcode = '23514';
  end if;
  if new.version is distinct from old.version + 1 then
    raise exception 'focus_timers: version must go from % to %', old.version, old.version + 1
      using errcode = '40001';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists focus_timers_version_guard on public.focus_timers;
create trigger focus_timers_version_guard
  before update on public.focus_timers
  for each row execute function public.focus_timers_version_guard();
