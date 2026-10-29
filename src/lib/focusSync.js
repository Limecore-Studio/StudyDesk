// v1.20 Block B (StudyDesk#202) — Focus Sync: one focus timer per account,
// shared live between the user's devices. Loaded on demand after sign-in, with
// the live-sync engine.
//
// The model is felt's room pattern (limecore#69):
//   - one row per user in `focus_timers`, holding the shared state and a
//     version; every write is `where version = <the one this device has>`;
//   - after a write, a `changed` hint for `focus_timers` on the private user
//     topic (liveSync.js) makes the other devices read the row at once;
//   - a resync on start, on return to the app and on every channel rejoin
//     covers a hint that never arrived;
//   - a write that finds a newer version lost the race: this device applies
//     the newer state instead (two devices pressing Start together end up on
//     one run), so state only ever moves forward.
//
// The local side is the `sd-timer` record (lib/timerSnapshot.js). A change
// TimerView persists is sent if it means something (focusTimer.transitionKey);
// a remote state is written into the record, and a mounted TimerView reloads
// from it (FOCUS_REMOTE_EVENT).
//
// Saving: only one device raises the save sheet for a block (see
// focusTimer.savesCompletion and TimerView), and the session's id is the run's
// id, so even a second save of the same block is the same study_sessions row.

import { supabase } from './supabase.js';
import { serverNow } from './serverClock.js';
import { TIMER_CHANGE_EVENT } from './timerSnapshot.js';
import { isPageStale } from './deviceOwner.js';
import {
  FOCUS_TIMERS_TABLE, FOCUS_REMOTE_EVENT, focusDeviceId, toShared, toLocal, transitionKey, sameTransition,
} from './focusTimer.js';

const TIMER_KEY = 'sd-timer';
const STATE_KEY = 'sd-focus-sync';
// A start, pause or stop goes out almost at once; typing in the task line
// waits long enough to fold a word into one write.
const SEND_SOON_MS = 100;
const SEND_TYPING_MS = 600;
// Position of the task in transitionKey's array (focusTimer.js).
const TASK_INDEX = 5;

/** True when the only difference from what was last sent is the task text. */
function onlyTaskChanged(a, b) {
  if (!a || !b) return false;
  // Same tolerance as sameTransition: a re-anchor is not a change.
  const sameAnchor = a.anchor === null || b.anchor === null
    ? a.anchor === b.anchor : Math.abs(a.anchor - b.anchor) < 2000;
  if (!sameAnchor) return false;
  try {
    const x = JSON.parse(a.key), y = JSON.parse(b.key);
    return x.every((v, i) => i === TASK_INDEX || v === y[i]) && x[TASK_INDEX] !== y[TASK_INDEX];
  } catch {
    return false;
  }
}
// A return to the app reads one small row; this only stops a burst of
// focus/visibility events from reading it several times.
const RESYNC_MIN_MS = 2000;

let session = null;

const offset = () => serverNow() - Date.now();

function readTimer() {
  try {
    const rec = JSON.parse(localStorage.getItem(TIMER_KEY) || 'null');
    return rec && typeof rec === 'object' ? rec : null;
  } catch {
    return null;
  }
}

/** What this device last agreed with the server, per account: the version it
 *  holds and the state it meant. Survives a restart, so an edit made while the
 *  app was closed (or offline) is still recognised as unsent. */
function loadSynced(userId) {
  try {
    const all = JSON.parse(localStorage.getItem(STATE_KEY) || '{}');
    const s = all?.[userId];
    return s && Number.isInteger(s.version) ? s : { version: 0, key: null };
  } catch {
    return { version: 0, key: null };
  }
}
function saveSynced(userId, synced) {
  try {
    const all = JSON.parse(localStorage.getItem(STATE_KEY) || '{}') || {};
    all[userId] = synced;
    localStorage.setItem(STATE_KEY, JSON.stringify(all));
  } catch { /* storage full or blocked: the next resync re-reads the row */ }
}

async function readRow(userId) {
  const { data, error } = await supabase
    .from(FOCUS_TIMERS_TABLE)
    .select('version, state')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** Write a remote state into `sd-timer`, keeping this device's own fields, and
 *  tell the timer screen and the pill. */
function apply(s, row) {
  const prev = readTimer() || {};
  const rec = {
    ...prev,
    ...toLocal(row.state, { offset: offset() }),
    // This device's own: Lock In and the day's count. A run joined from
    // another device is not Lock In here until the user says so.
    lockedIn: Boolean(prev.lockedIn),
    focusDone: Number(prev.focusDone) || 0,
  };
  s.synced = { version: row.version, key: transitionKey(rec) };
  saveSynced(s.userId, s.synced);
  s.applying = true;
  try {
    localStorage.setItem(TIMER_KEY, JSON.stringify(rec));
    window.dispatchEvent(new CustomEvent(FOCUS_REMOTE_EVENT, { detail: rec }));
    window.dispatchEvent(new CustomEvent(TIMER_CHANGE_EVENT));
  } finally {
    s.applying = false;
  }
}

/** Send the local record, guarded by the version this device holds. */
async function send(s) {
  if (session !== s || isPageStale()) return;
  const rec = readTimer();
  if (!rec) return;
  const key = transitionKey(rec);
  if (sameTransition(key, s.synced.key)) return;
  const state = toShared(rec, { offset: offset(), by: s.device });
  const expected = s.synced.version;
  let res;
  if (expected === 0) {
    res = await supabase.from(FOCUS_TIMERS_TABLE)
      .insert({ user_id: s.userId, version: 1, state })
      .select('version')
      .maybeSingle();
    // Someone made the row first: theirs is the newer state.
    if (res.error?.code === '23505') return resync(s, { force: true });
  } else {
    res = await supabase.from(FOCUS_TIMERS_TABLE)
      .update({ version: expected + 1, state })
      .eq('user_id', s.userId)
      .eq('version', expected)
      .select('version')
      .maybeSingle();
    // No row at `expected`: another device moved first, or the row was
    // removed. Either way the server's state is the one to show.
    if (!res.error && !res.data) return resync(s, { force: true });
  }
  if (res.error) throw res.error;
  if (session !== s) return;
  s.synced = { version: res.data.version, key };
  saveSynced(s.userId, s.synced);
  s.announce?.([FOCUS_TIMERS_TABLE]);
}

/**
 * Read the row and catch up. A newer version from another device is applied;
 * this device's own last write is just adopted. A local change made while
 * offline or closed is sent if the server has not moved on since.
 */
async function resync(s, { force = false } = {}) {
  if (session !== s || isPageStale()) return;
  const now = Date.now();
  if (!force && now - s.lastResync < RESYNC_MIN_MS) return;
  s.lastResync = now;
  const row = await readRow(s.userId);
  if (session !== s) return;
  if (!row) {
    // Nothing shared yet (or the row was reset): this device's timer, if it
    // has one, becomes the shared one.
    s.synced = { version: 0, key: null };
    saveSynced(s.userId, s.synced);
    if (readTimer()) await send(s);
    return;
  }
  if (row.version > s.synced.version) {
    const local = readTimer();
    const mine = row.state?.by === s.device && local
      && sameTransition(transitionKey(local), transitionKey(toLocal(row.state, { offset: offset() })));
    if (mine) {
      s.synced = { version: row.version, key: transitionKey(local) };
      saveSynced(s.userId, s.synced);
    } else {
      apply(s, row);
    }
    return;
  }
  // Same version as this device: anything local that differs is unsent.
  const local = readTimer();
  if (local && !sameTransition(transitionKey(local), s.synced.key)) await send(s);
}

function run(s, job) {
  // One request at a time per device, in order: a send and a resync must not
  // interleave their version reads.
  s.chain = s.chain.then(() => job()).catch((e) => {
    console.warn('[focus] sync failed:', e?.message || e);
  });
  return s.chain;
}

/**
 * Start Focus Sync for a signed-in user. `announce(tables)` sends the live
 * hint (liveSync.announceChanged); it may be set later with setAnnouncer.
 */
export function startFocusSync({ userId, announce = null }) {
  if (session?.userId === userId) return;
  stopFocusSync();
  const s = {
    userId,
    device: focusDeviceId(),
    announce,
    synced: loadSynced(userId),
    lastResync: 0,
    applying: false,
    sendTimer: null,
    chain: Promise.resolve(),
    detach: () => {},
  };
  session = s;

  const onLocal = () => {
    if (s.applying || session !== s) return;
    const rec = readTimer();
    const key = rec && transitionKey(rec);
    if (key && sameTransition(key, s.synced.key)) return;
    clearTimeout(s.sendTimer);
    const delay = key && onlyTaskChanged(key, s.synced.key) ? SEND_TYPING_MS : SEND_SOON_MS;
    s.sendTimer = setTimeout(() => { void run(s, () => send(s)); }, delay);
  };
  const onReturn = () => {
    if (document.visibilityState === 'visible') void run(s, () => resync(s));
  };
  window.addEventListener(TIMER_CHANGE_EVENT, onLocal);
  window.addEventListener('focus', onReturn);
  window.addEventListener('online', onReturn);
  document.addEventListener('visibilitychange', onReturn);
  s.detach = () => {
    window.removeEventListener(TIMER_CHANGE_EVENT, onLocal);
    window.removeEventListener('focus', onReturn);
    window.removeEventListener('online', onReturn);
    document.removeEventListener('visibilitychange', onReturn);
    clearTimeout(s.sendTimer);
  };
  void run(s, () => resync(s, { force: true }));
}

export function setAnnouncer(fn) {
  if (session) session.announce = fn;
}

/** Read the row now: a live hint for `focus_timers`, or a full resync. */
export function refreshFocusSync() {
  const s = session;
  if (!s) return Promise.resolve();
  return run(s, () => resync(s, { force: true }));
}

export function stopFocusSync() {
  const s = session;
  session = null;
  s?.detach();
}

/** For tests: wait for queued work. */
export function __settled() {
  return session ? session.chain : Promise.resolve();
}
