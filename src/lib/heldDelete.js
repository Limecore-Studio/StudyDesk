// StudyDesk#267 — a one-tap delete can be taken back for a few seconds.
//
// The × on an assignment, exam, study session or grade deleted at once, with
// no confirm and no way back, and it sits right beside the edit pencil. Undo
// over confirm: the row leaves local state at once (so every view, the widget
// and the reminders agree it is gone), but its server delete is HELD for the
// undo window and queued only when the window closes. Undo puts the row back
// exactly as it was; since nothing was ever queued, there is no outbox item to
// chase and no other device ever saw the delete.
//
// The delete is never lost:
//   * the window closing queues it (UNDO_MS);
//   * the app going to the background or closing queues it at once;
//   * a run that dies inside the window leaves the ops stored, and the next
//     sign-in queues them for the same account (replayHeldDelete), the way
//     autoSaveHold.js does for automatic saves.
// One delete is held at a time: a second one queues the first straight away.

import * as outbox from './outbox.js';
import { UNDO_MS } from './doneList.js';

const KEY = 'sd-held-delete';

let held = null;          // { key, title, ops: [kind, payload][], restore, userId, timer }
let currentUser = null;   // set by App; the account a commit may queue for
const listeners = new Set();
const notify = () => { for (const l of listeners) l(); };

/** App tells this module who is signed in (null for a guest or signed out). */
export function setHeldDeleteUser(userId) {
  currentUser = userId || null;
}

function store(userId, ops) {
  try {
    if (userId && ops.length) localStorage.setItem(KEY, JSON.stringify([userId, ops]));
    else localStorage.removeItem(KEY);
  } catch { /* best effort: the window and the hide handler still queue it */ }
}

/**
 * Delete locally now (the caller has dispatched), queue the server delete
 * later. `ops` are the outbox entries the delete needs, as [kind, payload];
 * `restore` is the reducer action that puts the row back.
 */
export function holdDelete({ title, ops, restore }) {
  commitHeldDelete();
  const userId = currentUser;
  held = { key: Date.now(), title, ops: ops || [], restore, userId, timer: null };
  store(userId, held.ops);
  held.timer = setTimeout(commitHeldDelete, UNDO_MS);
  notify();
}

/** The window closed, the app was hidden, or another delete came: queue it. */
export function commitHeldDelete() {
  if (!held) return;
  const h = held;
  held = null;
  clearTimeout(h.timer);
  // Queued only for the account that deleted, and only while it is still the
  // one signed in: a delete made as a guest has nothing to push, and after an
  // account switch the queue belongs to someone else.
  if (h.userId && h.userId === currentUser) {
    for (const [kind, payload] of h.ops) outbox.enqueue(kind, payload);
  }
  store(null, []);
  notify();
}

/** Undo: nothing is queued, and the caller dispatches the returned action. */
export function undoHeldDelete() {
  if (!held) return null;
  const h = held;
  held = null;
  clearTimeout(h.timer);
  store(null, []);
  notify();
  return h.restore;
}

/** What the undo bar shows, or null. */
export function heldDeleteOffer() {
  return held ? { key: held.key, title: held.title } : null;
}

export function onHeldDelete(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** True while this row's delete waits out its window (useCloudPushers must
 *  not queue its own delete for it, or Undo would leave one behind). */
export function isDeleteHeld(id) {
  return Boolean(held?.ops.some(([kind, payload]) => kind.startsWith('delete_') && payload?.id === id));
}

/** The held delete as queue-shaped items, so a pull inside the window does not
 *  bring the deleted row back (pushDiff.withoutQueuedDeletes). */
export function heldDeleteItems() {
  return held ? held.ops.map(([kind, payload]) => ({ kind, payload })) : [];
}

/** On sign-in: queue what a run that died inside the window left stored, for
 *  this account only. */
export function replayHeldDelete(userId, enqueue = outbox.enqueue) {
  try {
    const [u, ops] = JSON.parse(localStorage.getItem(KEY) || 'null') || [];
    if (u && u === userId && Array.isArray(ops)) ops.forEach(([kind, payload]) => enqueue(kind, payload));
  } catch { /* none, or unreadable */ }
  if (!held) store(null, []);
}

// Leaving the app inside the window must not lose the delete.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') commitHeldDelete();
  });
}
if (typeof window !== 'undefined') window.addEventListener('pagehide', commitHeldDelete);

/** Test seam. */
export function __resetHeldDeleteForTest() {
  if (held) clearTimeout(held.timer);
  held = null;
  currentUser = null;
  listeners.clear();
}
