// v1.20 (StudyDesk#156) — progress counters on this device, and their sync.
// Loaded on demand with the counters panel (and by a live-sync hint), so the
// startup bundle carries none of it.
//
// The counters live in their own localStorage key, `sd-counters`, not in the
// reducer state: they are their own small feature, read in one panel, and
// keeping them out of the reducer keeps them out of startup. The key is in
// accountWipe's list, so a sign-out or another account clears it like the
// rest of the account's data.
//
// Writes go through the outbox like every other StudyDesk write (offline
// queue, retries, edit stamps). They are queued only while signed in; a
// guest's counters stay on the device.

import { supabase } from './supabase.js';
import * as outbox from './outbox.js';
import { isPageStale, localDataEpoch } from './deviceOwner.js';
import { counterDayId, mergePulled, findUnsyncedCounters } from './counters.js';

const KEY = 'sd-counters';
const EMPTY = { counters: [], days: [] };

let state = load();
const listeners = new Set();

// limecore#104 — the counters in memory belong to the account (or guest) the
// local data belonged to when they were read. A sign-out or a different
// account wipes the stored copy (accountWipe.js) and changes the local-data
// epoch, but this module outlives that: without this check the next person
// saw the previous account's counters, and the first bump wrote them back
// to storage as their own. The rule: whatever this module holds, or is about
// to write, was read under the current epoch, or it is dropped.
let loadedEpoch = localDataEpoch();

function current() {
  const epoch = localDataEpoch();
  if (epoch !== loadedEpoch) {
    loadedEpoch = epoch;
    state = load();
  }
  return state;
}

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || 'null');
    return s && Array.isArray(s.counters) && Array.isArray(s.days) ? s : EMPTY;
  } catch {
    return EMPTY;
  }
}

function commit(next) {
  state = next;
  if (!isPageStale()) {
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* storage full or blocked */ }
  }
  for (const l of listeners) l();
}

export function getCounters() {
  return current();
}

export function subscribeCounters(listener) {
  listeners.add(listener);
  // Another tab of the desktop or web app counting too.
  const onStorage = (e) => { if (e.key === KEY) { state = load(); listener(); } };
  window.addEventListener('storage', onStorage);
  return () => { listeners.delete(listener); window.removeEventListener('storage', onStorage); };
}

async function signedIn() {
  try {
    const { data } = await supabase.auth.getSession();
    return Boolean(data?.session);
  } catch {
    return false;
  }
}

const now = () => new Date().toISOString();

/** Queue a write once signed in, unless the account changed while waiting:
 *  the outbox it would land in is the next account's. */
async function enqueueIfSignedIn(kind, payload) {
  const epoch = loadedEpoch;
  if (await signedIn() && localDataEpoch() === epoch) outbox.enqueue(kind, payload);
}

export async function saveCounter(input) {
  const state = current();
  const prev = state.counters.find((c) => c.id === input.id);
  const counter = {
    position: state.counters.filter((c) => !c.deletedAt).length,
    ...prev,
    ...input,
    id: input.id || crypto.randomUUID(),
    deletedAt: null,
    updatedAt: now(),
  };
  commit({ ...state, counters: [...state.counters.filter((c) => c.id !== counter.id), counter] });
  await enqueueIfSignedIn('upsert_counter', counter);
  return counter.id;
}

export async function removeCounter(id) {
  const state = current();
  const prev = state.counters.find((c) => c.id === id);
  if (!prev) return;
  const stamp = now();
  commit({
    counters: state.counters.map((c) => (c.id === id ? { ...c, deletedAt: stamp, updatedAt: stamp } : c)),
    days: state.days.filter((d) => d.counterId !== id),
  });
  await enqueueIfSignedIn('delete_counter', { id, updatedAt: stamp });
}

/** Add `delta` to the counter's count for `day` (the user's study day). */
export async function bump(counterId, day, delta) {
  const epoch = loadedEpoch;
  const id = await counterDayId(counterId, day);
  // limecore#104: the tap was on a counter of the data shown before a wipe.
  const state = current();
  if (loadedEpoch !== epoch || !state.counters.some((c) => c.id === counterId && !c.deletedAt)) return;
  const prev = state.days.find((d) => d.id === id);
  const value = Math.round(((prev?.value || 0) + delta) * 100) / 100;
  const row = { id, counterId, day, value, updatedAt: now() };
  commit({ ...state, days: [...state.days.filter((d) => d.id !== id), row] });
  await enqueueIfSignedIn('upsert_counter_day', row);
}

let pulling = null;
let pullingEpoch = null;
/** Pull and fold in what the server has. One at a time, per account: a pull
 *  still running for the previous account does not hold back the next one. */
export function refreshCounters() {
  current();
  if (pulling && pullingEpoch === loadedEpoch) return pulling;
  const epoch = loadedEpoch;
  pullingEpoch = epoch;
  const run = (async () => {
    try {
      if (!(await signedIn())) return;
      const { pullCounters } = await import('./counterSync.js');
      const pulled = await pullCounters();
      // limecore#104: a pull that started for the previous account is
      // dropped, not merged into the next one's (empty) counters.
      if (!pulled || localDataEpoch() !== epoch) return;
      // StudyDesk#236: before the merge, so `local` is what only this device
      // holds. A guest's counters were never queued, and a lost push has no
      // other way back.
      const queuedIds = new Set(outbox.queuedItems().map((it) => it?.payload?.id).filter(Boolean));
      const missing = findUnsyncedCounters(current(), pulled, queuedIds);
      commit(mergePulled(current(), pulled));
      if (missing.length) outbox.enqueueMany(missing);
    } catch (e) {
      console.warn('[counters] pull failed:', e?.message || e);
    } finally {
      if (pulling === run) pulling = null;
    }
  })();
  pulling = run;
  return pulling;
}
