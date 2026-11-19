// StudyDesk#259 — every running focus timer gets the live status chip, not
// only Lock In.
//
// The chip is FocusMode's ongoing notification (lib/focusMode.js): a countdown
// the system draws, promoted on Android 16, which is what puts it in Samsung's
// Now Bar and the status-bar chip. It used to be posted only by Lock In, from
// TimerView, so a plain focus block (the common case) showed nothing outside
// the app. This hook owns the chip whenever Lock In does not: it reads the
// timer's one source of truth, `sd-timer`, so it works from any screen, and it
// only talks to the plugin when what the chip should say changes. Lock In keeps
// its own chip, pin and full screen (TimerView), untouched.
//
// Native only; the plugin module loads on demand.

import { useEffect, useRef } from "react";
import { Capacitor } from "@capacitor/core";
import { TIMER_CHANGE_EVENT } from "../lib/timerSnapshot.js";

/** What the chip should show for the `sd-timer` record, or null for no chip.
 *  Pure, for the tests. Lock In returns `'lockin'`: TimerView owns it then. */
export function chipFor(rec, now = Date.now()) {
  if (!rec || typeof rec !== "object") return null;
  if (rec.lockedIn) return "lockin";
  if (!rec.running || (rec.phase && rec.phase !== "focus")) return null;
  const stopwatch = rec.mode === "stopwatch";
  let endsAt = 0;
  if (!stopwatch) {
    if (!Number.isFinite(rec.startedAt) || !Number.isFinite(rec.secsAtStart)) return null;
    endsAt = rec.startedAt + rec.secsAtStart * 1000;
    if (endsAt <= now) return null;
  }
  const task = typeof rec.task === "string" ? rec.task.trim() : "";
  return { endsAt, task, stopwatch };
}

function readTimer() {
  try {
    const rec = JSON.parse(localStorage.getItem("sd-timer") || "null");
    return rec && typeof rec === "object" ? rec : null;
  } catch {
    return null;
  }
}

export function useFocusChip(enabled, t) {
  const tRef = useRef(t);
  useEffect(() => { tRef.current = t; }, [t]);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return undefined;
    let lastKey = null;
    let endTimer = null;
    const sync = () => {
      clearTimeout(endTimer);
      const want = enabled === false ? null : chipFor(readTimer());
      if (want === "lockin") { lastKey = "lockin"; return; }
      // A countdown that runs out with no screen open to notice: check again
      // at its end, so the chip does not sit at 0:00.
      if (want?.endsAt) endTimer = setTimeout(sync, Math.max(0, want.endsAt - Date.now()) + 500);
      // Two seconds' slack: a resume re-anchors the start by up to a second.
      const key = want ? `${Math.round(want.endsAt / 2000)}|${want.task}|${want.stopwatch}` : "none";
      if (key === lastKey) return;
      const wasLockIn = lastKey === "lockin";
      lastKey = key;
      void import("../lib/focusMode.js").then((m) => {
        if (!want) {
          // Lock In has already stopped its own chip when it ended.
          if (!wasLockIn) return m.stopFocus();
          return undefined;
        }
        const tr = tRef.current;
        return m.startFocus({
          title: tr(want.stopwatch ? "timer.chipStopwatchTitle" : "timer.chipFocusTitle"),
          text: want.task || tr("timer.focusChipRunning"),
          endsAt: want.endsAt,
          chip: true,
          pin: false,
          immersive: false,
        });
      }).catch(() => {});
    };
    sync();
    window.addEventListener(TIMER_CHANGE_EVENT, sync);
    return () => {
      clearTimeout(endTimer);
      window.removeEventListener(TIMER_CHANGE_EVENT, sync);
    };
  }, [enabled]);
}
