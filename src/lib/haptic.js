// limecore#130 — haptic feedback, the same three kinds in every Limecore app.
//
// Policy (owner decision 2026-11-19): a haptic confirms the user's OWN action
// and never interrupts.
//   * light   — a tick (assignment, exam, to-do), a timer start or pause;
//   * success — a focus block finished, a grade saved;
//   * warning — confirming something destructive (deleting a course).
// Nothing on scroll, navigation, page loads, sync or any background event.
// The OS "touch feedback" setting is respected by the plugin itself; StudyDesk
// has no in-app switch for it and does not add one.
//
// Replaces the timer's `navigator.vibrate`, which did nothing on Android: the
// app never held VIBRATE, so the WebView ignored it. @capacitor/haptics merges
// that permission (install-time, no prompt).
//
// Native only, and the plugin loads on first use, so startup carries none of
// it. A failure is swallowed: feedback is never worth an error.

import { Capacitor } from '@capacitor/core';

// One import, cached: every call after the first reuses the same promise.
let mod = null;
const load = () => (mod ??= import('@capacitor/haptics').catch(() => null));

/** Returns a promise that settles when the feedback was requested (or skipped),
 *  so a test can await it; callers in the app fire and forget. */
function run(fn) {
  if (!Capacitor.isNativePlatform()) return Promise.resolve();
  return load().then((m) => (m ? fn(m) : null)).catch(() => {});
}

export const haptic = {
  light: () => run((m) => m.Haptics.impact({ style: m.ImpactStyle.Light })),
  success: () => run((m) => m.Haptics.notification({ type: m.NotificationType.Success })),
  warning: () => run((m) => m.Haptics.notification({ type: m.NotificationType.Warning })),
};
