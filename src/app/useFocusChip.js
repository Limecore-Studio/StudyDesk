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
  if (rec.phase && rec.phase !== "focus") return null;
  const stopwatch = rec.mode === "stopwatch";
  const task = typeof rec.task === "string" ? rec.task.trim() : "";
  if (!rec.running) {
    // StudyDesk#289: a block paused part-way keeps its chip, with no
    // countdown and a Resume button. Idle at a full block shows nothing.
    const left = rec.secsLeft;
    const midBlock = stopwatch ? left > 0 : Number.isFinite(left) && left > 0 && left < (rec.customFocus || 25) * 60;
    return midBlock ? { endsAt: 0, task, stopwatch, paused: true } : null;
  }
  let endsAt = 0;
  if (!stopwatch) {
    if (!Number.isFinite(rec.startedAt) || !Number.isFinite(rec.secsAtStart)) return null;
    endsAt = rec.startedAt + rec.secsAtStart * 1000;
    if (endsAt <= now) return null;
  }
  return { endsAt, task, stopwatch, paused: false };
}

/** StudyDesk#289 — the chip's buttons for a chip state, ids as focusActions.js
 *  applies them. A stopwatch has no end to move, so no +5 min. */
export function chipActions(want, t) {
  if (!want || want === "lockin") return [];
  const out = [want.paused
    ? { id: "resume", title: t("timer.chipResume") }
    : { id: "pause", title: t("av.tm.pause") }];
  if (!want.stopwatch) out.push({ id: "plus5", title: t("timer.chipPlus5") });
  out.push({ id: "end", title: t("timer.chipEnd") });
  return out;
}

/** StudyDesk#289 — apply chip button taps (a killed app's included) to the
 *  timer. End hands its session to `onSession` (App's onTimerComplete). */
export function useFocusActions(onSession, onStart) {
  const ref = useRef(onSession);
  const startRef = useRef(onStart);
  useEffect(() => { ref.current = onSession; startRef.current = onStart; });
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return undefined;
    let off = () => {};
    let gone = false;
    void import("../lib/focusMode.js").then((m) => {
      if (gone) return;
      off = m.onFocusAction((action) => {
        // limecore#127: the Quick Settings tile on an idle timer starts a new
        // focus block, the same way the Timer screen's Start does.
        if (action === "start") { startRef.current?.(); return; }
        void import("../lib/focusActions.js").then((f) => f.runFocusAction(action, (s) => ref.current?.(s)));
      });
    }).catch(() => {});
    return () => { gone = true; off(); };
  }, []);
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
      const key = want ? `${Math.round(want.endsAt / 2000)}|${want.task}|${want.stopwatch}|${want.paused}` : "none";
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
          text: want.paused ? tr("timer.focusChipPaused") : want.task || tr("timer.focusChipRunning"),
          endsAt: want.endsAt,
          chip: true,
          pin: false,
          immersive: false,
          actions: chipActions(want, tr),
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

/** limecore#127 — what the focus Quick Settings tile shows for the `sd-timer`
 *  record: running (with the end of a countdown, 0 for a stopwatch), paused
 *  part-way, or idle (a tap starts a focus block). Pure, for the tests. */
export function tileFor(rec, now = Date.now()) {
  if (!rec || typeof rec !== "object") return { state: "idle", endsAt: 0 };
  const stopwatch = rec.mode === "stopwatch";
  if (rec.running) {
    if (stopwatch) return { state: "running", endsAt: 0 };
    if (Number.isFinite(rec.startedAt) && Number.isFinite(rec.secsAtStart)) {
      const endsAt = rec.startedAt + rec.secsAtStart * 1000;
      if (endsAt > now) return { state: "running", endsAt };
    }
    return { state: "idle", endsAt: 0 };
  }
  const left = rec.secsLeft;
  const full = rec.phase && rec.phase !== "focus" ? Infinity : (rec.customFocus || 25) * 60;
  const midBlock = stopwatch ? left > 0 : Number.isFinite(left) && left > 0 && left < full;
  return midBlock ? { state: "paused", endsAt: 0 } : { state: "idle", endsAt: 0 };
}

/** limecore#127 — keep the Quick Settings tile in step with the timer.
 *  Independent of the chip setting: the tile is something the user added. */
export function useFocusTile(t) {
  const tRef = useRef(t);
  useEffect(() => { tRef.current = t; }, [t]);
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return undefined;
    let lastKey = null;
    const sync = () => {
      const tile = tileFor(readTimer());
      const tr = tRef.current;
      const key = `${tile.state}|${Math.round(tile.endsAt / 2000)}`;
      if (key === lastKey) return;
      lastKey = key;
      void import("../lib/focusMode.js").then((m) => m.setTile({
        ...tile,
        leftText: tr("timer.tileLeft", { n: "{n}" }),
        runningText: tr("timer.tileRunning"),
        pausedText: tr("timer.focusChipPaused"),
        idleText: tr("timer.tileStart"),
      })).catch(() => {});
    };
    sync();
    window.addEventListener(TIMER_CHANGE_EVENT, sync);
    return () => window.removeEventListener(TIMER_CHANGE_EVENT, sync);
  }, []);
}
