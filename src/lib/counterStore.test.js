import { describe, it, expect, vi, beforeEach } from 'vitest';

// limecore#104 and StudyDesk#236: the counters in memory follow the account
// the local data belongs to, and counters the server lacks are uploaded after
// a pull.

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
globalThis.window = { addEventListener() {}, removeEventListener() {} };

const H = vi.hoisted(() => ({ session: true, pulled: { counters: [], days: [] }, queue: [] }));

vi.mock('./supabase.js', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: H.session ? { user: { id: 'u' } } : null } }) } },
}));
vi.mock('./counterSync.js', () => ({ pullCounters: async () => H.pulled }));
vi.mock('./outbox.js', () => ({
  enqueue: (kind, payload) => H.queue.push({ kind, payload }),
  enqueueMany: (items) => { H.queue.push(...items); return true; },
  queuedItems: () => H.queue,
}));

const { markLocalDataReplaced } = await import('./deviceOwner.js');
const counterStore = await import('./counterStore.js');

beforeEach(() => {
  H.session = true;
  H.pulled = { counters: [], days: [] };
  H.queue.length = 0;
});

describe('counters follow the account (limecore#104)', () => {
  it('a wipe empties the counters in memory, and a later bump writes nothing back', async () => {
    const id = await counterStore.saveCounter({ name: 'Pages', unit: 'pages', period: 'total' });
    expect(counterStore.getCounters().counters.map((c) => c.id)).toEqual([id]);

    // Sign-out or another account: accountWipe removes the key and moves the epoch.
    store.delete('sd-counters');
    markLocalDataReplaced();

    expect(counterStore.getCounters().counters).toEqual([]);
    H.queue.length = 0;
    await counterStore.bump(id, '2026-11-19', 1);
    expect(store.get('sd-counters')).toBeUndefined();
    expect(H.queue).toEqual([]);
  });

  it('a pull that started before the wipe is dropped', async () => {
    H.pulled = { counters: [{ id: 'a-counter', name: 'A', unit: 'x', period: 'total', position: 0, updatedAt: '2026-11-01T00:00:00Z', deletedAt: null }], days: [] };
    const pull = counterStore.refreshCounters();
    store.delete('sd-counters');
    markLocalDataReplaced();
    await pull;
    expect(counterStore.getCounters().counters).toEqual([]);
  });
});

describe('counters the server lacks are uploaded (StudyDesk#236)', () => {
  it('a guest\'s counter and its days are queued after the first signed-in pull', async () => {
    store.delete('sd-counters');
    markLocalDataReplaced();
    H.session = false; // a guest: nothing is queued
    const id = await counterStore.saveCounter({ name: 'Problems', unit: 'problems', period: 'day' });
    await counterStore.bump(id, '2026-11-19', 3);
    expect(H.queue).toEqual([]);

    H.session = true; // signed in, no wipe (guest data is adopted)
    await counterStore.refreshCounters();
    expect(H.queue.map((i) => `${i.kind}:${i.payload.counterId || i.payload.id}`)).toEqual([
      `upsert_counter:${id}`,
      `upsert_counter_day:${id}`,
    ]);
  });
});
