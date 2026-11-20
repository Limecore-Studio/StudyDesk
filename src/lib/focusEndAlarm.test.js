import { describe, it, expect, vi, beforeEach } from 'vitest';

// StudyDesk#241 — the pomodoro's end alarm while the app is hidden.

const H = vi.hoisted(() => ({ calls: [] }));
vi.mock('@capacitor/local-notifications', () => ({
  LocalNotifications: {
    schedule: async (o) => { H.calls.push(['schedule', o.notifications[0]]); },
    cancel: async (o) => { H.calls.push(['cancel', o.notifications[0].id]); },
  },
}));
vi.mock('../i18n/index.js', () => ({ default: { t: (k) => k } }));

const store = new Map();
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
const timer = (rec) => store.set('sd-timer', JSON.stringify(rec));

const { focusEndAt, syncFocusEndAlarm, FOCUS_END_ID } = await import('./focusEndAlarm.js');

const NOW = Date.now();

describe('focusEndAt', () => {
  it('is the end of a running countdown', () => {
    expect(focusEndAt({ running: true, mode: 'pomodoro', startedAt: NOW, secsAtStart: 1500 }, NOW)).toBe(NOW + 1_500_000);
  });
  it('is null for a paused timer, a stopwatch, or a countdown already over', () => {
    expect(focusEndAt({ running: false, startedAt: NOW, secsAtStart: 1500 }, NOW)).toBeNull();
    expect(focusEndAt({ running: true, mode: 'stopwatch', startedAt: NOW, secsAtStart: 0 }, NOW)).toBeNull();
    expect(focusEndAt({ running: true, startedAt: NOW - 2_000_000, secsAtStart: 1500 }, NOW)).toBeNull();
    expect(focusEndAt({ running: true, startedAt: null, secsAtStart: 1500 }, NOW)).toBeNull();
  });
});

describe('syncFocusEndAlarm', () => {
  beforeEach(() => { H.calls.length = 0; });

  it('schedules on hide, keeps it while nothing changes, moves it on a change, cancels on show', async () => {
    timer({ running: true, mode: 'pomodoro', phase: 'focus', startedAt: NOW, secsAtStart: 1500 });
    await syncFocusEndAlarm(true);
    expect(H.calls).toHaveLength(1);
    const [kind, n] = H.calls[0];
    expect(kind).toBe('schedule');
    expect(n).toMatchObject({ id: FOCUS_END_ID, title: 'notif.focusEndTitle', extra: { focusEnd: true } });
    expect(n.schedule.at.getTime()).toBe(NOW + 1_500_000);
    expect(n.schedule.allowWhileIdle).toBe(true);

    await syncFocusEndAlarm(true);
    expect(H.calls).toHaveLength(1);

    // Skipped to a break from another device while hidden.
    timer({ running: true, mode: 'pomodoro', phase: 'short', startedAt: NOW, secsAtStart: 300 });
    await syncFocusEndAlarm(true);
    expect(H.calls.slice(1).map((c) => c[0])).toEqual(['cancel', 'schedule']);
    expect(H.calls[2][1].title).toBe('notif.breakEndTitle');

    await syncFocusEndAlarm(false);
    expect(H.calls.at(-1)).toEqual(['cancel', FOCUS_END_ID]);
  });

  it('a pause while hidden cancels it', async () => {
    timer({ running: true, mode: 'pomodoro', phase: 'focus', startedAt: NOW, secsAtStart: 600 });
    await syncFocusEndAlarm(true);
    timer({ running: false, mode: 'pomodoro', phase: 'focus', startedAt: null, secsAtStart: 600 });
    await syncFocusEndAlarm(true);
    expect(H.calls.map((c) => c[0])).toEqual(['schedule', 'cancel']);
  });
});
