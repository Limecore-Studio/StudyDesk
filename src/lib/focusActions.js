// StudyDesk#289 — Pause / Resume / +5 min / End from the focus chip (the
// Live Update in the shade, the Now Bar on One UI 8).
//
// A chip button opens the app (FocusModePlugin, EXTRA_ACTION), including from
// a killed process; the action then arrives here. The timer's one source of
// truth is `sd-timer` (see timerSnapshot.js), so the action is applied to that
// record and announced the way a change from another device is
// (FOCUS_REMOTE_EVENT): a mounted Timer screen loads it, an unmounted one
// reads it on mount, and the pill, the chip, the background alarm and Focus
// Sync all follow TIMER_CHANGE_EVENT. Loaded on demand, on Android only.

import { TIMER_CHANGE_EVENT } from './timerSnapshot.js';
import { FOCUS_REMOTE_EVENT } from './focusTimer.js';

const KEY = 'sd-timer';
const PLUS_SECS = 5 * 60;
/** Same rule as the Timer screen's Stop: under a minute is a misclick. */
const MIN_LOGGABLE_SECS = 60;

/**
 * The timer record after `action`, and the session End produces (or null).
 * `rec: null` means "nothing to do" (an action that no longer applies, such
 * as Pause on a block that has already run out). Pure.
 */
export function applyFocusAction(rec, action, now = Date.now()) {
  if (!rec || typeof rec !== 'object') return { rec: null, session: null };
  const sw = rec.mode === 'stopwatch';
  const cf = rec.customFocus || 25;
  const timed = Boolean(rec.running) && Number.isFinite(rec.startedAt) && Number.isFinite(rec.secsAtStart);
  const elapsedRun = timed ? Math.floor((now - rec.startedAt) / 1000) : 0;
  const secsNow = timed
    ? (sw ? rec.secsAtStart + elapsedRun : Math.max(0, rec.secsAtStart - elapsedRun))
    : (Number.isFinite(rec.secsLeft) ? rec.secsLeft : cf * 60);
  const over = !sw && secsNow <= 0;

  switch (action) {
    case 'pause':
      if (!timed || over) return { rec: null, session: null };
      return { rec: { ...rec, running: false, secsLeft: secsNow, startedAt: null, secsAtStart: null }, session: null };
    case 'resume':
      if (rec.running || over) return { rec: null, session: null };
      return { rec: { ...rec, running: true, secsLeft: secsNow, startedAt: now, secsAtStart: secsNow }, session: null };
    case 'plus5': {
      if (sw) return { rec: null, session: null };
      // The block grows, not just the clock: the Timer screen measures a
      // focus block as customFocus minus what is left, and a completed block
      // is saved at customFocus minutes.
      const grow = rec.phase === 'focus' || !rec.phase ? { customFocus: cf + 5 } : {};
      return {
        rec: { ...rec, ...grow, secsLeft: secsNow + PLUS_SECS, ...(timed ? { startedAt: now, secsAtStart: secsNow + PLUS_SECS } : {}) },
        session: null,
      };
    }
    case 'end': {
      let session = null;
      if (rec.phase === 'focus' || !rec.phase) {
        const elapsed = sw ? secsNow : cf * 60 - secsNow;
        if (elapsed >= MIN_LOGGABLE_SECS) {
          session = {
            durationMinutes: Math.max(1, Math.round(elapsed / 60)),
            task: rec.task || '',
            subjectId: rec.courseId || null,
            startedAt: new Date(Number.isFinite(rec.phaseStartedAt) ? rec.phaseStartedAt : now - elapsed * 1000).toISOString(),
            planId: rec.planId || null,
            runId: rec.runId || null,
          };
        }
      }
      return {
        rec: {
          ...rec, running: false, phase: 'focus', secsLeft: sw ? 0 : cf * 60,
          startedAt: null, secsAtStart: null, phaseStartedAt: null, runId: null, planId: null,
        },
        session,
      };
    }
    default:
      return { rec: null, session: null };
  }
}

/** Apply `action` to the stored timer and announce it. End hands its session
 *  to `onSession` (App's onTimerComplete: the save sheet, as Stop does). */
export function runFocusAction(action, onSession) {
  let rec = null;
  try { rec = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { rec = null; }
  const { rec: next, session } = applyFocusAction(rec, action);
  if (!next) return;
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* storage blocked */ }
  window.dispatchEvent(new CustomEvent(FOCUS_REMOTE_EVENT, { detail: next }));
  window.dispatchEvent(new CustomEvent(TIMER_CHANGE_EVENT));
  if (session) onSession?.(session);
}
