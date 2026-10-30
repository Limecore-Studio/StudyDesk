import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// v1.16 (limecore#27, registry P6) — the limecore#27 scenario end to end,
// through the REAL outbox and the REAL sync.js push functions. Only the
// Supabase client is a stand-in, and it records exactly what would be sent.
//
// The bug, restated: an edit made offline at 10:00 and pushed at 12:00 used to
// reach the server stamped 12:00 — the moment it was SENT — so it overwrote
// an 11:00 edit from another device, and the server had no way to know.

const sent = vi.hoisted(() => ({ rows: [], fail: null }));
vi.mock('./supabase.js', () => {
  const builder = (table) => ({
    upsert(row) {
      sent.rows.push({ table, op: 'upsert', row });
      const error = sent.fail ? sent.fail(row) : null;
      return Promise.resolve({ error });
    },
  });
  return {
    supabase: {
      from: builder,
      auth: { getUser: async () => ({ data: { user: { id: 'user-1' } } }) },
    },
  };
});

const outbox = await import('./outbox.js');
const { recordPull, resetEditStamps } = await import('./editStamp.js');

const at = (iso) => vi.setSystemTime(new Date(iso));
const online = (on) => vi.stubGlobal('navigator', { onLine: on });

function storage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    clear: () => m.clear(),
    key: (i) => [...m.keys()][i] ?? null,
    get length() { return m.size; },
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.stubGlobal('localStorage', storage());
  online(true);
  sent.rows = [];
  sent.fail = null;
  resetEditStamps();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const assignment = (over = {}) => ({ id: 'a1', courseId: 'c1', title: 'Essay', done: false, ...over });

// `enqueue` fires its own `void drain()` while online, and a second drain
// returns at once through the single-flight guard — so a test that awaits
// drain() right after an online enqueue would read the result before anything
// was sent. Queue offline, then drain explicitly.
async function queueThenDrain(kind, payload) {
  online(false);
  outbox.enqueue(kind, payload);
  online(true);
  await outbox.drain();
}
const sentStamps = () => sent.rows.map((r) => r.row.updated_at);

describe('the limecore#27 scenario', () => {
  it('an edit made offline at 10:00 and pushed at 12:00 is sent stamped 10:00', async () => {
    online(false);
    at('2026-09-25T10:00:00.000Z');
    outbox.enqueue('upsert_assignment', assignment({ title: 'edited offline' }));

    at('2026-09-25T12:00:00.000Z');
    online(true);
    await outbox.drain();

    expect(sent.rows).toHaveLength(1);
    expect(sent.rows[0].table).toBe('assignments');
    // 10:00, not 12:00 — so the server's guard can see it is older than the
    // 11:00 edit another device made, and decline it.
    expect(sentStamps()).toEqual(['2026-09-25T10:00:00.000Z']);
  });

  it('an edit that coalesces onto a queued one carries the NEWER edit\'s time', async () => {
    // Stamping once per queued item would send 10:00 for the 11:00 content —
    // and lose it to anything another device wrote in between.
    online(false);
    at('2026-09-25T10:00:00.000Z');
    outbox.enqueue('upsert_assignment', assignment({ title: 'first' }));
    at('2026-09-25T11:00:00.000Z');
    outbox.enqueue('upsert_assignment', assignment({ title: 'second' }));

    at('2026-09-25T12:00:00.000Z');
    online(true);
    await outbox.drain();

    expect(sent.rows).toHaveLength(1);
    expect(sent.rows[0].row.title).toBe('second');
    expect(sentStamps()).toEqual(['2026-09-25T11:00:00.000Z']);
  });

  it('a slow-clock device editing a row it just pulled still stamps it newer', async () => {
    // Pulled: another device wrote at 12:00:05. This clock says 12:00:00.
    recordPull({ assignments: [{ id: 'a1', updated_at: '2026-09-25T12:00:05+00:00' }] });
    at('2026-09-25T12:00:00.000Z');
    await queueThenDrain('upsert_assignment', assignment({ title: 'after seeing it' }));
    expect(sentStamps()).toEqual(['2026-09-25T12:00:05.001Z']);
  });

  it('a row re-queued at launch is sent with its own edit time, not launch time', async () => {
    at('2026-09-25T12:00:00.000Z');
    await queueThenDrain('upsert_assignment', assignment({ updatedAt: '2026-09-25T09:30:00.000Z' }));
    expect(sentStamps()).toEqual(['2026-09-25T09:30:00.000Z']);
  });
});

describe('compatibility', () => {
  it('an item queued by an older build, with no stamp, still pushes — stamped now, as before', async () => {
    // P1: the queue survives the update, and those items carry no updatedAt.
    localStorage.setItem('studydesk-outbox', JSON.stringify([
      { id: 'old-1', createdAt: '2026-09-20T08:00:00.000Z', kind: 'upsert_assignment', payload: assignment(), attempts: 0 },
    ]));
    at('2026-09-25T12:00:00.000Z');
    await outbox.drain();
    expect(sentStamps()).toEqual(['2026-09-25T12:00:00.000Z']);
  });

  it('a kind with no updated_at is queued exactly as given', () => {
    outbox.enqueue('record_app_open', { app: 'studydesk', openedOn: '2026-09-25' });
    const [item] = JSON.parse(localStorage.getItem('studydesk-outbox'));
    expect(item.payload).toEqual({ app: 'studydesk', openedOn: '2026-09-25' });
  });

  it('re-enqueueing the SAME work does not reset a failing item\'s retry budget', async () => {
    // The stamp is new on every enqueue; it must not count as "changed work",
    // or a poison item would be revived forever and never quarantine.
    sent.fail = () => ({ code: '23503', message: 'fk violation' });
    at('2026-09-25T10:00:00.000Z');
    await queueThenDrain('upsert_assignment', assignment());
    const before = JSON.parse(localStorage.getItem('studydesk-outbox'))[0].attempts;
    expect(before).toBeGreaterThan(0);

    at('2026-09-25T10:05:00.000Z');
    online(false); // hold it in the queue so we can read it back
    outbox.enqueue('upsert_assignment', assignment());
    const [item] = JSON.parse(localStorage.getItem('studydesk-outbox'));
    expect(item.attempts).toBe(before);
  });

  it('...while genuinely new work on a failing row does reset it', async () => {
    sent.fail = () => ({ code: '23503', message: 'fk violation' });
    at('2026-09-25T10:00:00.000Z');
    await queueThenDrain('upsert_assignment', assignment());

    online(false);
    at('2026-09-25T10:05:00.000Z');
    outbox.enqueue('upsert_assignment', assignment({ title: 'actually different' }));
    const [item] = JSON.parse(localStorage.getItem('studydesk-outbox'));
    expect(item.attempts).toBe(0);
  });
});

// v1.20 (StudyDesk#201) — live sync hints the other devices with the tables a
// drain pushed. Only successful pushes count: a hint for a failed push would
// make every other device pull for nothing.
describe('onPushed', () => {
  it('reports the tables of the items that were pushed', async () => {
    const seen = [];
    const off = outbox.onPushed((tables) => seen.push(tables));
    await queueThenDrain('upsert_assignment', assignment());
    off();
    expect(seen).toEqual([['assignments']]);
  });

  it('reports nothing for a push that failed', async () => {
    const seen = [];
    const off = outbox.onPushed((tables) => seen.push(tables));
    sent.fail = () => ({ message: 'network', code: '' });
    await queueThenDrain('upsert_assignment', assignment());
    off();
    expect(seen).toEqual([]);
  });
});

// v1.20 (StudyDesk#156) — counter writes drain through handlers that load
// counterSync.js on demand, carrying the edit's own time.
describe('progress counters', () => {
  it('a counter and its day push to their tables, the counter first', async () => {
    online(false);
    at('2026-10-30T09:00:00.000Z');
    outbox.enqueue('upsert_counter_day', { id: 'd1', counterId: 'c1', day: '2026-10-30', value: 3 });
    outbox.enqueue('upsert_counter', { id: 'c1', name: 'Physics', unit: 'pages', period: 'total' });
    online(true);
    at('2026-10-30T12:00:00.000Z');
    await outbox.drain();
    expect(sent.rows.map((r) => r.table)).toEqual(['progress_counters', 'progress_counter_days']);
    expect(sent.rows.map((r) => r.row.updated_at)).toEqual(['2026-10-30T09:00:00.000Z', '2026-10-30T09:00:00.000Z']);
  });
});
