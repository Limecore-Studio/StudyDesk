// v1.18.2 — the grade scale follows the account, so NCC can read it.
//
// StudyDesk kept `gradeMode` and `customScale` in localStorage only
// ("studydesk-grade-mode" / "studydesk-grade-scale"). NCC reads StudyDesk's
// grades from the synced tables but had no way to learn the scale they are on,
// so it guessed from the numbers: anything up to 10 was taken as IB 1–7. A
// German 1–6 scale (1 is best) was then shown as "x/7".
//
// The scale now also lives in `user_preferences.grade_scale` (jsonb):
//
//   { v: 1, mode: 'ib' | 'us' | 'custom',
//     custom: { min, max, passMark, direction, name } | null,
//     updatedAt: ISO string }
//
// localStorage stays the fast path and the only path for guests. Rules:
//   - A change made while signed in marks the scale dirty for that account and
//     is pushed after a short debounce (the custom-scale fields change on every
//     keystroke). The dirty mark is cleared once the push lands.
//   - On sign-in: a dirty scale for this account is pushed (it is newer than
//     anything on the server). Otherwise the server's scale is applied when it
//     exists, and the local one is pushed up when it does not (back-fill, so
//     NCC learns the scale of an account that set it before this version).
//   - Applying the server's scale is not a local change: the baseline is moved
//     to it first, so the change watcher does not echo it back.

import { supabase } from './supabase.js';
import { isGradeMode, normalizeScale } from './gradeScale.js';

const DIRTY_KEY = 'studydesk-grade-scale-dirty'; // holds the user id it is dirty for
// v1.21.1 (StudyDesk#233): user id + scaleKey of the scale the server refused
// with a CHECK violation. That exact scale is not sent again, so
// a refused save no longer retries on every launch. The dirty mark stays, so
// the server's older scale does not replace the local one either.
const REFUSED_KEY = 'studydesk-grade-scale-refused';
const PUSH_DELAY_MS = 1500;
// v1.22 (StudyDesk#246): whose scale the local one is. A scale another
// account set is never back-filled into the next account's preferences.
const OWNER_KEY = 'studydesk-grade-scale-owner';

/** The comparable identity of a scale setting. */
export function scaleKey(mode, custom) {
  return JSON.stringify([mode, mode === 'custom' ? normalizeScale(custom) : null]);
}

/** What goes into user_preferences.grade_scale. */
export function toCloud(mode, custom, now = new Date()) {
  return {
    v: 1,
    mode,
    custom: mode === 'custom' ? normalizeScale(custom) : null,
    updatedAt: now.toISOString(),
  };
}

/** Parse the server value. Null when absent or unusable. */
export function fromCloud(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (!isGradeMode(raw.mode)) return null;
  if (raw.mode === 'custom' && (!raw.custom || typeof raw.custom !== 'object')) return null;
  return { mode: raw.mode, custom: raw.mode === 'custom' ? normalizeScale(raw.custom) : null };
}

// v1.22 (StudyDesk#246): the dirty mark is { userId, editedAt }, so a local
// edit that never reached the server can be compared with a newer one made on
// another device. A pre-v1.22 mark is the bare user id; its edit time is
// unknown, so it keeps winning as it did.
function readDirty() {
  let raw = null;
  try { raw = localStorage.getItem(DIRTY_KEY); } catch { return null; }
  if (!raw) return null;
  try {
    const o = JSON.parse(raw);
    if (o && typeof o.userId === 'string') return { userId: o.userId, editedAt: Number(o.editedAt) || null };
  } catch { /* the bare-id form */ }
  return { userId: raw, editedAt: null };
}
function dirtyFor() {
  return readDirty()?.userId ?? null;
}
function setDirty(userId) {
  try { localStorage.setItem(DIRTY_KEY, JSON.stringify({ userId, editedAt: Date.now() })); } catch { /* best-effort */ }
}
function clearDirty(userId) {
  try { if (dirtyFor() === userId) localStorage.removeItem(DIRTY_KEY); } catch { /* best-effort */ }
}
function scaleOwner() {
  try { return localStorage.getItem(OWNER_KEY); } catch { return null; }
}
function setOwner(userId) {
  try { userId ? localStorage.setItem(OWNER_KEY, userId) : localStorage.removeItem(OWNER_KEY); } catch { /* best-effort */ }
}

// Stored as user id + scaleKey; null removes it.
function markRefused(value) {
  try { value ? localStorage.setItem(REFUSED_KEY, value) : localStorage.removeItem(REFUSED_KEY); } catch { /* best-effort */ }
}

let baseline = null;   // scaleKey of the setting we last synced or adopted
let timer = null;
let pending = null;    // { userId, mode, custom }

// Told once per refused save (App shows the message).
let onRefused = null;
export function onScaleRefused(fn) { onRefused = fn; }

/** Reset between tests. */
export function _resetForTests() {
  baseline = null;
  if (timer) clearTimeout(timer);
  timer = null;
  pending = null;
}

export async function pushGradeScale(userId, mode, custom) {
  if (!userId) return false;
  try {
    const { error } = await supabase.from('user_preferences').upsert(
      { user_id: userId, grade_scale: toCloud(mode, custom), updated_at: new Date().toISOString() },
      { onConflict: 'user_id' },
    );
    if (error) {
      console.warn('[grade-scale] cloud write failed:', error.message);
      // 23514: the server will refuse this scale every time. Say so once.
      if (error.code === '23514') {
        markRefused(userId + scaleKey(mode, custom));
        onRefused?.();
      }
      return false;
    }
    markRefused(null);
    // Only clear when nothing newer is waiting.
    if (!pending || pending.userId !== userId) clearDirty(userId);
    return true;
  } catch (e) {
    console.warn('[grade-scale] cloud write threw:', e?.message);
    return false;
  }
}

function schedulePush(userId, mode, custom) {
  pending = { userId, mode, custom };
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    const p = pending;
    pending = null;
    timer = null;
    if (p) void pushGradeScale(p.userId, p.mode, p.custom);
  }, PUSH_DELAY_MS);
}

/** Call with the current setting whenever it may have changed. Before the
 *  first sync or baseline, and for the setting we just adopted, it does
 *  nothing. A real change is marked dirty and pushed when signed in. */
export function onLocalScaleChange(mode, custom, userId) {
  if (baseline === null) return;
  const k = scaleKey(mode, custom);
  if (k === baseline) return;
  baseline = k;
  setOwner(userId);
  if (!userId) return;   // guest: device-only, as before
  setDirty(userId);
  schedulePush(userId, mode, custom);
}

/** Signed out or guest: the current setting is the baseline. */
export function setBaseline(mode, custom) {
  baseline = scaleKey(mode, custom);
}

/** Run once per signed-in account. `apply(mode, custom)` dispatches the
 *  server's scale into the app. Always leaves a baseline set, even when the
 *  network fails, so later changes are still noticed. */
export async function syncGradeScaleOnSignIn(userId, local, apply) {
  baseline = null;
  if (!userId) { setBaseline(local.mode, local.custom); return 'guest'; }
  try {
    const dirty = readDirty();
    const mine = dirty?.userId === userId;
    if (mine && dirty.editedAt === null) {
      setBaseline(local.mode, local.custom);
      if (localStorage.getItem(REFUSED_KEY) === userId + scaleKey(local.mode, local.custom)) return 'refused';
      await pushGradeScale(userId, local.mode, local.custom);
      return 'pushed-dirty';
    }
    const { data, error } = await supabase
      .from('user_preferences')
      .select('grade_scale')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) { setBaseline(local.mode, local.custom); return 'error'; }
    const cloud = fromCloud(data?.grade_scale);
    // StudyDesk#246: a local edit that never landed wins only when it is newer
    // than the scale another device has saved since.
    if (mine) {
      const serverAt = Date.parse(data?.grade_scale?.updatedAt ?? '');
      if (!cloud || !(serverAt > dirty.editedAt)) {
        setBaseline(local.mode, local.custom);
        if (localStorage.getItem(REFUSED_KEY) === userId + scaleKey(local.mode, local.custom)) return 'refused';
        await pushGradeScale(userId, local.mode, local.custom);
        return 'pushed-dirty';
      }
      clearDirty(userId);
    }
    if (cloud) {
      setOwner(userId);
      baseline = scaleKey(cloud.mode, cloud.custom);
      if (baseline !== scaleKey(local.mode, local.custom)) apply(cloud.mode, cloud.custom);
      return 'applied';
    }
    // StudyDesk#246: only this account's own scale (or one from before the
    // owner was recorded) is back-filled. Another account's goes back to the
    // default for this one, and nothing is written for it.
    const owner = scaleOwner();
    if (owner && owner !== userId) {
      baseline = scaleKey('ib', null);
      setOwner(userId);
      apply('ib', null);
      return 'reset-other-account';
    }
    setOwner(userId);
    setBaseline(local.mode, local.custom);
    await pushGradeScale(userId, local.mode, local.custom);
    return 'backfilled';
  } catch {
    setBaseline(local.mode, local.custom);
    return 'error';
  }
}
