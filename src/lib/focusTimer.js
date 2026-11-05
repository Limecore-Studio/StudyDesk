// v1.20 Block B (StudyDesk#202) — Focus Sync: the shared timer's shape.
//
// TimerView keeps its whole state in one localStorage record, `sd-timer`
// (lib/timerSnapshot.js explains why). Focus Sync shares that record between
// the user's devices rather than re-architecting the timer: this module turns
// it into the state stored in `focus_timers.state` and back, and decides when
// a local change is worth sending. lib/focusSync.js does the sending.
//
// Two clocks. `sd-timer` holds this device's epoch ms; the shared state holds
// the server's (`serverNow()`), so a phone two minutes fast and a laptop two
// minutes slow agree on when a block ends. `offset` is serverNow() - Date.now().
//
// What is shared: the run itself — mode, phase, running, the timing, the cycle
// position, the task, course and planned block, and which device started the
// current block (`origin`). What stays on each device: Lock In (fullscreen on a
// laptop and screen pinning on a phone are per-device decisions) and the
// day's focus count.
//
// No imports, so it is testable on its own and safe in any chunk.

export const FOCUS_TIMERS_TABLE = 'focus_timers';

/** Fired on `window` after a remote state has been written to `sd-timer`, so a
 *  mounted TimerView reloads from it. TIMER_CHANGE_EVENT fires as well. */
export const FOCUS_REMOTE_EVENT = 'studydesk:focus-remote';

const PHASES = ['focus', 'short', 'long'];
const DEVICE_KEY = 'sd-device-id';

let deviceId = null;
/** A stable id for this browser profile or app install. Unlike the per-page
 *  hint id (liveHints.js), it survives a reload: a block started here must
 *  still count as started here after the phone restarts the app. */
export function focusDeviceId() {
  if (deviceId) return deviceId;
  try {
    deviceId = localStorage.getItem(DEVICE_KEY);
    if (!deviceId) {
      deviceId = crypto.randomUUID();
      localStorage.setItem(DEVICE_KEY, deviceId);
    }
  } catch {
    deviceId = deviceId || `d-${Math.random().toString(36).slice(2)}`;
  }
  return deviceId;
}

const int = (v, lo, hi, dflt) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : dflt;
};
const ms = (v) => (Number.isFinite(Number(v)) && v !== null ? Number(v) : null);
const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
const id = (v) => (typeof v === 'string' && v ? v.slice(0, 64) : null);

/**
 * The `sd-timer` record (this device's clock) as shared state (server clock).
 * @param {object} rec  The parsed `sd-timer` record.
 * @param {{ offset: number, by: string }} ctx
 */
export function toShared(rec, { offset, by }) {
  const running = Boolean(rec?.running) && ms(rec?.startedAt) !== null && ms(rec?.secsAtStart) !== null;
  const phaseStartedAt = ms(rec?.phaseStartedAt);
  return {
    v: 1,
    runId: id(rec?.runId),
    origin: id(rec?.origin),
    by: id(by),
    mode: rec?.mode === 'stopwatch' ? 'stopwatch' : 'pomodoro',
    phase: PHASES.includes(rec?.phase) ? rec.phase : 'focus',
    running,
    customFocus: int(rec?.customFocus, 5, 240, 25),
    session: int(rec?.session, 0, 3, 0),
    task: str(rec?.task, 200),
    courseId: id(rec?.courseId),
    planId: id(rec?.planId),
    startedAt: running ? ms(rec.startedAt) + offset : null,
    secsAtStart: running ? int(rec.secsAtStart, 0, 86_400, 0) : null,
    secsLeft: running ? null : int(rec?.secsLeft, 0, 86_400, 0),
    phaseStartedAt: phaseStartedAt === null ? null : phaseStartedAt + offset,
  };
}

/**
 * Shared state as the fields to write into `sd-timer` on this device. The
 * caller keeps the device's own fields (Lock In, the day's focus count).
 * A running block keeps its anchor, so TimerView's restore computes the time
 * left itself — including a block that ended while this device was away.
 */
export function toLocal(shared, { offset }) {
  const running = Boolean(shared?.running) && ms(shared?.startedAt) !== null && ms(shared?.secsAtStart) !== null;
  const phaseStartedAt = ms(shared?.phaseStartedAt);
  const customFocus = int(shared?.customFocus, 5, 240, 25);
  return {
    mode: shared?.mode === 'stopwatch' ? 'stopwatch' : 'pomodoro',
    phase: PHASES.includes(shared?.phase) ? shared.phase : 'focus',
    running,
    customFocus,
    session: int(shared?.session, 0, 3, 0),
    task: str(shared?.task, 200),
    courseId: id(shared?.courseId),
    planId: id(shared?.planId),
    runId: id(shared?.runId),
    origin: id(shared?.origin),
    startedAt: running ? ms(shared.startedAt) - offset : null,
    secsAtStart: running ? int(shared.secsAtStart, 0, 86_400, 0) : null,
    secsLeft: running ? int(shared.secsAtStart, 0, 86_400, 0) : int(shared?.secsLeft, 0, 86_400, customFocus * 60),
    phaseStartedAt: phaseStartedAt === null ? null : phaseStartedAt - offset,
  };
}

/**
 * What a record means, for deciding whether a change is worth sending.
 *
 * TimerView persists every second while running (the display), and re-anchors
 * `startedAt`/`secsAtStart` on every resume. Neither is a change another
 * device needs. So a running record is described by the instant its count
 * reaches zero (countdown) or started from zero (stopwatch): that is the same
 * across ticks and re-anchors, give or take the second a re-anchor rounds to.
 */
export function transitionKey(rec) {
  const running = Boolean(rec?.running) && ms(rec?.startedAt) !== null && ms(rec?.secsAtStart) !== null;
  const mode = rec?.mode === 'stopwatch' ? 'stopwatch' : 'pomodoro';
  const anchor = !running ? null
    : mode === 'stopwatch' ? ms(rec.startedAt) - Number(rec.secsAtStart) * 1000
      : ms(rec.startedAt) + Number(rec.secsAtStart) * 1000;
  const key = JSON.stringify([
    mode,
    PHASES.includes(rec?.phase) ? rec.phase : 'focus',
    running,
    int(rec?.customFocus, 5, 240, 25),
    int(rec?.session, 0, 3, 0),
    str(rec?.task, 200),
    id(rec?.courseId),
    id(rec?.planId),
    id(rec?.runId),
    running ? null : int(rec?.secsLeft, 0, 86_400, 0),
  ]);
  return { key, anchor };
}

/** True when two keys describe the same state. Anchors within 2 s are equal:
 *  a re-anchor floors to the second. */
export function sameTransition(a, b) {
  if (!a || !b || a.key !== b.key) return false;
  if (a.anchor === null || b.anchor === null) return a.anchor === b.anchor;
  return Math.abs(a.anchor - b.anchor) < 2000;
}

/** True when this device should raise the save sheet for a block that ran
 *  out: it started the block, or nobody recorded who did (a block from before
 *  Focus Sync, or a guest). The device that STOPS a block always saves it —
 *  that is a person acting there — so this gates only natural completion. */
export function savesCompletion(rec, device) {
  return !rec?.origin || rec.origin === device;
}

// ── reading shared state directly (v1.20, #189) ─────────────────────────────
//
// The desktop glance widget mirrors the shared timer from the row itself, with
// no TimerView behind it. TimerView's own arithmetic is the reference.

/** Seconds on the clock at server time `now`: left on a countdown, counted up
 *  on a stopwatch. */
export function remainingSecs(shared, now) {
  if (!shared?.running || ms(shared.startedAt) === null || ms(shared.secsAtStart) === null) {
    return int(shared?.secsLeft, 0, 86_400, 0);
  }
  const elapsed = Math.max(0, Math.floor((now - shared.startedAt) / 1000));
  return shared.mode === 'stopwatch'
    ? shared.secsAtStart + elapsed
    : Math.max(0, shared.secsAtStart - elapsed);
}

/** True when there is a block on the clock worth showing: running, or paused
 *  part-way. A reset timer at full time is not. */
export function isActive(shared) {
  if (!shared) return false;
  if (shared.running) return true;
  const full = shared.phase === 'short' ? 300 : shared.phase === 'long' ? 900 : int(shared.customFocus, 5, 240, 25) * 60;
  return shared.mode === 'stopwatch' ? int(shared.secsLeft, 0, 86_400, 0) > 0 : int(shared.secsLeft, 0, 86_400, full) < full;
}
