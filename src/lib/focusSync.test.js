import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// v1.20 (#202) — the Focus Sync engine against a stand-in `focus_timers` that
// enforces what the migration's trigger does: an update must name the version
// it read and bump it by one. "The other device" writes the row directly.

const db = vi.hoisted(() => ({ row: null, writes: [], offset: 0, failNext: null }));
vi.mock('./supabase.js', () => {
  const table = {
    select() {
      return {
        eq: () => ({ maybeSingle: async () => ({ data: db.row ? { version: db.row.version, state: db.row.state } : null, error: null }) }),
      };
    },
    insert(row) {
      return {
        select: () => ({
          maybeSingle: async () => {
            if (db.row) return { data: null, error: { code: '23505', message: 'duplicate key' } };
            db.row = { version: row.version, state: row.state };
            db.writes.push({ op: 'insert', version: row.version, state: row.state });
            return { data: { version: row.version }, error: null };
          },
        }),
      };
    },
    update(patch) {
      let expected = null;
      const q = {
        eq(col, v) { if (col === 'version') expected = v; return q; },
        select: () => ({
          maybeSingle: async () => {
            if (!db.row || db.row.version !== expected) return { data: null, error: null };
            db.row = { version: patch.version, state: patch.state };
            db.writes.push({ op: 'update', version: patch.version, state: patch.state });
            return { data: { version: patch.version }, error: null };
          },
        }),
      };
      return q;
    },
  };
  return { supabase: { from: () => table } };
});
vi.mock('./serverClock.js', () => ({ serverNow: () => Date.now() + db.offset }));
vi.mock('./deviceOwner.js', () => ({ isPageStale: () => false }));

function storage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    clear: () => m.clear(),
  };
}

vi.stubGlobal('localStorage', storage());
vi.stubGlobal('window', new EventTarget());
vi.stubGlobal('document', Object.assign(new EventTarget(), { visibilityState: 'visible' }));
const sync = await import('./focusSync.js');
const { focusDeviceId, FOCUS_REMOTE_EVENT } = await import('./focusTimer.js');
const { TIMER_CHANGE_EVENT } = await import('./timerSnapshot.js');

const ME = focusDeviceId();
const timer = (over = {}) => ({
  mode: 'pomodoro', phase: 'focus', running: true, customFocus: 25, session: 0, task: '',
  courseId: null, planId: null, runId: 'r-1', origin: ME, startedAt: Date.now(), secsAtStart: 1500,
  secsLeft: 1500, phaseStartedAt: Date.now(), lockedIn: true, focusDone: 2, ...over,
});
const writeLocal = (rec) => {
  localStorage.setItem('sd-timer', JSON.stringify(rec));
  window.dispatchEvent(new CustomEvent(TIMER_CHANGE_EVENT));
};
const readLocal = () => JSON.parse(localStorage.getItem('sd-timer'));
const other = (version, over = {}) => {
  db.row = {
    version,
    state: { v: 1, by: 'laptop', origin: 'laptop', runId: 'r-L', mode: 'pomodoro', phase: 'focus', running: true,
      customFocus: 45, session: 0, task: 'Essay', courseId: null, planId: null, startedAt: Date.now() + db.offset,
      secsAtStart: 2700, secsLeft: null, phaseStartedAt: Date.now() + db.offset, ...over },
  };
};
async function settle() {
  await vi.advanceTimersByTimeAsync(700);
  await sync.__settled();
  await sync.__settled();
}

let announced;
let remoteEvents;
const onRemote = () => remoteEvents++;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  vi.setSystemTime(new Date('2026-10-29T12:00:00Z'));
  sync.stopFocusSync();
  localStorage.clear();
  localStorage.setItem('sd-device-id', ME);
  db.row = null;
  db.writes = [];
  db.offset = 0;
  announced = [];
  remoteEvents = 0;
  window.addEventListener(FOCUS_REMOTE_EVENT, onRemote);
});
afterEach(() => {
  sync.stopFocusSync();
  window.removeEventListener(FOCUS_REMOTE_EVENT, onRemote);
  vi.useRealTimers();
});

const start = async () => {
  sync.startFocusSync({ userId: 'u-1', announce: (t) => announced.push(t) });
  await sync.__settled();
};

describe('sending', () => {
  it('a start is written as version 1 and hinted', async () => {
    await start();
    writeLocal(timer());
    await settle();
    expect(db.writes.map((w) => [w.op, w.version])).toEqual([['insert', 1]]);
    expect(db.row.state).toMatchObject({ running: true, runId: 'r-1', by: ME, origin: ME });
    expect(db.row.state).not.toHaveProperty('lockedIn');
    expect(announced).toEqual([['focus_timers']]);
  });

  it('a pause is the next version; ticking and re-anchoring send nothing', async () => {
    await start();
    writeLocal(timer());
    await settle();
    vi.advanceTimersByTime(10_000);
    writeLocal(timer({ startedAt: Date.now(), secsAtStart: 1490, secsLeft: 1490 }));
    await settle();
    expect(db.writes).toHaveLength(1);
    writeLocal(timer({ running: false, startedAt: null, secsAtStart: null, secsLeft: 1480 }));
    await settle();
    expect(db.writes.map((w) => [w.op, w.version])).toEqual([['insert', 1], ['update', 2]]);
    expect(db.row.state).toMatchObject({ running: false, secsLeft: 1480 });
  });

  it('typing in the task line is one write, not one per key', async () => {
    await start();
    writeLocal(timer());
    await settle();
    for (const task of ['C', 'Ch', 'Ch.', 'Ch. 7']) {
      writeLocal(timer({ task }));
      await vi.advanceTimersByTimeAsync(100);
    }
    await settle();
    expect(db.writes).toHaveLength(2);
    expect(db.row.state.task).toBe('Ch. 7');
  });
});

describe('two devices', () => {
  it('pressing Start together: the one that wrote first wins, the other shows its run', async () => {
    await start();
    writeLocal(timer());
    await settle();
    // The laptop moved the row on before this device's next write.
    other(2);
    writeLocal(timer({ running: false, startedAt: null, secsAtStart: null, secsLeft: 1400 }));
    await settle();
    expect(db.row.version).toBe(2);
    expect(db.row.state.by).toBe('laptop');
    expect(readLocal()).toMatchObject({ runId: 'r-L', task: 'Essay', customFocus: 45, running: true, origin: 'laptop' });
    expect(remoteEvents).toBe(1);
  });

  it('a change from the other device is applied, keeping Lock In and the count here', async () => {
    await start();
    writeLocal(timer());
    await settle();
    other(2, { running: false, startedAt: null, secsAtStart: null, secsLeft: 900 });
    await sync.refreshFocusSync();
    expect(readLocal()).toMatchObject({ running: false, secsLeft: 900, lockedIn: true, focusDone: 2, origin: 'laptop' });
    expect(remoteEvents).toBe(1);
    // Applying it is not a local change to send back.
    await settle();
    expect(db.writes).toHaveLength(1);
  });

  it('this device\'s own write coming back is adopted, not re-applied', async () => {
    await start();
    writeLocal(timer());
    await settle();
    db.row.version = 1;
    await sync.refreshFocusSync();
    expect(remoteEvents).toBe(0);
  });

  it('a device that opens later picks up the running block', async () => {
    other(5);
    await start();
    expect(readLocal()).toMatchObject({ runId: 'r-L', running: true, secsAtStart: 2700 });
    expect(remoteEvents).toBe(1);
  });

  it('a pause made offline is sent when the server has not moved on', async () => {
    await start();
    writeLocal(timer());
    await settle();
    sync.stopFocusSync();
    // Closed or offline: TimerView persists, nobody sends.
    localStorage.setItem('sd-timer', JSON.stringify(timer({ running: false, startedAt: null, secsAtStart: null, secsLeft: 1000 })));
    await start();
    await settle();
    expect(db.row.version).toBe(2);
    expect(db.row.state).toMatchObject({ running: false, secsLeft: 1000 });
  });

  it('...and dropped for the server\'s state when it has', async () => {
    await start();
    writeLocal(timer());
    await settle();
    sync.stopFocusSync();
    localStorage.setItem('sd-timer', JSON.stringify(timer({ running: false, startedAt: null, secsAtStart: null, secsLeft: 1000 })));
    other(2);
    await start();
    await settle();
    expect(db.row.state.by).toBe('laptop');
    expect(readLocal()).toMatchObject({ runId: 'r-L', running: true });
  });

  it('times survive a 2-minute skew between the devices', async () => {
    // This device runs 2 minutes slow: server time is 2 minutes ahead of it.
    db.offset = 120_000;
    other(1);
    await start();
    // The laptop started at server "now", which is this device's now.
    expect(readLocal().startedAt).toBe(Date.now());
  });
});
