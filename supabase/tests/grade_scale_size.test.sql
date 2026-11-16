-- StudyDesk#233 — the raised grade_scale limit, run against a Supabase stack
-- that already has user_preferences (local stack, never production). Wrapped
-- in a transaction that is always rolled back, so it leaves nothing behind.
--
-- Run (the migration is loaded inside the transaction first):
--   docker cp supabase <db container>:/work
--   docker exec <db container> psql -U postgres -q -v ON_ERROR_STOP=1 \
--     -f /work/tests/grade_scale_size.test.sql
--
-- Sizes measured 2026-11-16 with pg_column_size: DE15 1,474 B; the largest
-- scale the client can produce 4,650 B.
begin;
\i /work/migrations/20261116_grade_scale_size.sql

insert into auth.users (id, instance_id, aud, role, email)
values ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'gs-test@example.invalid');
insert into public.user_preferences (user_id) values ('00000000-0000-4000-8000-0000000000a1');

do $$
declare
  uid uuid := '00000000-0000-4000-8000-0000000000a1';
  steps jsonb := (select jsonb_agg(jsonb_build_object('label', repeat('界', 6), 'value', -99999.99 + i * 0.01))
                  from generate_series(0, 39) i);
  bands jsonb := (select jsonb_agg(jsonb_build_object('min', -99999.99 + i, 'max', -99999.5 + i, 'grade', -99999.99 + i))
                  from generate_series(0, 19) i);
  largest jsonb := jsonb_build_object('v', 1, 'mode', 'custom', 'updatedAt', '2026-11-16T00:00:00.000Z',
    'custom', jsonb_build_object('min', -99999.99, 'max', 99999.99, 'passMark', -99999.99, 'direction', 'down',
      'name', repeat('界', 24), 'steps', steps,
      'report', jsonb_build_object('enabled', true, 'method', 'averageThenConvert', 'best', -99999.99,
        'worst', 99999.98, 'bands', bands)));
  rejected boolean;
begin
  if pg_column_size(largest) <= 1024 then raise exception 'FAIL: fixture too small to test'; end if;
  update public.user_preferences set grade_scale = largest where user_id = uid;
  raise notice 'PASS: largest client scale (% B) is accepted', pg_column_size(largest);

  rejected := false;
  begin
    update public.user_preferences
      set grade_scale = jsonb_build_object('mode', 'custom', 'pad', repeat('x', 9000)) where user_id = uid;
  exception when check_violation then rejected := true;
  end;
  if not rejected then raise exception 'FAIL: a value over 8192 B was accepted'; end if;
  raise notice 'PASS: over 8192 B is refused';

  rejected := false;
  begin
    update public.user_preferences set grade_scale = '{"mode":"bogus"}' where user_id = uid;
  exception when check_violation then rejected := true;
  end;
  if not rejected then raise exception 'FAIL: the shape rule was lost'; end if;
  raise notice 'PASS: the shape rule still holds';
end $$;
rollback;
