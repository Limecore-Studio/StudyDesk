import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// StudyDesk#267 — a one-tap delete is undoable for UNDO_MS; its server delete
// is queued only after that, and never lost.

const H = vi.hoisted(() => ({ queued: [] }));
vi.mock('./outbox.js', () => ({ enqueue: (kind, payload) => H.queued.push({ kind, payload }) }));

const store = new Map();
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
const docListeners = {};
globalThis.document = { visibilityState: 'visible', addEventListener: (ev, fn) => { docListeners[ev] = fn; } };

const HD = await import('./heldDelete.js');
const { UNDO_MS } = await import('./doneList.js');
const { withoutQueuedDeletes } = await import('./pushDiff.js');
const { applyRemotePull } = await import('./merge.js');
const { reducer, INITIAL } = await import('./appReducer.js');

const asg = { id: 'a1', courseId: 'c1', title: 'Essay', dueDate: '2026-11-25', done: false, updatedAt: '2026-11-01T00:00:00.000Z' };
const hold = () => HD.holdDelete({ title: 'Deleted: Essay', ops: [['delete_assignment', { id: 'a1' }]], restore: { type: 'RESTORE_DELETED', list: 'assignments', row: asg } });

beforeEach(() => {
  vi.useFakeTimers();
  HD.__resetHeldDeleteForTest();
  H.queued.length = 0;
  store.clear();
  HD.setHeldDeleteUser('u1');
});
afterEach(() => vi.useRealTimers());

describe('held delete', () => {
  it('Undo leaves no outbox item, ever, and restores the row exactly', () => {
    hold();
    expect(HD.isDeleteHeld('a1')).toBe(true);
    const restore = HD.undoHeldDelete();
    vi.advanceTimersByTime(UNDO_MS * 3);
    expect(H.queued).toEqual([]);
    expect(store.has('sd-held-delete')).toBe(false);
    const state = reducer({ ...INITIAL, assignments: [] }, restore);
    expect(state.assignments).toEqual([asg]);
  });

  it('the delete is queued once the window closes, exactly once', () => {
    hold();
    vi.advanceTimersByTime(UNDO_MS - 1);
    expect(H.queued).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(H.queued).toEqual([{ kind: 'delete_assignment', payload: { id: 'a1' } }]);
    expect(HD.undoHeldDelete()).toBeNull();
    vi.advanceTimersByTime(UNDO_MS);
    expect(H.queued).toHaveLength(1);
  });

  it('going to the background queues it at once', () => {
    hold();
    document.visibilityState = 'hidden';
    docListeners.visibilitychange();
    document.visibilityState = 'visible';
    expect(H.queued).toHaveLength(1);
  });

  it('a second delete queues the first straight away', () => {
    hold();
    HD.holdDelete({ title: 'x', ops: [['delete_grade', { id: 'g1' }]], restore: null });
    expect(H.queued.map((q) => q.kind)).toEqual(['delete_assignment']);
  });

  it('a run that died inside the window: the next sign-in queues it, for that account only', () => {
    hold();
    // The process dies: no timer, no hide handler; the stored record remains.
    const stored = store.get('sd-held-delete');
    HD.__resetHeldDeleteForTest();
    store.set('sd-held-delete', stored);
    const other = [];
    HD.replayHeldDelete('u2', (k, p) => other.push([k, p]));
    expect(other).toEqual([]);
    store.set('sd-held-delete', stored);
    const mine = [];
    HD.replayHeldDelete('u1', (k, p) => mine.push([k, p]));
    expect(mine).toEqual([['delete_assignment', { id: 'a1' }]]);
  });

  it('a guest delete queues nothing; an account switch drops the old account\'s delete', () => {
    HD.setHeldDeleteUser(null);
    hold();
    vi.advanceTimersByTime(UNDO_MS);
    HD.setHeldDeleteUser('u1');
    hold();
    HD.setHeldDeleteUser('u2');
    vi.advanceTimersByTime(UNDO_MS);
    expect(H.queued).toEqual([]);
  });

  it('a pull inside the window does not bring the deleted row back', () => {
    hold();
    const pulled = withoutQueuedDeletes({ assignments: [{ id: 'a1', subject_id: 'c1', title: 'Essay', updated_at: '2026-11-01T00:00:00+00:00', deleted_at: null }] }, HD.heldDeleteItems());
    const merged = applyRemotePull({ ...INITIAL, assignments: [] }, pulled);
    expect(merged.assignments).toEqual([]);
  });
});

describe('RESTORE_DELETED', () => {
  it('replaces a local tombstone with the original row (grades, sessions)', () => {
    const g = { id: 'g1', subjectId: 'c1', grade: 6, weight: 1, updatedAt: '2026-11-01T00:00:00.000Z', deletedAt: null };
    const deleted = reducer({ ...INITIAL, grades: [g] }, { type: 'DELETE_GRADE', id: 'g1' });
    expect(deleted.grades[0].deletedAt).toBeTruthy();
    const back = reducer(deleted, { type: 'RESTORE_DELETED', list: 'grades', row: g });
    expect(back.grades).toEqual([g]);
  });
  it('ignores an unknown list', () => {
    const s = { ...INITIAL };
    expect(reducer(s, { type: 'RESTORE_DELETED', list: 'courses', row: { id: 'x' } })).toBe(s);
  });
});
