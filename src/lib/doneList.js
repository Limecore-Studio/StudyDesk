// v1.19 (#87, #98) — the Done list: what has been ticked off, newest first,
// and a way back for anything ticked by mistake.
//
//   > "Is it possible to see already ticked off tasks and get them back into
//      your upcoming menu? I ticked some off by mistake and I can't remember
//      what they said."   (#87; #98 reported the same for homework)
//
// Nothing about the data was missing: TOGGLE_ASSIGNMENT / TOGGLE_EXAM /
// TOGGLE_ACTION already flip `done` both ways and sync through the usual
// pusher. What was missing was anywhere to see a done item from Next Up, and
// Next Up's own tasks were DELETED the morning after they were ticked, so
// those really were gone. They are now kept for DONE_ACTION_KEEP_DAYS.

/** Done Next Up tasks are kept this long, then removed as before. */
export const DONE_ACTION_KEEP_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/** A done task old enough to remove for good. Undone tasks never are. */
export function isExpiredDoneAction(a, now = Date.now()) {
  if (!a?.done) return false;
  // A done task with no doneAt predates the stamp; it has no age to keep.
  if (!a.doneAt) return true;
  return now - a.doneAt > DONE_ACTION_KEEP_DAYS * DAY_MS;
}

const ms = (v) => (typeof v === 'number' ? v : new Date(v || 0).getTime()) || 0;

/**
 * Everything ticked off, newest first, optionally for one course.
 * Tasks know when they were done (`doneAt`). Assignments and exams do not:
 * their `updatedAt` is the best signal there is — it is the tick, unless the
 * row was edited after being ticked, in which case it is that edit.
 */
export function doneItems(state, { courseId = null } = {}) {
  const out = [];
  const keep = (row) => !row.deletedAt && (!courseId || row.courseId === courseId);
  for (const a of state.actions || []) {
    if (a.done && !a.suggested && keep(a)) out.push({ kind: 'action', id: a.id, title: a.text, courseId: a.courseId || null, at: ms(a.doneAt) });
  }
  for (const a of state.assignments || []) {
    if (a.done && keep(a)) out.push({ kind: 'assignment', id: a.id, title: a.title, courseId: a.courseId || null, at: ms(a.updatedAt) });
  }
  for (const e of state.exams || []) {
    if (e.done && keep(e)) out.push({ kind: 'exam', id: e.id, title: e.title, courseId: e.courseId || null, at: ms(e.updatedAt) });
  }
  return out.sort((x, y) => y.at - x.at);
}

/** [[YYYY-MM-DD (local), items[]], …] in the order given (newest first). */
export function groupByDay(items) {
  const groups = new Map();
  for (const it of items) {
    const d = new Date(it.at);
    const key = it.at ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : '';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(it);
  }
  return [...groups.entries()];
}

/** The reducer action that unticks (or re-ticks) an item of this kind. */
export function toggleFor(item) {
  return { type: item.kind === 'action' ? 'TOGGLE_ACTION' : item.kind === 'exam' ? 'TOGGLE_EXAM' : 'TOGGLE_ASSIGNMENT', id: item.id };
}

// ── Undo, right after ticking ─────────────────────────────────────────────
// The common misclick should never need the Done list. Any place that ticks
// something off offers an undo here; App shows it for a few seconds. One at a
// time: a second tick replaces the first offer.

export const UNDO_MS = 5000;
let listener = null;

/** Called by App with a setter; returns the unsubscribe. */
export function onUndoOffer(fn) {
  listener = fn;
  return () => { if (listener === fn) listener = null; };
}

/** Offer to undo a tick: `undo` is the reducer action that reverses it. */
export function offerUndo(title, undo) {
  listener?.({ title, undo, key: Date.now() });
}
