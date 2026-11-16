// v1.21.1 (StudyDesk#253, #254) — an automatic save waiting out its Undo
// window (App.jsx, v1.21 #205).
//
// #253: a full pull inside the window used to let reconcile push the new
// session (its id is local-only), so Undo removed it locally while the server
// kept it, and it came back. Reconcile now skips every id held here.
//
// #254: the outbox ops were only in memory. An extend or link of an existing
// session is not something reconcile can recover (it re-pushes only ids the
// server has never seen), so if the app died inside the window the added
// minutes never reached the server or NCC. The ops are now stored until the
// window closes or Undo runs, and a stored record left by a run that died is
// queued on the next launch.
const KEY = 'sd-autosave';

export const heldIds = new Set();

/** A save enters its window, with its session and plan ids (null is fine).
 *  The record is best-effort: losing it costs only an extend or link, and
 *  reconcile still covers a new session. */
export function hold(sessionId, planId, userId, ops) {
  release();
  heldIds.add(sessionId).add(planId);
  try { if (userId) localStorage.setItem(KEY, JSON.stringify([userId, ops])); } catch { /* best-effort */ }
}

/** The window closed (pushed) or Undo ran. */
export function release() {
  heldIds.clear();
  try { localStorage.removeItem(KEY); } catch { /* best-effort */ }
}

/** On sign-in (App's sync effect, once per user id): queue what a run that
 *  died left held, for this account only. A save held in this run cannot be
 *  replayed here: it was stored under the user id this effect already ran for. */
export function replayHeld(userId, enqueue) {
  try {
    const [u, ops] = JSON.parse(localStorage.getItem(KEY)) || [];
    if (u === userId) ops.forEach((op) => enqueue(...op));   // [kind, payload]
  } catch { /* none, or unreadable */ }
  release();
}
