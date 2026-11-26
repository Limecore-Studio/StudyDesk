import { describe, it, expect } from 'vitest';
import { idForUid, idForEvent, legacyIdsForEvent, rekeyPlan } from './feedImport.js';
import { reducer, INITIAL } from './appReducer.js';

// limecore#96 — calendar-feed ids scoped to the account and the feed.
const FEED = 'https://lms.example.edu/feeds/calendars/user_abc.ics';
const UID = 'event-assignment-4242';
const A = { userId: 'user-a', feedUrl: FEED };
const B = { userId: 'user-b', feedUrl: FEED };

describe('idForEvent', () => {
  it('two accounts never share an id; one account always gets the same one', async () => {
    expect(await idForEvent(UID, A)).not.toBe(await idForEvent(UID, B));
    expect(await idForEvent(UID, A)).toBe(await idForEvent(UID, { ...A }));
    expect(await idForEvent(UID, A)).not.toBe(await idForEvent(UID, { ...A, feedUrl: `${FEED}?x` }));
    expect(await idForEvent(UID, A)).not.toBe(await idForUid(UID));
    expect(await idForEvent(UID, A)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('older ids: v1 always, and the guest-scoped one for an account', async () => {
    expect(await legacyIdsForEvent(UID, { userId: null, feedUrl: FEED })).toEqual([await idForUid(UID)]);
    expect(await legacyIdsForEvent(UID, A)).toEqual([await idForUid(UID), await idForEvent(UID, { feedUrl: FEED })]);
  });
});

describe('rekeyPlan', () => {
  const item = { uid: UID, dueDate: '2026-12-01' };

  it('moves a v1 row, and a guest-scoped row after sign-in, to the account id', async () => {
    const v1 = await idForUid(UID);
    const guest = await idForEvent(UID, { feedUrl: FEED });
    const to = await idForEvent(UID, A);
    expect(await rekeyPlan([item], A, [{ id: v1 }])).toEqual([{ from: v1, to }]);
    expect(await rekeyPlan([item], A, [{ id: guest }])).toEqual([{ from: guest, to }]);
  });

  it('nothing to move when the scoped row exists, or the item is new', async () => {
    expect(await rekeyPlan([item], A, [{ id: await idForEvent(UID, A) }, { id: await idForUid(UID) }])).toEqual([]);
    expect(await rekeyPlan([item], A, [])).toEqual([]);
  });

  it('a row with attachments keeps its old id (no orphaned files)', async () => {
    const v1 = await idForUid(UID);
    expect(await rekeyPlan([item], A, [{ id: v1 }], [{ id: 'f1', assignmentId: v1 }])).toEqual([]);
    expect(await rekeyPlan([item], A, [{ id: v1 }], [{ id: 'f1', assignmentId: v1, deletedAt: '2026-01-01' }])).toHaveLength(1);
  });
});

describe('REKEY_ASSIGNMENT', () => {
  const row = { id: 'old', courseId: 'c', title: 'Essay (my edit)', done: true, updatedAt: '2026-01-01T00:00:00.000Z' };
  it('keeps the row and its edits, changes only the id, and stamps it', () => {
    const next = reducer({ ...INITIAL, assignments: [row] }, { type: 'REKEY_ASSIGNMENT', from: 'old', to: 'new' });
    expect(next.assignments).toHaveLength(1);
    expect(next.assignments[0]).toMatchObject({ id: 'new', title: 'Essay (my edit)', done: true });
    expect(next.assignments[0].updatedAt).not.toBe(row.updatedAt);
  });
  it('never makes a duplicate', () => {
    const s = { ...INITIAL, assignments: [row, { ...row, id: 'new' }] };
    expect(reducer(s, { type: 'REKEY_ASSIGNMENT', from: 'old', to: 'new' })).toBe(s);
  });
});
