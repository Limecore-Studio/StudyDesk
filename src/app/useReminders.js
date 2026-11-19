// Plan and deadline reminders: OS alarms on Android, the polling loop on web.
// Moved out of App.jsx unchanged and called from the same place (limecore#12).
//
// v1.22 (limecore#126): the reminder code itself loads on demand. Nothing it
// does is on first paint: both effects below already run after it. Every call
// goes through one cached import promise, so schedule and cancel calls still
// run in the order the effects fired. The chunk ships inside the APK and the
// desktop build, so it loads offline; on the web it comes with the first launch.
import { useEffect, useRef } from "react";
import { Capacitor } from "@capacitor/core";

let planNotificationsLoad = null;
let planNotifications = null;
function loadPlanNotifications() {
  planNotificationsLoad ??= import("../lib/planNotifications.js").then(
    (m) => (planNotifications = m),
    (e) => { planNotificationsLoad = null; throw e; },
  );
  return planNotificationsLoad;
}

export function useReminders({ onboarded, state, t }) {
  // Schedule notifications after onboarding with fresh state (#21 fix)
  // Reschedule notifications whenever exams or assignments change (not just onboarding)
  useEffect(() => {
    if (!onboarded) return;
    loadPlanNotifications().then(({ scheduleNotifications, cancelAllNotifications }) => {
      // notifEnabled is what makes "Maybe later" mean anything. Before this gate
      // both onboarding buttons ran the same path, so declining still reached
      // scheduleNotifications — which calls requestPermissions() and therefore
      // raised the very OS prompt the user had just declined.
      if (state.notifEnabled) {
        scheduleNotifications(
          state.exams, state.assignments, state.courses,
          state.plannedSessions,
          { lead: state.planRemindLead, atStart: state.planRemindStart },
          t,
        );
      } else {
        // Turning them off must also clear anything already scheduled, or
        // reminders keep arriving from a previous session's schedule.
        cancelAllNotifications();
      }
    }, (e) => console.warn("[studydesk] reminders failed to load:", e));
    // state.courses belongs here: notification bodies carry the course name, so
    // renaming a course left stale text scheduled until an exam or assignment
    // happened to change.
    // plannedSessions and both reminder prefs belong here for the same reason
    // state.courses does: the schedule is derived from them, so changing one
    // without rescheduling leaves the OS holding a stale set of alarms.
  }, [onboarded, state.notifEnabled, state.exams, state.assignments, state.courses,
      state.plannedSessions, state.planRemindLead, state.planRemindStart, t]);

  // ── Web reminders (v1.10) ────────────────────────────────────────────────
  //
  // Android gets OS alarms through LocalNotifications; the browser has no
  // equivalent, so on web the same two preferences are served by a polling
  // loop. See lib/webNotify.js for why it polls rather than setTimeout, and
  // for the honest limit: this fires while StudyDesk is OPEN in a tab, hidden
  // or minimised included, and cannot fire once the tab is closed.
  //
  // The loop reads through a ref so it is started once. Passing state directly
  // would rebuild it on every plan edit and every keystroke in Settings, which
  // resets the tick and drops whatever was about to fire.
  const webNotifyState = useRef(null);
  // Written during render on purpose, as it was in App.jsx: the loop only
  // reads it on its next tick. The React Compiler lint never analysed App's
  // body, so this hook is the first place it sees the pattern (limecore#12).
  // Since v1.22 (on-demand loading below) the lint no longer reports it here,
  // so the `react-hooks/refs` suppression that sat on the next line is gone.
  webNotifyState.current = {
    enabled: onboarded && state.notifEnabled,
    plans: state.plannedSessions,
    courses: state.courses,
    prefs: { lead: state.planRemindLead, atStart: state.planRemindStart },
    labels: {
      fallback: t('notif.planFallback'),
      now: t('notif.planNowTitle'),
      // The loop starts only once both modules have loaded (below), so
      // `planNotifications` is set by the time this is called.
      soon: (at) => planNotifications.planLeadTitle(t, at),
    },
  };
  useEffect(() => {
    if (Capacitor.isNativePlatform()) return undefined;
    let cancelled = false;
    let stop = null;
    Promise.all([import("../lib/webNotify.js"), loadPlanNotifications()]).then(([webNotify]) => {
      if (cancelled || !webNotify.webNotifySupported()) return;
      stop = webNotify.startPlanReminderLoop(() => webNotifyState.current);
    }, (e) => console.warn("[studydesk] web reminders failed to load:", e));
    return () => { cancelled = true; stop?.(); };
  }, []);
}
