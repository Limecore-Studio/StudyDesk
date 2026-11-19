// StudyDesk#241 — the pomodoro's end alarm while the app is in the background.
//
// The beep and vibration come from the JS tick, and a hidden WebView is
// throttled or frozen, so a block that ended with the screen off said nothing
// until the app was opened again. While the app is hidden and a countdown is
// running, one local notification is scheduled for its end; it is cancelled
// when the app comes back (the in-app alert takes over) and moved whenever the
// timer changes (pause, skip, a change from another device). Native only.
//
// Loaded on demand from useAppEvents.js, so startup carries none of it. Reads
// `sd-timer`, the timer's one source of truth (see timerSnapshot.js), so it
// works whichever screen is open.

import { LocalNotifications } from '@capacitor/local-notifications';
import i18n from '../i18n/index.js';

/** Below the reminder ID range (100000 up, planNotifications.reminderId). One
 *  timer runs at a time, so one fixed ID: scheduling again replaces it. */
export const FOCUS_END_ID = 99917;

/** When the running countdown in `rec` (the `sd-timer` record) ends, as epoch
 *  ms, or null when nothing will end: not running, a stopwatch, or already
 *  over. Same arithmetic as timerSnapshot.readTimerSnapshot. */
export function focusEndAt(rec, now = Date.now()) {
  if (!rec || !rec.running || rec.mode === 'stopwatch') return null;
  if (!Number.isFinite(rec.startedAt) || !Number.isFinite(rec.secsAtStart)) return null;
  const at = rec.startedAt + rec.secsAtStart * 1000;
  return at > now ? at : null;
}

function readTimer() {
  try {
    const rec = JSON.parse(localStorage.getItem('sd-timer') || 'null');
    return rec && typeof rec === 'object' ? rec : null;
  } catch {
    return null;
  }
}

let scheduledAt = null;
let chain = Promise.resolve();

/** Bring the alarm in line with the timer: scheduled for the countdown's end
 *  while `hidden`, otherwise cancelled. Calls are serialised; a call that would
 *  change nothing does nothing. */
export function syncFocusEndAlarm(hidden) {
  chain = chain.then(async () => {
    const rec = readTimer();
    const at = hidden ? focusEndAt(rec) : null;
    // Within two seconds is the same end: a resume re-anchors startedAt.
    if (at === scheduledAt || (at && scheduledAt && Math.abs(at - scheduledAt) < 2000)) return;
    try {
      if (scheduledAt) await LocalNotifications.cancel({ notifications: [{ id: FOCUS_END_ID }] });
      scheduledAt = null;
      if (!at) return;
      const isBreak = rec.phase === 'short' || rec.phase === 'long';
      await LocalNotifications.schedule({
        notifications: [{
          id: FOCUS_END_ID,
          title: i18n.t(isBreak ? 'notif.breakEndTitle' : 'notif.focusEndTitle'),
          body: i18n.t(isBreak ? 'notif.breakEndBody' : 'notif.focusEndBody'),
          schedule: { at: new Date(at), allowWhileIdle: true },
          smallIcon: 'ic_stat_studydesk',
          iconColor: '#8b4a62',
          // `focusEnd` keeps the reminder scheduler from cancelling it as not
          // one of its own (planNotifications.js). `sa`: the patched plugin
          // drops it after a reboot rather than firing it late.
          extra: { view: 'timer', focusEnd: true, sa: at + 15 * 60 * 1000 },
        }],
      });
      scheduledAt = at;
    } catch (e) {
      console.warn('[StudyDesk] focus end alarm failed:', e?.message || e);
    }
  });
  return chain;
}
