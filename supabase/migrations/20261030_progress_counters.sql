-- v1.20 Block C (StudyDesk#156) — progress counters: pages, chapters or hours
-- counted with +/− buttons, per book or course, against an optional daily,
-- weekly or overall target.
-- NOT YET APPLIED to production: the owner applies it.
--
-- StudyDesk-only, like planned_sessions: NCC reads neither table, and a
-- counter is not study time (P1: a counted hour must never be written into
-- study_sessions).
--
-- progress_counters       one row per counter.
--   period: 'total' (progress through a book) | 'day' | 'week' (a quota).
--   unit:   the user's own label ("pages", "chapters", "hours", ...).
-- progress_counter_days   one row per counter per day: that day's count. The
--   client derives the id from (counter, day), so two devices counting on the
--   same day write the same row, and the newer write wins (set_updated_at).
--   Totals and weeks are sums of days, worked out on the device.
--
-- Deletes are tombstones on progress_counters (delete wins); a counter's days
-- go with it when the row itself is deleted (ON DELETE CASCADE). The 90-day
-- purge of these tombstones is a follow-up: NCC#92's pending migration
-- rewrites purge_soft_deleted() too, and two migrations rewriting it in
-- parallel would each drop the other's lines.
--
-- Not in the supabase_realtime publication: devices learn of a change from
-- the private `user:<uid>` hint (limecore#68) and on every full pull.
--
-- P1: two new tables, additive. P2: RLS and an owner-only policy on each, in
-- this migration. ON DELETE CASCADE from auth.users, so delete-account still
-- erases everything.

create table if not exists public.progress_counters (
  id          uuid primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 80),
  unit        text not null check (char_length(unit) between 1 and 24),
  period      text not null default 'total' check (period in ('total', 'day', 'week')),
  target      numeric(10, 2) check (target is null or (target > 0 and target <= 100000)),
  subject_id  uuid references public.subjects (id) on delete set null,
  position    integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

create table if not exists public.progress_counter_days (
  id          uuid primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  counter_id  uuid not null references public.progress_counters (id) on delete cascade,
  day         date not null,
  value       numeric(10, 2) not null default 0 check (value between -100000 and 100000),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (counter_id, day)
);

create index if not exists progress_counters_user_idx on public.progress_counters (user_id);
create index if not exists progress_counter_days_user_idx on public.progress_counter_days (user_id);
create index if not exists progress_counters_subject_idx on public.progress_counters (subject_id);

alter table public.progress_counters enable row level security;
alter table public.progress_counter_days enable row level security;

drop policy if exists "progress_counters: own rows" on public.progress_counters;
create policy "progress_counters: own rows"
  on public.progress_counters for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "progress_counter_days: own rows" on public.progress_counter_days;
create policy "progress_counter_days: own rows"
  on public.progress_counter_days for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Last writer wins on the edit stamp, and a tombstone always lands: the same
-- trigger every other synced table uses.
drop trigger if exists progress_counters_set_updated_at on public.progress_counters;
create trigger progress_counters_set_updated_at
  before insert or update on public.progress_counters
  for each row execute function public.set_updated_at();

drop trigger if exists progress_counter_days_set_updated_at on public.progress_counter_days;
create trigger progress_counter_days_set_updated_at
  before insert or update on public.progress_counter_days
  for each row execute function public.set_updated_at();
