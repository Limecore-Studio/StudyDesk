-- StudyDesk#214 (v1.21) - checks for 20261106_v121_purge_progress_counters.sql.
-- Run against a local Supabase stack loaded with every production migration,
-- never production, with the migration applied first in the SAME transaction,
-- which is then rolled back:
--
--   ( echo 'begin;'
--     cat supabase/migrations/20261106_v121_purge_progress_counters.sql
--     cat supabase/tests/v121_purge_progress_counters.test.sql
--     echo 'rollback;' ) | psql "$LOCAL_DB_URL" -v ON_ERROR_STOP=1
--
-- One PASS/FAIL line per check; the final RAISE makes psql exit non-zero if
-- anything failed.

set client_min_messages = notice;

create temp table results (name text, ok boolean);

insert into auth.users (id, email) values ('21421421-4214-2142-1421-421421421421', 'purge214@test.local');

-- old: tombstoned 100 days ago, with two days. recent: tombstoned 10 days ago.
-- live: never deleted.
insert into public.progress_counters (id, user_id, name, unit, deleted_at) values
  ('a0000000-0000-4000-8000-000000000214', '21421421-4214-2142-1421-421421421421', 'old',    'pages', now() - interval '100 days'),
  ('b0000000-0000-4000-8000-000000000214', '21421421-4214-2142-1421-421421421421', 'recent', 'pages', now() - interval '10 days'),
  ('c0000000-0000-4000-8000-000000000214', '21421421-4214-2142-1421-421421421421', 'live',   'pages', null);
insert into public.progress_counter_days (id, user_id, counter_id, day, value) values
  ('a1000000-0000-4000-8000-000000000214', '21421421-4214-2142-1421-421421421421', 'a0000000-0000-4000-8000-000000000214', date '2026-07-01', 3),
  ('a2000000-0000-4000-8000-000000000214', '21421421-4214-2142-1421-421421421421', 'a0000000-0000-4000-8000-000000000214', date '2026-07-02', 4),
  ('c1000000-0000-4000-8000-000000000214', '21421421-4214-2142-1421-421421421421', 'c0000000-0000-4000-8000-000000000214', date '2026-11-01', 5);

create temp table purge_out as select * from public.purge_soft_deleted();

insert into results values
  ('reports a progress_counters row',
     exists (select 1 from purge_out where table_name = 'progress_counters')),
  ('purges at least the old tombstone',
     (select purged from purge_out where table_name = 'progress_counters') >= 1),
  ('old tombstone gone',
     not exists (select 1 from public.progress_counters where id = 'a0000000-0000-4000-8000-000000000214')),
  ('its days cascaded',
     not exists (select 1 from public.progress_counter_days where counter_id = 'a0000000-0000-4000-8000-000000000214')),
  ('recent tombstone kept (inside the 90 days)',
     exists (select 1 from public.progress_counters where id = 'b0000000-0000-4000-8000-000000000214')),
  ('live counter and its day kept',
     exists (select 1 from public.progress_counters where id = 'c0000000-0000-4000-8000-000000000214')
     and exists (select 1 from public.progress_counter_days where id = 'c1000000-0000-4000-8000-000000000214')),
  ('every table the function reported before is still reported',
     (select count(*) from purge_out) = 22),
  ('still security definer with the pinned search_path',
     (select prosecdef and proconfig @> array['search_path=pg_catalog, public, pg_temp']
        from pg_proc where oid = 'public.purge_soft_deleted(interval)'::regprocedure));

-- The guard refuses a second run, now that the function has changed.
do $$
declare refused boolean := false;
begin
  begin
    if md5(pg_get_functiondef('public.purge_soft_deleted(interval)'::regprocedure))
         <> 'e6220bd68b3c23d12f573526919c8380' then
      raise exception 'guard';
    end if;
  exception when others then refused := true;
  end;
  insert into results values ('guard refuses a re-run on the new body', refused);
end $$;

select case when ok then 'PASS' else 'FAIL' end as result, name from results;

do $$
begin
  if exists (select 1 from results where not ok) then
    raise exception '% check(s) failed', (select count(*) from results where not ok);
  end if;
end $$;
