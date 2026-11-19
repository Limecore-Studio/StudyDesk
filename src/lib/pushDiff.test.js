import { describe, it, expect } from 'vitest';
import { snapshotPushState, diffPushes, withoutQueuedDeletes } from './pushDiff.js';
import { applyRemotePull } from './merge.js';
import { stampsFromPull } from './syncStamps.js';

// StudyDesk#232. The pusher's baseline used to be the first render after the
// launch pull settled, so anything done while that pull was in flight (or
// before a failed one) became part of the baseline and was never queued.

const T0 = '2026-11-19T08:00:00.000Z';
const T1 = '2026-11-19T08:00:05.000Z';

const asg = (over = {}) => ({ id: 'a1', courseId: 'c1', title: 'Essay', type: null, dueDate: '2026-11-20', dueTime: '', notes: '', done: false, updatedAt: T0, ...over });
const todo = (over = {}) => ({ id: 't1', text: 'Read ch. 3', bucket: 'today', courseId: null, done: false, suggested: false, updatedAt: T0, ...over });
const state = (over = {}) => ({ courses: {}, grades: [], studySessions: [], assignments: [], exams: [], actions: [], ...over });
const remoteAsg = (over = {}) => ({ id: 'a1', subject_id: 'c1', title: 'Essay', type: null, due_date: '2026-11-20', notes: null, done: false, updated_at: '2026-11-19T08:00:00+00:00', deleted_at: null, ...over });
const remoteTodo = (over = {}) => ({ id: 't1', subject_id: null, text: 'Read ch. 3', bucket: 'today', done: false, updated_at: '2026-11-19T08:00:00+00:00', deleted_at: null, ...over });
const pull = (over = {}) => ({ subjects: [], grades: [], sessions: [], assignments: [], exams: [], actions: [], ...over });

describe('pre-pull edits (StudyDesk#232)', () => {
  it('queues an edit made before the first pull settles, and nothing for the pull itself', () => {
    const launch = state({ assignments: [asg()] });
    const baseline = snapshotPushState(launch);

    // The student ticks the assignment while the pull is in flight.
    const edited = state({ assignments: [asg({ done: true, updatedAt: T1 })] });
    const afterEdit = snapshotPushState(edited);
    const queued = diffPushes(baseline, afterEdit, edited, null);
    expect(queued).toEqual([{ kind: 'upsert_assignment', payload: expect.objectContaining({ id: 'a1', done: true, updatedAt: T1 }) }]);

    // The pull lands with the older server copy: the newer local edit stays,
    // and the merge queues nothing new.
    const remote = pull({ assignments: [remoteAsg()] });
    const merged = applyRemotePull(edited, remote);
    expect(merged.assignments[0].done).toBe(true);
    expect(diffPushes(afterEdit, snapshotPushState(merged), merged, stampsFromPull(remote))).toEqual([]);
  });

  it('queues a to-do created before the first pull settles', () => {
    const baseline = snapshotPushState(state());
    const created = state({ actions: [todo()] });
    expect(diffPushes(baseline, snapshotPushState(created), created, null)).toEqual([
      { kind: 'upsert_action', payload: expect.objectContaining({ id: 't1', text: 'Read ch. 3' }) },
    ]);
  });

  it('a delete made before the pull is queued and the pull does not bring the row back', () => {
    const launch = state({ actions: [todo()] });
    const baseline = snapshotPushState(launch);
    const deleted = state({ actions: [] });
    const queued = diffPushes(baseline, snapshotPushState(deleted), deleted, null);
    expect(queued).toEqual([{ kind: 'delete_action', payload: { id: 't1' } }]);

    // The server still holds the live row; the queued delete keeps it out.
    const remote = withoutQueuedDeletes(pull({ actions: [remoteTodo()] }), queued);
    const merged = applyRemotePull(deleted, remote);
    expect(merged.actions).toEqual([]);
  });

  it('does not queue rows a pull brought in or removed', () => {
    const local = state({ assignments: [asg()] });
    const baseline = snapshotPushState(local);
    const remote = pull({
      assignments: [remoteAsg({ deleted_at: '2026-11-19T09:00:00+00:00', updated_at: '2026-11-19T09:00:00+00:00' })],
      actions: [remoteTodo()],
    });
    const merged = applyRemotePull(local, remote);
    expect(diffPushes(baseline, snapshotPushState(merged), merged, stampsFromPull(remote))).toEqual([]);
  });
});

describe('withoutQueuedDeletes', () => {
  it('keeps a row whose newest queued item is an upsert (deleted, then restored)', () => {
    const remote = pull({ assignments: [remoteAsg()] });
    const queued = [
      { kind: 'delete_assignment', payload: { id: 'a1' } },
      { kind: 'upsert_assignment', payload: { id: 'a1' } },
    ];
    expect(withoutQueuedDeletes(remote, queued).assignments).toHaveLength(1);
  });

  it('keeps tombstones, other ids and other tables', () => {
    const remote = pull({
      assignments: [remoteAsg({ deleted_at: '2026-11-19T09:00:00+00:00' }), remoteAsg({ id: 'a2' })],
      grades: [{ id: 'a1' }],
    });
    const out = withoutQueuedDeletes(remote, [{ kind: 'delete_assignment', payload: { id: 'a1' } }]);
    expect(out.assignments.map((r) => r.id)).toEqual(['a1', 'a2']);
    expect(out.grades).toHaveLength(1);
  });

  it('returns the pull unchanged when nothing is queued', () => {
    const remote = pull();
    expect(withoutQueuedDeletes(remote, [])).toBe(remote);
  });
});
