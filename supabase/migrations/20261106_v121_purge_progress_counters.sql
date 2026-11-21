-- v1.21 (StudyDesk#214) - progress counter tombstones are purged after the
-- retention window, like every other soft-deleted table.
--
-- Why this was left out of #156: purge_soft_deleted() was being rewritten by
-- NCC#226's migration (20261030_v120_tombstones.sql), and two migrations
-- rewriting one function in parallel drop each other's lines. That migration
-- is live, so this one takes the function as it now is and adds one block.
--
-- What it deletes: `progress_counters` rows whose deleted_at is older than the
-- cutoff. A counter's `progress_counter_days` go with it through their
-- ON DELETE CASCADE foreign key (the days have no deleted_at of their own; a
-- counter's days mean nothing without the counter). Nothing references
-- `progress_counters` except its days, so there is no child to guard.
--
-- Everything else in the function is byte-identical to the live body read on
-- 2026-11-06 (checked: the body below minus the new block has the live
-- prosrc's md5). create or replace keeps the owner and the grants.

-- -- Guard: only extend the purge function we have actually read --------------
-- Live definition read 2026-11-06 (after NCC#226 / 20261030_v120_tombstones).
do $$
begin
  if md5(pg_get_functiondef('public.purge_soft_deleted(interval)'::regprocedure))
       <> 'e6220bd68b3c23d12f573526919c8380' then
    raise exception 'StudyDesk#214: purge_soft_deleted() changed since 2026-11-06; re-read it and update this migration';
  end if;
end $$;

CREATE OR REPLACE FUNCTION public.purge_soft_deleted(retain interval DEFAULT '90 days'::interval)
 RETURNS TABLE(table_name text, purged bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  cutoff timestamptz := now() - retain;
  n bigint;
begin
  delete from grades          where deleted_at is not null and deleted_at < cutoff;
  get diagnostics n = row_count; table_name := 'grades'; purged := n; return next;

  delete from study_sessions  where deleted_at is not null and deleted_at < cutoff;
  get diagnostics n = row_count; table_name := 'study_sessions'; purged := n; return next;

  delete from readings        where deleted_at is not null and deleted_at < cutoff;
  get diagnostics n = row_count; table_name := 'readings'; purged := n; return next;

  delete from transactions    where deleted_at is not null and deleted_at < cutoff;
  get diagnostics n = row_count; table_name := 'transactions'; purged := n; return next;

  -- CHANGED: guard extended from 3 children to all 8. `assignments` and
  -- `exams` are the load-bearing additions — they are ON DELETE CASCADE, so
  -- omitting them is what made this function destructive rather than merely
  -- incomplete.
  delete from subjects s
   where s.deleted_at is not null and s.deleted_at < cutoff
     and not exists (select 1 from grades g            where g.subject_id  = s.id and g.deleted_at  is null)
     and not exists (select 1 from study_sessions ss   where ss.subject_id = s.id and ss.deleted_at is null)
     and not exists (select 1 from readings r          where r.subject_id  = s.id and r.deleted_at  is null)
     and not exists (select 1 from assignments a       where a.subject_id  = s.id and a.deleted_at  is null)
     and not exists (select 1 from exams e             where e.subject_id  = s.id and e.deleted_at  is null)
     and not exists (select 1 from study_actions sa    where sa.subject_id = s.id and sa.deleted_at is null)
     and not exists (select 1 from timetable_entries t where t.subject_id  = s.id and t.deleted_at  is null)
     and not exists (select 1 from planned_sessions p  where p.subject_id  = s.id and p.deleted_at  is null);
  get diagnostics n = row_count; table_name := 'subjects'; purged := n; return next;

  delete from budget_categories bc
   where bc.deleted_at is not null and bc.deleted_at < cutoff
     and not exists (select 1 from transactions t where t.category_id = bc.id and t.deleted_at is null);
  get diagnostics n = row_count; table_name := 'budget_categories'; purged := n; return next;

  delete from manual_assets ma
   where ma.deleted_at is not null and ma.deleted_at < cutoff
     and not exists (select 1 from transactions t
                      where (t.account_id = ma.id or t.destination_account_id = ma.id)
                        and t.deleted_at is null);
  get diagnostics n = row_count; table_name := 'manual_assets'; purged := n; return next;

  delete from goals            where deleted_at is not null and deleted_at < cutoff;
  get diagnostics n = row_count; table_name := 'goals'; purged := n; return next;

  delete from portfolio_lots   where deleted_at is not null and deleted_at < cutoff;
  get diagnostics n = row_count; table_name := 'portfolio_lots'; purged := n; return next;

  -- NCC#92: a parent of portfolio_lots (ON DELETE CASCADE): skip any holding
  -- that still has a live lot.
  delete from portfolio_holdings ph
   where ph.deleted_at is not null and ph.deleted_at < cutoff
     and not exists (select 1 from portfolio_lots l where l.holding_id = ph.id and l.deleted_at is null);
  get diagnostics n = row_count; table_name := 'portfolio_holdings'; purged := n; return next;

  -- NCC#92
  delete from stock_sales      where deleted_at is not null and deleted_at < cutoff;
  get diagnostics n = row_count; table_name := 'stock_sales'; purged := n; return next;

  -- NCC#92
  delete from portfolio_cash_entries where deleted_at is not null and deleted_at < cutoff;
  get diagnostics n = row_count; table_name := 'portfolio_cash_entries'; purged := n; return next;

  -- NCC#202: generated rows have no foreign key to their rule, so a rule
  -- tombstone has no children to guard.
  delete from recurring_rules  where deleted_at is not null and deleted_at < cutoff;
  get diagnostics n = row_count; table_name := 'recurring_rules'; purged := n; return next;

  -- NCC#92 (v1.20)
  delete from habit_completions where deleted_at is not null and deleted_at < cutoff;
  get diagnostics n = row_count; table_name := 'habit_completions'; purged := n; return next;

  -- NCC#92 (v1.20): a parent of habit_completions (ON DELETE CASCADE). A
  -- deleted habit's days go with it: they mean nothing without the habit, and
  -- NCC tombstones them alongside it.
  delete from habits           where deleted_at is not null and deleted_at < cutoff;
  get diagnostics n = row_count; table_name := 'habits'; purged := n; return next;

  -- NCC#92 (v1.20)
  delete from work_quality_logs where deleted_at is not null and deleted_at < cutoff;
  get diagnostics n = row_count; table_name := 'work_quality_logs'; purged := n; return next;

  -- NCC#92 (v1.20): the column existed, the purge line did not.
  delete from braindump_entries where deleted_at is not null and deleted_at < cutoff;
  get diagnostics n = row_count; table_name := 'braindump_entries'; purged := n; return next;

  delete from tasks            where deleted_at is not null and deleted_at < cutoff;
  get diagnostics n = row_count; table_name := 'tasks'; purged := n; return next;

  delete from watchlist_items  where deleted_at is not null and deleted_at < cutoff;
  get diagnostics n = row_count; table_name := 'watchlist_items'; purged := n; return next;

  delete from workout_sessions where deleted_at is not null and deleted_at < cutoff;
  get diagnostics n = row_count; table_name := 'workout_sessions'; purged := n; return next;

  -- StudyDesk#214 (v1.21): a counter's days cascade with it.
  delete from progress_counters where deleted_at is not null and deleted_at < cutoff;
  get diagnostics n = row_count; table_name := 'progress_counters'; purged := n; return next;

  -- limecore#16: error reports are kept for the retention window, then go.
  -- Not a soft delete: a report is removed by age alone.
  delete from client_errors    where created_at < cutoff;
  get diagnostics n = row_count; table_name := 'client_errors'; purged := n; return next;
end;
$function$;
