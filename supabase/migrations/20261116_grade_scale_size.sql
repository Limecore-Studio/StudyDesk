-- v1.21.1 (StudyDesk#233) — the grade scale's size limit fits every scale the
-- client can make.
-- NOT YET APPLIED to production. Owner approval is in principle; applying it
-- still needs a confirmation and a backup first.
--
-- 20261022_user_preferences_grade_scale.sql capped the column at 1024 bytes,
-- written before scales had named steps and report bands (v1.19, #178). The
-- DE15 / DIA preset is 1,474 bytes as jsonb, so it could never be saved. The
-- largest scale the client can produce (40 steps, 20 bands, every label and
-- the name at their caps, measured with pg_column_size on the local stack) is
-- 4,650 bytes. New limit: 8,192.
--
-- Same shape rule, higher limit only. Everything that fit before still fits,
-- so no shipped version of StudyDesk or NCC is affected. The DROP is expected:
-- a CHECK cannot be altered in place.

alter table public.user_preferences
  drop constraint if exists user_preferences_grade_scale_shape;

alter table public.user_preferences
  add constraint user_preferences_grade_scale_shape check (
    grade_scale is null or (
      jsonb_typeof(grade_scale) = 'object'
      and grade_scale ->> 'mode' in ('ib', 'us', 'custom')
      and pg_column_size(grade_scale) <= 8192
    )
  );
