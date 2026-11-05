-- StudyDesk#156 (v1.20) — checks for 20261030_progress_counters.sql, run
-- against a local Supabase stack loaded with every production migration (the
-- real auth schema, set_updated_at() and subjects), never production.
-- Everything runs in one transaction that is rolled back.
--
-- Run:
--   psql "$LOCAL_DB_URL" -v ON_ERROR_STOP=1 \
--     -f supabase/migrations/20261030_progress_counters.sql \
--     -f supabase/tests/progress_counters.test.sql
--
-- One PASS/FAIL line per check, then a summary; the final RAISE makes psql exit
-- non-zero if anything failed.

\set ON_ERROR_STOP 1
set client_min_messages = notice;
begin;

create temp table results (name text, ok boolean);
grant all on results to authenticated;

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'counter-a@test.local'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'counter-b@test.local');

insert into results
select 'rls on: ' || t, (select relrowsecurity from pg_class where oid = ('public.' || t)::regclass)
  from unnest(array['progress_counters', 'progress_counter_days']) t;

-- ── as user A ───────────────────────────────────────────────────────────────
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', true);

insert into public.progress_counters (id, user_id, name, unit, period, target)
values ('cccccccc-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'Physics book', 'pages', 'total', 320);
insert into public.progress_counter_days (id, user_id, counter_id, day, value, updated_at)
values ('dddddddd-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
        'cccccccc-0000-0000-0000-000000000001', '2026-10-29', 12, now() - interval '1 minute');
insert into results select 'owner inserts a counter and a day', (select count(*) = 1 from public.progress_counter_days);

-- Last writer wins on the edit stamp.
update public.progress_counter_days set value = 99, updated_at = now() - interval '2 minutes'
 where id = 'dddddddd-0000-0000-0000-000000000001';
insert into results select 'an older write does not win', (select value = 12 from public.progress_counter_days);
update public.progress_counter_days set value = 15, updated_at = now()
 where id = 'dddddddd-0000-0000-0000-000000000001';
insert into results select 'a newer write wins', (select value = 15 from public.progress_counter_days);

-- One row per counter per day, whatever id a device made.
do $$ begin
  insert into public.progress_counter_days (id, user_id, counter_id, day, value)
  values (gen_random_uuid(), 'aaaaaaaa-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001', '2026-10-29', 1);
  insert into results values ('a second row for the same day is refused', false);
exception when unique_violation then
  insert into results values ('a second row for the same day is refused', true);
end $$;

-- Delete wins: a tombstone lands, and an older edit cannot undo it.
update public.progress_counters set deleted_at = now(), updated_at = now() - interval '1 hour'
 where id = 'cccccccc-0000-0000-0000-000000000001';
update public.progress_counters set name = 'Renamed', updated_at = now() - interval '30 minutes'
 where id = 'cccccccc-0000-0000-0000-000000000001';
insert into results select 'tombstone lands; an older edit does not revive it',
  (select deleted_at is not null and name = 'Physics book' from public.progress_counters);

-- Constraints.
do $$ begin
  insert into public.progress_counters (id, user_id, name, unit, period)
  values (gen_random_uuid(), 'aaaaaaaa-0000-0000-0000-000000000001', 'x', 'pages', 'month');
  insert into results values ('an unknown period is refused', false);
exception when check_violation then insert into results values ('an unknown period is refused', true);
end $$;
do $$ begin
  insert into public.progress_counters (id, user_id, name, unit, target)
  values (gen_random_uuid(), 'aaaaaaaa-0000-0000-0000-000000000001', 'x', 'pages', 0);
  insert into results values ('a zero target is refused', false);
exception when check_violation then insert into results values ('a zero target is refused', true);
end $$;

-- ── as user B ───────────────────────────────────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000002","role":"authenticated"}', true);
insert into results select 'B sees none of A''s counters or days',
  (select count(*) = 0 from public.progress_counters) and (select count(*) = 0 from public.progress_counter_days);
update public.progress_counter_days set value = 0 where id = 'dddddddd-0000-0000-0000-000000000001';
do $$ begin
  insert into public.progress_counter_days (id, user_id, counter_id, day, value)
  values (gen_random_uuid(), 'aaaaaaaa-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001', '2026-10-30', 1);
  insert into results values ('B cannot write as A', false);
exception when insufficient_privilege then insert into results values ('B cannot write as A', true);
end $$;

reset role;
insert into results select 'B''s update did not reach A''s day',
  (select value = 15 from public.progress_counter_days where id = 'dddddddd-0000-0000-0000-000000000001');

-- ── cascades ────────────────────────────────────────────────────────────────
delete from public.progress_counters where id = 'cccccccc-0000-0000-0000-000000000001';
insert into results select 'deleting a counter takes its days', (select count(*) = 0 from public.progress_counter_days);
insert into public.progress_counters (id, user_id, name, unit)
values ('cccccccc-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000002', 'Essay', 'pages');
delete from auth.users where id = 'aaaaaaaa-0000-0000-0000-000000000002';
insert into results select 'deleting the account takes its counters',
  (select count(*) = 0 from public.progress_counters where id = 'cccccccc-0000-0000-0000-000000000002');

-- ── report ──────────────────────────────────────────────────────────────────
select (case when ok then 'PASS ' else 'FAIL ' end) || name as result from results;
do $$
declare bad int;
begin
  select count(*) into bad from results where not ok;
  raise notice '% checks, % failed', (select count(*) from results), bad;
  if bad > 0 then raise exception 'progress_counters: % check(s) failed', bad; end if;
end $$;

rollback;
