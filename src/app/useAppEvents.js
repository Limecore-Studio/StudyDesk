// App-wide event wiring: outbox drain/pull triggers and reminder action taps.
// Moved out of App.jsx unchanged and called from the same place (limecore#12).
import { useEffect } from "react";
import { LocalNotifications } from "@capacitor/local-notifications";
import * as outbox from "../lib/outbox.js";
import { ACTION_DONE_ID } from "../lib/notificationActions.js";
import { Capacitor } from "@capacitor/core";
import { TIMER_CHANGE_EVENT } from "../lib/timerSnapshot.js";

export function useOutboxTriggers(requestPullRef) {
  // v1.3 — outbox drain triggers. The outbox holds pending Supabase writes
  // when the device is offline or a sync call failed; this effect re-runs
  // drain on three signals:
  //
  //   1. App cold-start (mount) — catches anything queued in a prior
  //      session that hadn't drained yet.
  //   2. `online` window event — fires when the OS detects network
  //      restoration. Capacitor surfaces this in the Android WebView.
  //   3. `visibilitychange` → visible — fires when the app comes back to
  //      the foreground after being backgrounded. Capacitor maps Android's
  //      onResume here. Useful when the device was online but the user
  //      was away long enough for a retry to make sense.
  //
  // drain() is single-flight inside the outbox (coalesces overlapping
  // calls) so firing it from all three paths is safe.
  //
  // StudyDesk#72 — the same signals now also pull, after the drain, so local
  // edits reach the server before the server's view is merged back. Window
  // `focus` joins them for the desktop edition, where switching between
  // windows never changes `visibilityState`. The pull is throttled inside
  // `requestPullRef` (syncStamps.js), so an alt-tab habit costs nothing.
  useEffect(() => {
    // One-shot on mount.
    void outbox.drain();
    const drainThenPull = () => {
      void Promise.resolve(outbox.drain())
        .catch(() => { /* drain reports its own failures */ })
        .then(() => requestPullRef.current?.());
    };
    function onOnline() { drainThenPull(); }
    function onVisibility() {
      if (document.visibilityState === 'visible') drainThenPull();
    }
    window.addEventListener('online', onOnline);
    window.addEventListener('focus', drainThenPull);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('focus', drainThenPull);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [requestPullRef]);
}

export function useReminderActions(dispatch, onOpenPlan) {
  // Listen for "Mark done" action-button taps on assignment reminders.
  // The handler dispatches SET_ASSIGNMENT_DONE — since reschedules filter
  // out assignments where done===true, the next scheduling pass naturally
  // drops any further reminders for the just-completed assignment. One-way
  // (StudyDesk#239): a reminder delivered before the assignment was ticked
  // elsewhere stays in the tray, and a toggle from it reopened the
  // assignment on every device.
  useEffect(() => {
    // Hold the listener PROMISE and remove via it. With the old
    // `let handle=null; (async)=>{handle=await add()}` pattern, React 19
    // StrictMode's mount→cleanup→mount runs cleanup before the await resolves
    // (handle still null → .remove() skipped), orphaning the first listener and
    // double-registering — so "Mark done" fired TOGGLE_ASSIGNMENT twice (net
    // no-op). The backButton listener below already uses this safe idiom.
    const handlePromise = LocalNotifications.addListener(
          "localNotificationActionPerformed",
          (event) => {
            // v1.3.1 BUG-14 — body-tap navigation. @capacitor/local-notifications
            // fires this same event for both the "Mark done" action button AND
            // a tap on the notification body itself (actionId === 'tap'). The
            // existing handler only acted on 'done'; body taps fell through and
            // the app opened on whatever screen it was last on instead of the
            // relevant assignments view. Route body taps to the plan view so
            // the user lands on the full assignment list — same target as the
            // ActionsView ("Next Up") would imply but "plan" surfaces all
            // upcoming work, which matches the tap intent better.
            if (event.actionId === "tap") {
              // v1.19 (#185) — a scheduled block's reminder opens that
              // block's start sheet instead, on top of whatever screen the
              // app was on. With the app killed this fires once the listener
              // is registered at launch, which is the same path.
              // StudyDesk#241 — the timer's end alarm opens the timer.
              if (event.notification?.extra?.focusEnd) { dispatch({ type: "SET_VIEW", view: "timer" }); return; }
              const planId = event.notification?.extra?.planId;
              if (planId && onOpenPlan) { onOpenPlan(planId); return; }
              dispatch({ type: "SET_VIEW", view: "plan" });
              return;
            }
            if (event.actionId !== ACTION_DONE_ID) return;
            const assignmentId = event.notification?.extra?.assignmentId;
            if (!assignmentId) return;
            dispatch({ type: "SET_ASSIGNMENT_DONE", id: assignmentId });
          },
        );
    handlePromise.catch((e) => console.warn("[StudyDesk] action listener failed:", e));
    return () => { handlePromise.then((h) => h.remove()).catch(() => {}); };
  }, [dispatch, onOpenPlan]);
}

// StudyDesk#241 — while the app is hidden, a running countdown gets a local
// notification at its end (lib/focusEndAlarm.js, loaded on demand). Native
// only: the web and the desktop app keep running their tick in the background.
export function useFocusEndAlarm() {
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const sync = () => {
      const hidden = document.visibilityState === "hidden";
      void import("../lib/focusEndAlarm.js").then((m) => m.syncFocusEndAlarm(hidden)).catch(() => {});
    };
    document.addEventListener("visibilitychange", sync);
    window.addEventListener(TIMER_CHANGE_EVENT, sync);
    return () => {
      document.removeEventListener("visibilitychange", sync);
      window.removeEventListener(TIMER_CHANGE_EVENT, sync);
    };
  }, []);
}

// limecore#127 — router deep links (com.studydesk.app://open/...), from a
// launcher shortcut or another suite app. A cold start's link comes from
// getLaunchUrl, a warm one from appUrlOpen. Native only; the login callback on
// the same scheme is AuthGate's, and parseRoute ignores it.
export function useDeepLinks(onRoute) {
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return undefined;
    let gone = false;
    let sub = null;
    void import("../lib/deepLink.js").then(async ({ parseRoute }) => {
      if (gone) return;
      const { App: CapApp } = await import("@capacitor/app");
      const take = (url) => { const r = parseRoute(url); if (r && !gone) onRoute(r); };
      sub = await CapApp.addListener("appUrlOpen", (e) => take(e?.url));
      if (gone) { sub.remove(); return; }
      try { take((await CapApp.getLaunchUrl())?.url); } catch { /* none */ }
    }).catch(() => {});
    return () => { gone = true; sub?.remove(); };
  // onRoute is stable in intent; re-subscribing on every render would replay
  // the launch URL.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
