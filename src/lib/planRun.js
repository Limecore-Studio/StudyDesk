// v1.19 (#185) — a scheduled study block run in the pomodoro timer.
//
// Before this, a planned block and the timer did not know about each other.
// Saving a timer round during a block made a study session the block never
// heard of; the block then showed as "missed", and the only way to close it
// was the calendar's Log button, which wrote a SECOND session. Two sessions
// for one hour of study is the kind of number Life Score and every stat in
// NCC take at face value.
//
// The rule now: one block makes one session.
//   - The timer carries the block's id (`planId`, persisted in `sd-timer`).
//   - The first saved focus round of that run creates the session and links
//     the block to it (`fulfilledBy`), exactly as the calendar's Log does.
//   - Every later round finds the session THROUGH the block's `fulfilledBy`
//     and adds its minutes to it, instead of writing a new one. Nothing else
//     needs to remember the session id, so a reload or a killed process
//     between rounds cannot lose the link.
//
// Partial counts as kept (CTO decision on #185): 35 minutes of a 60-minute
// block saves 35, and the block shows as kept.

/** A block still owed: has a start, not kept, not skipped, not deleted. */
export function isOpenPlan(p) {
  return !!(p && p.startsAt && !p.fulfilledBy && !p.dismissedAt && !p.deletedAt);
}

const startMs = (p) => new Date(p.startsAt).getTime();

/** How long after its start a block is still offered when the app comes to the front. */
export const OFFER_WINDOW_MS = 10 * 60 * 1000;

/**
 * The block to offer in the start sheet at `now`: open, started within the
 * last `windowMs`, and not in `skip` (ids already offered or snoozed this
 * run of the app). Overlapping blocks: the one whose start is closest to now.
 */
export function planToOffer(plans, now, { windowMs = OFFER_WINDOW_MS, skip } = {}) {
  let best = null;
  for (const p of plans || []) {
    if (!isOpenPlan(p) || skip?.has?.(p.id)) continue;
    const at = startMs(p);
    if (!Number.isFinite(at) || at > now || now - at > windowMs) continue;
    if (!best || at > startMs(best)) best = p;
  }
  return best;
}

/** Epoch ms of the next open block's start after `now`, or null. */
export function nextPlanStartAt(plans, now) {
  let next = null;
  for (const p of plans || []) {
    if (!isOpenPlan(p)) continue;
    const at = startMs(p);
    if (Number.isFinite(at) && at > now && (next === null || at < next)) next = at;
  }
  return next;
}

/** Open blocks starting in [dayStart, dayEnd), earliest first — the Today list. */
export function openPlansBetween(plans, dayStart, dayEnd) {
  return (plans || [])
    .filter((p) => isOpenPlan(p))
    .filter((p) => { const at = startMs(p); return at >= dayStart && at < dayEnd; })
    .sort((a, b) => startMs(a) - startMs(b));
}

/**
 * What saving a timer round does, as data: reducer actions in dispatch order
 * and outbox operations in enqueue order.
 *
 * `save` is what SaveSessionSheet hands back (subjectId, durationMinutes,
 * notes, startedAt, focusRating, ai*). `planId` is the run's block, or null
 * for a free timer run, which behaves exactly as before.
 */
export function planSaveSteps({ save, planId, plans, sessions, newId }) {
  const plan = planId ? (plans || []).find((p) => p.id === planId && !p.deletedAt) : null;
  const linked = plan?.fulfilledBy
    ? (sessions || []).find((s) => s.id === plan.fulfilledBy && !s.deletedAt)
    : null;

  if (linked) {
    // A later round of the same run: the block already has its session, so
    // this round's minutes go onto it. Notes are only filled in if the first
    // round left them blank, never overwritten; the rating is the latest one.
    const durationMinutes = Math.min(1440, (Number(linked.durationMinutes) || 0) + (Number(save.durationMinutes) || 0));
    const patch = { id: linked.id, durationMinutes };
    if (!linked.notes && save.notes) patch.notes = save.notes;
    if (save.focusRating != null) patch.focusRating = save.focusRating;
    return {
      kind: 'extend',
      sessionId: linked.id,
      actions: [{ type: 'EDIT_SESSION', ...patch }],
      outbox: [['update_session', patch]],
    };
  }

  const row = {
    id: newId,
    subjectId: save.subjectId || null,
    startedAt: save.startedAt,
    durationMinutes: save.durationMinutes,
    notes: save.notes,
    focusRating: save.focusRating,
    aiDebriefRaw: save.aiDebriefRaw,
    aiSubjectCovered: save.aiSubjectCovered,
    aiComprehension: save.aiComprehension,
    aiConfusionFlags: save.aiConfusionFlags,
    aiSessionSummary: save.aiSessionSummary,
  };
  const actions = [{ type: 'ADD_SESSION', ...row }];
  const outbox = [['log_session', row]];
  if (plan) {
    actions.push({ type: 'RESOLVE_PLANNED', id: plan.id, fulfilledBy: newId });
    // After the session: `fulfilled_by` is a foreign key onto study_sessions.
    // The outbox also ranks log_session first, so this holds across a partial
    // drain too, but the enqueue order states the intent.
    outbox.push(['upsert_planned', {
      id: plan.id,
      subjectId: plan.subjectId,
      startsAt: plan.startsAt,
      durationMinutes: plan.durationMinutes,
      title: plan.title,
      notes: plan.notes,
      fulfilledBy: newId,
      dismissedAt: null,
      seriesId: plan.seriesId ?? null,
    }]);
  }
  return { kind: plan ? 'link' : 'free', sessionId: newId, actions, outbox };
}
