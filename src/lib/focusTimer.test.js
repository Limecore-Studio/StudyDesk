import { describe, it, expect } from 'vitest';
import { toShared, toLocal, transitionKey, sameTransition, savesCompletion, remainingSecs, isActive } from './focusTimer.js';

// v1.20 (#202) — Focus Sync's shape: the `sd-timer` record to shared state
// and back, and which local changes are worth sending.

const T0 = 1_800_000_000_000;
const running = (over = {}) => ({
  mode: 'pomodoro', phase: 'focus', running: true, customFocus: 25, session: 1,
  task: 'Ch. 7', courseId: 'c-1', planId: null, runId: 'r-1', origin: 'phone',
  startedAt: T0, secsAtStart: 1500, secsLeft: 1500, phaseStartedAt: T0,
  lockedIn: true, focusDone: 3, ...over,
});

describe('toShared / toLocal', () => {
  it('a running block round-trips, with only the device fields left behind', () => {
    const shared = toShared(running(), { offset: 0, by: 'phone' });
    expect(shared).toMatchObject({ v: 1, runId: 'r-1', origin: 'phone', by: 'phone', running: true, startedAt: T0, secsAtStart: 1500, secsLeft: null });
    expect(shared).not.toHaveProperty('lockedIn');
    expect(shared).not.toHaveProperty('focusDone');
    const local = toLocal(shared, { offset: 0 });
    expect(local).toMatchObject({ running: true, startedAt: T0, secsAtStart: 1500, task: 'Ch. 7', courseId: 'c-1', runId: 'r-1' });
  });

  it('two devices whose clocks are 2 minutes apart agree on when the block ends', () => {
    // The phone runs 2 min fast: its Date.now() is 2 min ahead of the server.
    const phoneOffset = -120_000;
    // The laptop runs 2 min slow.
    const laptopOffset = 120_000;
    const phoneStart = T0 + 120_000; // the phone's reading of server time T0
    const shared = toShared(running({ startedAt: phoneStart, phaseStartedAt: phoneStart }), { offset: phoneOffset, by: 'phone' });
    expect(shared.startedAt).toBe(T0);
    const onLaptop = toLocal(shared, { offset: laptopOffset });
    // The laptop's clock read T0 - 2 min at that same instant.
    expect(onLaptop.startedAt).toBe(T0 - 120_000);
    // Both compute the same time left at the same real instant (server T0 + 10 min).
    const left = (rec, localNow) => rec.secsAtStart - Math.floor((localNow - rec.startedAt) / 1000);
    expect(left(running({ startedAt: phoneStart }), T0 + 600_000 + 120_000)).toBe(900);
    expect(left(onLaptop, T0 + 600_000 - 120_000)).toBe(900);
  });

  it('a paused block carries its seconds left and no anchor', () => {
    const shared = toShared(running({ running: false, startedAt: null, secsAtStart: null, secsLeft: 700 }), { offset: 5, by: 'laptop' });
    expect(shared).toMatchObject({ running: false, startedAt: null, secsAtStart: null, secsLeft: 700 });
    expect(toLocal(shared, { offset: 5 })).toMatchObject({ running: false, secsLeft: 700, startedAt: null });
  });

  it('bad input is clamped rather than trusted', () => {
    const shared = toShared({ mode: 'x', phase: 'nap', customFocus: 9999, session: 42, task: 'x'.repeat(500), running: true }, { offset: 0, by: 'd' });
    expect(shared).toMatchObject({ mode: 'pomodoro', phase: 'focus', customFocus: 240, session: 3, running: false });
    expect(shared.task).toHaveLength(200);
    expect(toLocal({ phase: 'nap', secsLeft: -5 }, { offset: 0 })).toMatchObject({ phase: 'focus', secsLeft: 0, running: false });
  });
});

describe('transitionKey', () => {
  it('ignores the per-second display and a resume re-anchor', () => {
    const a = transitionKey(running());
    // Ten seconds later, re-anchored the way TimerView does on resume.
    const b = transitionKey(running({ startedAt: T0 + 10_000, secsAtStart: 1490, secsLeft: 1490 }));
    expect(sameTransition(a, b)).toBe(true);
    // ...and the floor to the second a re-anchor may lose.
    const c = transitionKey(running({ startedAt: T0 + 10_900, secsAtStart: 1490 }));
    expect(sameTransition(a, c)).toBe(true);
  });

  it('notices a pause, a new run, a task edit, a phase change', () => {
    const a = transitionKey(running());
    expect(sameTransition(a, transitionKey(running({ running: false, secsLeft: 1200 })))).toBe(false);
    expect(sameTransition(a, transitionKey(running({ runId: 'r-2' })))).toBe(false);
    expect(sameTransition(a, transitionKey(running({ task: 'Ch. 8' })))).toBe(false);
    expect(sameTransition(a, transitionKey(running({ phase: 'short' })))).toBe(false);
    expect(sameTransition(a, transitionKey(running({ startedAt: T0 + 60_000 })))).toBe(false);
  });

  it('ignores the fields that stay on the device', () => {
    expect(sameTransition(transitionKey(running()), transitionKey(running({ lockedIn: false, focusDone: 9 })))).toBe(true);
  });
});

describe('savesCompletion', () => {
  it('only the device that started a block saves it when it runs out', () => {
    expect(savesCompletion({ origin: 'phone' }, 'phone')).toBe(true);
    expect(savesCompletion({ origin: 'phone' }, 'laptop')).toBe(false);
    // A block from before Focus Sync, or a guest's: as before, it saves.
    expect(savesCompletion({ origin: null }, 'laptop')).toBe(true);
  });
});

describe('reading shared state (#189)', () => {
  const S0 = 1_800_000_000_000;
  const shared = (over = {}) => ({ v: 1, mode: 'pomodoro', phase: 'focus', running: true, customFocus: 25,
    startedAt: S0, secsAtStart: 1500, secsLeft: null, runId: 'r', origin: 'phone', by: 'phone', ...over });

  it('time left on a countdown, counted up on a stopwatch, held when paused', () => {
    expect(remainingSecs(shared(), S0 + 90_500)).toBe(1410);
    expect(remainingSecs(shared(), S0 + 9_999_000)).toBe(0);
    expect(remainingSecs(shared({ mode: 'stopwatch', secsAtStart: 30 }), S0 + 10_000)).toBe(40);
    expect(remainingSecs(shared({ running: false, startedAt: null, secsLeft: 700 }), S0 + 99_000)).toBe(700);
  });

  it('only a running or part-way block is active', () => {
    expect(isActive(shared())).toBe(true);
    expect(isActive(shared({ running: false, startedAt: null, secsLeft: 1200 }))).toBe(true);
    expect(isActive(shared({ running: false, startedAt: null, secsLeft: 1500 }))).toBe(false);
    expect(isActive(shared({ running: false, phase: 'short', secsLeft: 300 }))).toBe(false);
    expect(isActive(null)).toBe(false);
  });
});
