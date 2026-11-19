import { describe, it, expect, beforeEach } from 'vitest';
import { findUnsynced, reconcileUnsynced } from './reconcile.js';

const NOW = Date.parse('2026-11-19T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const ago = (days) => new Date(NOW - days * DAY).toISOString();

const empty = () => ({ subjects: [], grades: [], sessions: [], assignments: [], exams: [], notes: [] });
const byKind = (items, kind) => items.filter((i) => i.kind === kind);

describe('reconcile payloads keep the row (StudyDesk#234, #237)', () => {
  it('a note keeps its layout and its own edit stamp', () => {
    const layout = { boxes: [{ id: 'b1', x: 10, y: 20 }], hash: 'abc' };
    const state = { notes: [{ id: 'n1', courseId: null, title: 'Cells', lessonDate: '2026-11-18', content: 'mitosis', layout, updatedAt: ago(1) }] };
    const [item] = findUnsynced(state, empty());
    expect(item.kind).toBe('upsert_note');
    expect(item.payload.layout).toEqual(layout);
    expect(item.payload.updatedAt).toBe(ago(1));
  });

  it('an archived course is rescued archived, with its own archive stamp', () => {
    const state = { courses: { c1: { id: 'c1', name: 'History', credits: 1, archivedAt: ago(30), archivedEditedAt: ago(30), updatedAt: ago(60) } } };
    const [item] = findUnsynced(state, empty());
    expect(item.payload).toMatchObject({ archivedAt: ago(30), archivedEditedAt: ago(30), updatedAt: ago(60) });
  });

  it('an active course sends archivedAt null and no archive stamp', () => {
    const state = { courses: { c1: { id: 'c1', name: 'History', archivedAt: null, updatedAt: ago(1) } } };
    const [item] = findUnsynced(state, empty());
    expect(item.payload.archivedAt).toBeNull();
    expect(item.payload.archivedEditedAt).toBeUndefined();
  });

  it('every payload carries the row\'s own updatedAt', () => {
    const at = ago(2);
    const state = {
      courses: { c1: { id: 'c1', name: 'Maths', updatedAt: at } },
      exams: [{ id: 'e1', courseId: 'c1', title: 'Final', updatedAt: at }],
      assignments: [{ id: 'a1', courseId: 'c1', title: 'Essay', updatedAt: at }],
      grades: [{ id: 'g1', subjectId: 'c1', grade: 7, updatedAt: at }],
      studySessions: [{ id: 's1', subjectId: 'c1', durationMinutes: 25, updatedAt: at }],
      academicTerms: [{ id: 't1', level: 'year', name: '2026', updatedAt: at }],
      timetableEntries: [{ id: 'te1', termId: 't1', subjectId: 'c1', updatedAt: at }],
      plannedSessions: [{ id: 'p1', subjectId: 'c1', seriesId: 'ser1', updatedAt: at }],
      commitments: [{ id: 'cm1', title: 'Football', updatedAt: at }],
      notes: [{ id: 'n1', courseId: 'c1', content: '', updatedAt: at }],
      attendance: [{ id: 'at1', timetableEntryId: 'te1', date: '2026-11-18', status: 'present', updatedAt: at }],
    };
    const items = findUnsynced(state, empty());
    expect(items).toHaveLength(11);
    for (const it of items) expect(it.payload.updatedAt, it.kind).toBe(at);
  });

  it('skips a row that already has a queued or in-flight outbox item', () => {
    const state = { notes: [{ id: 'n1', content: 'x', updatedAt: ago(1) }, { id: 'n2', content: 'y', updatedAt: ago(1) }] };
    const items = findUnsynced(state, empty(), { queuedIds: new Set(['n1']) });
    expect(items.map((i) => i.payload.id)).toEqual(['n2']);
  });
});

describe('purged tombstones are not re-uploaded (StudyDesk#243)', () => {
  const state = () => ({
    courses: {
      old: { id: 'old', name: 'Deleted long ago', updatedAt: ago(200) },
      fresh: { id: 'fresh', name: 'Made offline', updatedAt: ago(3) },
    },
    grades: [
      { id: 'g-old', subjectId: 'fresh', grade: 5, updatedAt: ago(120) },
      { id: 'g-new', subjectId: 'fresh', grade: 6, updatedAt: ago(1) },
    ],
    studySessions: [
      { id: 's-old', subjectId: null, durationMinutes: 30, updatedAt: ago(95) },
      { id: 's-new', subjectId: null, durationMinutes: 30, updatedAt: ago(10) },
      { id: 's-nostamp', subjectId: null, durationMinutes: 30 },
    ],
    // Not purged server-side: always rescued.
    assignments: [{ id: 'a-old', courseId: 'fresh', title: 'x', updatedAt: ago(300) }],
  });

  it('on a device that synced this account before, skips purge-old rows and keeps recent ones', () => {
    const items = findUnsynced(state(), empty(), { syncedBefore: true, now: NOW });
    expect(byKind(items, 'upsert_subject').map((i) => i.payload.id)).toEqual(['fresh']);
    expect(byKind(items, 'upsert_grade').map((i) => i.payload.id)).toEqual(['g-new']);
    expect(byKind(items, 'log_session').map((i) => i.payload.id)).toEqual(['s-new']);
    expect(byKind(items, 'upsert_assignment').map((i) => i.payload.id)).toEqual(['a-old']);
  });

  it('children of a skipped course are held back with it', () => {
    const s = { courses: { old: { id: 'old', name: 'x', updatedAt: ago(200) } }, grades: [{ id: 'g', subjectId: 'old', grade: 5, updatedAt: ago(1) }] };
    expect(findUnsynced(s, empty(), { syncedBefore: true, now: NOW })).toEqual([]);
  });

  it('with no earlier sync here (guest sign-in, fresh install) rescues everything', () => {
    const items = findUnsynced(state(), empty(), { syncedBefore: false, now: NOW });
    expect(byKind(items, 'upsert_subject')).toHaveLength(2);
    expect(byKind(items, 'upsert_grade')).toHaveLength(2);
    expect(byKind(items, 'log_session')).toHaveLength(3);
  });
});

describe('reconcileUnsynced remembers a full pull per account', () => {
  let store;
  beforeEach(() => {
    store = new Map();
    globalThis.localStorage = {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    };
  });
  const fakeOutbox = (over = {}) => {
    const queued = [];
    return { queued, enqueueMany: (items) => { queued.push(...items); return true; }, queuedItems: () => [], getStatus: () => ({ lastSuccessAt: null }), ...over };
  };
  const oldGrade = { courses: { c: { id: 'c', name: 'x', updatedAt: new Date().toISOString() } }, grades: [{ id: 'g', subjectId: 'c', grade: 5, updatedAt: '2025-01-01T00:00:00.000Z' }] };
  const remote = { ...empty(), subjects: [{ id: 'c' }] };

  it('the first full pull rescues an old row; the next one, for the same account, does not', () => {
    const ob = fakeOutbox();
    expect(reconcileUnsynced(oldGrade, remote, ob, { userId: 'u1' })).toBe(1);
    expect(reconcileUnsynced(oldGrade, remote, ob, { userId: 'u1' })).toBe(0);
    // Another account on this device has no earlier sync of its own.
    expect(reconcileUnsynced(oldGrade, remote, ob, { userId: 'u2' })).toBe(1);
  });

  it('a device that has pushed before (updated from an older build) counts as synced', () => {
    const ob = fakeOutbox({ getStatus: () => ({ lastSuccessAt: '2026-11-01T00:00:00.000Z' }) });
    expect(reconcileUnsynced(oldGrade, remote, ob, { userId: 'u1' })).toBe(0);
  });

  it('skips rows the outbox already holds', () => {
    const ob = fakeOutbox({ queuedItems: () => [{ kind: 'upsert_grade', payload: { id: 'g' } }] });
    expect(reconcileUnsynced(oldGrade, remote, ob, { userId: 'u1' })).toBe(0);
  });
});
