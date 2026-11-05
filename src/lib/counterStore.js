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
import { isPageStale } from './deviceOwner.js';
import { counterDayId, mergePulled } from './counters.js';

const KEY = 'sd-counters';
const EMPTY = { counters: [], days: [] };

let state = load();
const listeners = new Set();

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
  return state;
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

export async function saveCounter(input) {
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
  if (await signedIn()) outbox.enqueue('upsert_counter', counter);
  return counter.id;
}

export async function removeCounter(id) {
  const prev = state.counters.find((c) => c.id === id);
  if (!prev) return;
  const stamp = now();
  commit({
    counters: state.counters.map((c) => (c.id === id ? { ...c, deletedAt: stamp, updatedAt: stamp } : c)),
    days: state.days.filter((d) => d.counterId !== id),
  });
  if (await signedIn()) outbox.enqueue('delete_counter', { id, updatedAt: stamp });
}

/** Add `delta` to the counter's count for `day` (the user's study day). */
export async function bump(counterId, day, delta) {
  const id = await counterDayId(counterId, day);
  const prev = state.days.find((d) => d.id === id);
  const value = Math.round(((prev?.value || 0) + delta) * 100) / 100;
  const row = { id, counterId, day, value, updatedAt: now() };
  commit({ ...state, days: [...state.days.filter((d) => d.id !== id), row] });
  if (await signedIn()) outbox.enqueue('upsert_counter_day', row);
}

let pulling = null;
/** Pull and fold in what the server has. One at a time. */
export function refreshCounters() {
  if (pulling) return pulling;
  pulling = (async () => {
    try {
      if (!(await signedIn())) return;
      const { pullCounters } = await import('./counterSync.js');
      const pulled = await pullCounters();
      if (pulled) commit(mergePulled(state, pulled));
    } catch (e) {
      console.warn('[counters] pull failed:', e?.message || e);
    } finally {
      pulling = null;
    }
  })();
  return pulling;
}
