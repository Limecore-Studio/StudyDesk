import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';

// limecore#24 — the Realtime channel: what it binds, what the sync panel is
// told, and the recurrence guard (every bound table is published).

const holder = vi.hoisted(() => ({ channels: [], removed: [], sent: [], tokens: [] }));
vi.mock('./supabase.js', () => ({
  supabase: {
    channel(name, opts) {
      const ch = {
        name,
        opts,
        state: 'joining',
        bindings: [],
        broadcastHandlers: [],
        systemHandler: null,
        subscribeCb: null,
        on(type, filter, cb) {
          if (type === 'system') this.systemHandler = cb;
          else if (type === 'broadcast') this.broadcastHandlers.push(cb);
          else this.bindings.push({ ...filter, cb });
          return this;
        },
        subscribe(cb) { this.subscribeCb = cb; return this; },
        send(msg) { holder.sent.push({ topic: name, ...msg }); return Promise.resolve('ok'); },
      };
      holder.channels.push(ch);
      return ch;
    },
    removeChannel(ch) { ch.state = 'closed'; holder.removed.push(ch); },
    auth: { getSession: async () => ({ data: { session: { access_token: 'tok-2' } } }) },
    realtime: { setAuth: async (t) => { holder.tokens.push(t); } },
  },
}));

const sync = await import('./liveSync.js');
const { subscribeRealtimeState, getRealtimeState } = await import('./sync.js');
const liveHints = await import('./liveHints.js');

const migration = (file) => readFileSync(new URL(`../../supabase/migrations/${file}`, import.meta.url), 'utf8');
/** The quoted table names inside the migration's `array[...]` literal. */
const tablesIn = (sql) => new Set([...sql.slice(sql.indexOf('array[')).matchAll(/'([a-z_]+)'/g)].map((m) => m[1]));

beforeEach(() => {
  sync.stopRealtime();
  holder.channels.length = 0;
  holder.removed.length = 0;
  holder.sent.length = 0;
  holder.tokens.length = 0;
});

describe('startRealtime', () => {
  it('binds every table, scoped to the user', () => {
    sync.startRealtime(() => {}, 'u-1');
    const ch = holder.channels[0];
    expect(ch.bindings.map((b) => b.table)).toEqual(sync.REALTIME_TABLES);
    for (const b of ch.bindings) expect(b.filter).toBe('user_id=eq.u-1');
  });

  it('binds without a filter when no user id is given', () => {
    sync.startRealtime(() => {});
    expect(holder.channels[0].bindings.every((b) => !('filter' in b))).toBe(true);
  });

  it('reports connecting, then live, then down when the server rejects the bindings', () => {
    const seen = [];
    const unsub = subscribeRealtimeState(() => seen.push(getRealtimeState()));
    sync.startRealtime(() => {}, 'u-1');
    const ch = holder.channels[0];
    expect(getRealtimeState()).toBe('connecting');
    ch.subscribeCb('SUBSCRIBED');
    expect(getRealtimeState()).toBe('live');
    // The production failure: the join succeeds, then a system error arrives.
    ch.systemHandler({ status: 'error', message: 'Unable to subscribe to changes with given parameters.' });
    expect(getRealtimeState()).toBe('down');
    unsub();
    expect(seen).toEqual(['connecting', 'live', 'down']);
  });

  // v1.20 (StudyDesk#201): this used to stay down for the rest of the
  // session. The dead channel is removed and a new one joins after a backoff.
  it('a dropped channel is down until a new one rejoins', async () => {
    vi.useFakeTimers();
    try {
      sync.startRealtime(() => {}, 'u-1');
      const ch = holder.channels[0];
      ch.subscribeCb('CHANNEL_ERROR', new Error('socket closed'));
      expect(getRealtimeState()).toBe('down');
      expect(holder.removed).toContain(ch);
      // A late callback from the removed channel changes nothing.
      ch.subscribeCb('SUBSCRIBED');
      expect(getRealtimeState()).toBe('down');
      await vi.advanceTimersByTimeAsync(1000);
      const again = holder.channels.at(-1);
      expect(again).not.toBe(ch);
      expect(holder.tokens).toEqual(['tok-2']);
      again.subscribeCb('SUBSCRIBED');
      expect(getRealtimeState()).toBe('live');
    } finally {
      vi.useRealTimers();
    }
  });

  it('stopping is off, and the CLOSED that follows does not flip it to down', () => {
    sync.startRealtime(() => {}, 'u-1');
    const ch = holder.channels[0];
    ch.subscribeCb('SUBSCRIBED');
    sync.stopRealtime();
    ch.subscribeCb('CLOSED');
    expect(getRealtimeState()).toBe('off');
  });
});

// v1.20 (StudyDesk#201, limecore#68) — channel recovery, resync, and the
// private hint channel.
describe('live sync v2', () => {
  const changes = () => holder.channels.filter((c) => c.name === 'studydesk-sync');
  const hints = () => holder.channels.filter((c) => c.name === 'user:u-1');

  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { sync.stopRealtime(); vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('the first join does not resync, a rejoin does', async () => {
    const onChange = vi.fn();
    sync.startRealtime(onChange, 'u-1');
    changes()[0].subscribeCb('SUBSCRIBED');
    expect(onChange).not.toHaveBeenCalled();
    changes()[0].subscribeCb('TIMED_OUT');
    await vi.advanceTimersByTimeAsync(1000);
    changes()[1].subscribeCb('SUBSCRIBED');
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('backs off 1 s, 2 s, 4 s between failed rejoins, capped at 30 s', async () => {
    sync.startRealtime(() => {}, 'u-1');
    const fail = () => changes().at(-1).subscribeCb('CHANNEL_ERROR', new Error('x'));
    fail();
    await vi.advanceTimersByTimeAsync(999);
    expect(changes()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(changes()).toHaveLength(2);
    fail();
    await vi.advanceTimersByTimeAsync(1999);
    expect(changes()).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(changes()).toHaveLength(3);
    for (let i = 0; i < 6; i++) { fail(); await vi.advanceTimersByTimeAsync(30_000); }
    fail();
    await vi.advanceTimersByTimeAsync(29_999);
    expect(changes()).toHaveLength(9);
    await vi.advanceTimersByTimeAsync(1);
    expect(changes()).toHaveLength(10);
  });

  it('the server rejecting the bindings is a drop like any other', async () => {
    sync.startRealtime(() => {}, 'u-1');
    changes()[0].subscribeCb('SUBSCRIBED');
    changes()[0].systemHandler({ status: 'error', message: 'Unable to subscribe' });
    expect(getRealtimeState()).toBe('down');
    await vi.advanceTimersByTimeAsync(1000);
    expect(changes()).toHaveLength(2);
  });

  it('coming back to the foreground rejoins at once instead of waiting out the backoff', async () => {
    const win = new EventTarget();
    const doc = Object.assign(new EventTarget(), { visibilityState: 'hidden' });
    vi.stubGlobal('window', win);
    vi.stubGlobal('document', doc);
    sync.startRealtime(() => {}, 'u-1');
    for (let i = 0; i < 5; i++) {
      changes().at(-1).subscribeCb('CHANNEL_ERROR', new Error('x'));
      await vi.advanceTimersByTimeAsync(30_000);
    }
    changes().at(-1).subscribeCb('CHANNEL_ERROR', new Error('x'));
    const before = changes().length;
    doc.visibilityState = 'visible';
    doc.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    expect(changes()).toHaveLength(before + 1);
    // ...and the stale backoff timer does not add another.
    await vi.advanceTimersByTimeAsync(30_000);
    expect(changes()).toHaveLength(before + 1);
  });

  it('a postgres_changes event pulls only its table, coalesced', async () => {
    const onChange = vi.fn();
    const onTables = vi.fn();
    sync.startRealtime(onChange, 'u-1', { onTables });
    const bind = (t) => changes()[0].bindings.find((b) => b.table === t);
    bind('grades').cb({});
    bind('grades').cb({});
    bind('subjects').cb({});
    await vi.advanceTimersByTimeAsync(1500);
    expect(onTables).toHaveBeenCalledTimes(1);
    expect(onTables.mock.calls[0][0].sort()).toEqual(['grades', 'subjects']);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('joins the private user topic only when it can act on hints', () => {
    sync.startRealtime(() => {}, 'u-1');
    expect(hints()).toHaveLength(0);
    sync.stopRealtime();
    sync.startRealtime(() => {}, 'u-1', { onTables: () => {} });
    expect(hints()).toHaveLength(1);
    expect(hints()[0].opts).toEqual({ config: { private: true, broadcast: { self: false } } });
  });

  it('a hint pulls its table after 300 ms; own echoes and foreign tables are ignored', async () => {
    const onTables = vi.fn();
    sync.startRealtime(() => {}, 'u-1', { onTables });
    const h = hints()[0];
    h.subscribeCb('SUBSCRIBED');
    const deliver = (payload) => h.broadcastHandlers.forEach((cb) => cb({ event: 'changed', payload }));
    deliver({ app: 'ncc', table: 'grades', at: 1, device: 'other' });
    deliver({ app: 'studydesk', table: 'exams', at: 1, device: liveHints.DEVICE_ID });
    deliver({ app: 'ncc', table: 'transactions', at: 1, device: 'other' });
    deliver({ app: 'limelog', table: 'workout_sessions', at: 1 });
    deliver(null);
    await vi.advanceTimersByTimeAsync(299);
    expect(onTables).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(onTables.mock.calls).toEqual([[['grades']]]);
  });

  it('a hint channel refused by Realtime Authorization is not retried', async () => {
    sync.startRealtime(() => {}, 'u-1', { onTables: () => {} });
    hints()[0].subscribeCb('CHANNEL_ERROR', new Error('Unauthorized: You do not have permissions to read from this Channel topic: user:u-1'));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(hints()).toHaveLength(1);
    // The postgres_changes channel is unaffected.
    changes()[0].subscribeCb('SUBSCRIBED');
    expect(getRealtimeState()).toBe('live');
  });

  it('a hint channel that drops for any other reason rejoins', async () => {
    sync.startRealtime(() => {}, 'u-1', { onTables: () => {} });
    hints()[0].subscribeCb('TIMED_OUT');
    await vi.advanceTimersByTimeAsync(1000);
    expect(hints()).toHaveLength(2);
  });

  it('announces one hint per table, and only once the hint channel is joined', () => {
    sync.startRealtime(() => {}, 'u-1', { onTables: () => {} });
    sync.announceChanged(['grades']);
    expect(holder.sent).toEqual([]);
    hints()[0].subscribeCb('SUBSCRIBED');
    sync.announceChanged(['grades', 'subjects', 'grades', 'app_opens']);
    expect(holder.sent.map((m) => [m.topic, m.event, m.payload.table, m.payload.app, m.payload.device])).toEqual([
      ['user:u-1', 'changed', 'grades', 'studydesk', liveHints.DEVICE_ID],
      ['user:u-1', 'changed', 'subjects', 'studydesk', liveHints.DEVICE_ID],
    ]);
    // Names only, never row data.
    expect(Object.keys(holder.sent[0].payload).sort()).toEqual(['app', 'at', 'device', 'table']);
  });

  it('stopping cancels pending pulls and rejoins', async () => {
    const onTables = vi.fn();
    sync.startRealtime(() => {}, 'u-1', { onTables });
    hints()[0].subscribeCb('SUBSCRIBED');
    hints()[0].broadcastHandlers[0]({ payload: { table: 'grades', device: 'other' } });
    changes()[0].subscribeCb('CHANNEL_ERROR', new Error('x'));
    const count = holder.channels.length;
    sync.stopRealtime();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(onTables).not.toHaveBeenCalled();
    expect(holder.channels).toHaveLength(count);
    expect(getRealtimeState()).toBe('off');
  });
});

describe('recurrence guard (limecore#24)', () => {
  // The server rejects the WHOLE channel for one unpublished table, which is
  // how live sync stayed dead from v1.7 to v1.17. Binding a new table means
  // adding it to both migrations below, or writing a new one that does.
  it('every bound table is in the publication migration', () => {
    const published = tablesIn(migration('20261006_realtime_publish.sql'));
    expect(sync.REALTIME_TABLES.filter((t) => !published.has(t))).toEqual([]);
  });

  it('every bound table has the echo guard', () => {
    const guarded = tablesIn(migration('20261006_realtime_echo_guard.sql'));
    expect(sync.REALTIME_TABLES.filter((t) => !guarded.has(t))).toEqual([]);
  });
});
