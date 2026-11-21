// The two pushers that diff state instead of enqueueing at call sites.
// Moved out of App.jsx unchanged and called from the same place (limecore#12).
import { useEffect, useRef } from "react";
import * as outbox from "../lib/outbox.js";
import { snapshotPushState, diffPushes } from "../lib/pushDiff.js";
import { runLegacyPush } from "../lib/legacyPush.js";
import { isDeleteHeld } from "../lib/heldDelete.js";

export function useCloudPushers({ session, state, pulledOnce, remoteStampsRef, showFlash, t }) {
  // ── v1.0.4 one-shot post-migration push ─────────────────────────────────────
  // The UUID migration in the reducer init may have rewritten local IDs. Those
  // rewritten rows have never reached Supabase (the old short-ID pushes were
  // failing silently). Push everything once after sign-in. Subjects must go
  // before grades (FK), grades before sessions doesn't matter (no FK between).
  // Fire-and-forget per row, log failures — next user edit will retry.
  //
  // v1.18.1 (StudyDesk#146): queued through the outbox after the first pull,
  // instead of pushed directly before it, and the flag is cleared once the
  // queue write lands. Pushed directly, each row was stamped with the push
  // time, and one row that could never succeed (a to-do whose course was
  // deleted before it synced fails its foreign key) kept the flag set, so
  // EVERY launch re-sent the whole dataset stamped "now" and overwrote edits
  // made on other devices. Now only the to-dos the server lacks are queued:
  // reconcile, in the same pull, queues every other row it lacks (see
  // legacyPush.js). The flash says "waiting to sync", since queued is not
  // yet synced.
  useEffect(() => {
    if (!session || !pulledOnce) return;
    // The first pull failed, so what the server holds is unknown. The flag
    // stays, and the next launch tries again.
    if (!remoteStampsRef.current) return;
    const queued = runLegacyPush(state, remoteStampsRef.current);
    if (queued > 0) showFlash(t('av.flash.queuedLegacy', { count: queued }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id, pulledOnce]);

  // ── v1.7 push reconciler for assignments / exams / actions (StudyDesk#6) ────
  //
  // Courses, grades and sessions enqueue their own pushes at each call site.
  // These three deliberately do not, and the reason is structural: they are
  // mutated from ~15 places across AsgnItem, ExamCard and ActionsView, none of
  // which receive `session`. Threading it through every one of those props
  // would be a wide change to working components, and any call site missed
  // would be an edit that silently never syncs — the exact bug being fixed.
  //
  // Instead: diff the three arrays after every state change and enqueue what
  // actually moved. One place, no call sites to miss, and it picks up any
  // future mutation path for free.
  const pushBaseline = useRef(null);
  // v1.18.1 (StudyDesk#161): whose rows the baseline holds. Switching straight
  // from one account to another kept the first account's baseline, and after
  // the wipe every one of its rows looked deleted: a delete was queued for
  // each, under the new account (RLS made them no-ops; the queue churned).
  const baselineUser = useRef(null);
  useEffect(() => {
    if (!session) { pushBaseline.current = null; baselineUser.current = null; return; }
    if (baselineUser.current !== (session.user?.id ?? null)) {
      pushBaseline.current = null;
      baselineUser.current = session.user?.id ?? null;
    }
    const next = snapshotPushState(state);

    // StudyDesk#232: the baseline is the state the session started with, not
    // the first render after the launch pull. Arming only after the pull made
    // the post-pull state the baseline, so an edit or delete made while the
    // pull was in flight (or before a failed one) was swallowed into it and
    // never queued. The old worry, that pushing before the pull lets a stale
    // device win, does not apply to a diff: only rows edited here are queued,
    // each carrying its own edit stamp, and the server's LWW guard refuses a
    // stamp older than what it holds. A pull's own changes are filtered by the
    // stamps below; before the first pull there are none, and every change is
    // a local edit. Account switches wipe and reset state in the same render
    // that changes the user id (App.jsx applySession), so the baseline for a
    // new account is its own, empty, state.
    if (!pushBaseline.current) { pushBaseline.current = next; return; }

    // StudyDesk#72 — `stamps` is what the last pull returned (see pushDiff.js).
    for (const { kind, payload } of diffPushes(pushBaseline.current, next, state, remoteStampsRef.current)) {
      // StudyDesk#267: a one-tap delete in its undo window is queued by
      // heldDelete.js when the window closes, never here.
      if (kind.startsWith("delete_") && isDeleteHeld(payload.id)) continue;
      outbox.enqueue(kind, payload);
    }
    pushBaseline.current = next;
  // `session` is read for the sign-in gate only; the identity that matters is
  // the user id, which the pull effect already keys on.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id, state.assignments, state.exams, state.actions]);
}
