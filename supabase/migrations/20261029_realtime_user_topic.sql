-- v1.20 Block A (limecore#68): Realtime Authorization for the private per-user topic.
-- Each signed-in user may receive and send broadcast messages on `user:<own uid>` only.
-- The payload is a hint ({ app, table, ids?, at, device }); row data always comes from
-- an RLS-scoped pull, never from the message. Additive only (P1): two new policies on a
-- table that has RLS on and no policies today, so before this every private channel join
-- was refused. Public channels (postgres_changes, used by every shipped app) are not
-- affected: they do not consult realtime.messages.
-- Presence is deliberately not granted; nothing uses it yet.

create policy "user topic: receive own broadcasts"
  on realtime.messages
  for select
  to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and realtime.topic() = 'user:' || (select auth.uid())::text
  );

create policy "user topic: send own broadcasts"
  on realtime.messages
  for insert
  to authenticated
  with check (
    realtime.messages.extension = 'broadcast'
    and realtime.topic() = 'user:' || (select auth.uid())::text
  );
