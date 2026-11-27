// Home-screen widgets: data pushes and widget-tap navigation.
// Moved out of App.jsx unchanged and called from the same place (limecore#12).
import { useState, useEffect } from "react";
import { formatLocale } from "../lib/dates.js";
import { WIDGET_PALETTE_EVENT } from "../lib/theme.js";

// v1.22 (limecore#126): the bridge loads on demand. Both effects below already
// ran after first paint, and the calls they make were already async. One cached
// import promise keeps them in the order the effects ran.
let bridgeLoad = null;
function loadBridge() {
  bridgeLoad ??= import("../lib/widgetBridge.js").catch((e) => { bridgeLoad = null; throw e; });
  return bridgeLoad;
}
const warnLoad = (e) => console.warn("[studydesk] widget bridge failed to load:", e);

export function useWidgets({ state, t, dispatch }) {
  // v1.9 (Item 8) — keep the home-screen widgets in step with the same data,
  // on the same triggers as the notifications above. Both answer "what's next"
  // from outside the app, so they should never be able to disagree.
  //
  // Not gated on notifEnabled: a widget the user chose to place on their home
  // screen is not a notification, and declining reminders is not declining it.
  // The push itself no-ops off Android and when no widget is placed.
  //
  // v1.15 — and on a palette change: the widgets follow the app's look (or
  // the Settings override), so switching to Dark has to reach the home screen
  // without waiting for the next assignment edit.
  const [widgetPaletteTick, setWidgetPaletteTick] = useState(0);
  useEffect(() => {
    const bump = () => setWidgetPaletteTick((n) => n + 1);
    // StudyDesk#316: and every time the app comes back to the foreground. The
    // push is skipped while no widget is placed, so a widget placed after the
    // last data change had nothing to draw ("Nothing due") until the next edit.
    // Opening the app now fills it, and also catches a new day's labels.
    const onVisible = () => { if (document.visibilityState === "visible") bump(); };
    window.addEventListener(WIDGET_PALETTE_EVENT, bump);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener(WIDGET_PALETTE_EVENT, bump);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  useEffect(() => {
    const snapshot = {
      assignments: state.assignments,
      exams: state.exams,
      courses: state.courses,
      t,
      locale: formatLocale(),
    };
    loadBridge().then((m) => { void m.pushWidgetSnapshot(snapshot); }, warnLoad);
  }, [state.assignments, state.exams, state.courses, t, widgetPaletteTick]);

  // v1.10 — widget taps land where the widget was about.
  //
  // Shipped 1.7.0 gave both widgets the same bare "open MainActivity" intent,
  // so a tap dropped the user on whatever screen they last left the app on —
  // reported as "doesnt take me to the right place both just open the app".
  // Next Up now opens the Next Up view, Upcoming opens the plan view.
  //
  // Two paths because Android delivers the two cases differently: a cold start
  // is queued natively and collected here on mount, a tap while the app is
  // already running arrives as an event. See WidgetBridgePlugin.
  useEffect(() => {
    let cancelled = false;

    // Await the handle before removing it — the same StrictMode ordering trap
    // that double-registered the notification listener in v1.7.
    const handlePromise = loadBridge().then((m) => {
      void m.consumeWidgetLaunchView().then((view) => {
        if (!cancelled && view) dispatch({ type: "SET_VIEW", view });
      });
      return m.onWidgetNavigate((view) => {
        dispatch({ type: "SET_VIEW", view });
      });
    }, warnLoad);

    return () => {
      cancelled = true;
      void handlePromise.then((h) => h?.remove()).catch(() => {});
    };
  }, [dispatch]);
}
