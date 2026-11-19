// The diff behind the assignment / exam / to-do pusher (useCloudPushers.js).
// Pure: no React, no storage. Split out so it can be tested (StudyDesk#232).

import { isInSync, isRemoteTombstone } from './syncStamps.js';

/** What the pusher compares between renders: each row's `updatedAt`, by id.
 *  Every mutation stamps it, so this is cheaper than deep equality and immune
 *  to unrelated field churn. Suggested to-dos are derived, never stored. */
export function snapshotPushState(state) {
  const snap = (list) => {
    const m = new Map();
    for (const x of list || []) m.set(x.id, x.updatedAt || '');
    return m;
  };
  return {
    assignments: snap(state.assignments),
    exams: snap(state.exams),
    actions: snap((state.actions || []).filter((a) => !a.suggested)),
  };
}

/**
 * The outbox entries that turn `prev` into `next`.
 *
 * `stamps` is what the last pull returned (StudyDesk#72), or null before the
 * first one. A row whose stamp moved because a pull brought the server's copy
 * in is not a local edit, and a row that left because the pull carried its
 * tombstone was deleted elsewhere; re-queueing either only moves the server's
 * timestamp. With no pull yet, every change is a local one.
 *
 * @returns {{kind: string, payload: object}[]}
 */
export function diffPushes(prev, next, state, stamps) {
  const out = [];
  const byId = (list) => new Map((list || []).map((x) => [x.id, x]));
  const assignmentsById = byId(state.assignments);
  const examsById = byId(state.exams);
  const actionsById = byId(state.actions);

  for (const [id, s] of next.assignments) {
    if (prev.assignments.get(id) === s) continue;
    const a = assignmentsById.get(id);
    if (!a?.courseId) continue;
    if (isInSync('assignments', a, stamps)) continue;
    out.push({ kind: 'upsert_assignment', payload: { id, courseId: a.courseId, title: a.title, type: a.type, dueDate: a.dueDate, dueTime: a.dueTime, notes: a.notes, done: a.done, updatedAt: a.updatedAt } });
  }
  for (const id of prev.assignments.keys()) {
    if (!next.assignments.has(id) && !isRemoteTombstone('assignments', id, stamps)) out.push({ kind: 'delete_assignment', payload: { id } });
  }

  for (const [id, s] of next.exams) {
    if (prev.exams.get(id) === s) continue;
    const e = examsById.get(id);
    if (!e?.courseId) continue;
    if (isInSync('exams', e, stamps)) continue;
    out.push({ kind: 'upsert_exam', payload: { id, courseId: e.courseId, title: e.title, dueDate: e.dueDate, difficulty: e.difficulty, notes: e.notes, done: e.done, topics: e.topics, updatedAt: e.updatedAt } });
  }
  for (const id of prev.exams.keys()) {
    if (!next.exams.has(id) && !isRemoteTombstone('exams', id, stamps)) out.push({ kind: 'delete_exam', payload: { id } });
  }

  for (const [id, s] of next.actions) {
    if (prev.actions.get(id) === s) continue;
    const a = actionsById.get(id);
    if (!a) continue;
    if (isInSync('actions', a, stamps)) continue;
    out.push({ kind: 'upsert_action', payload: { id, text: a.text, bucket: a.bucket, courseId: a.courseId, done: a.done, updatedAt: a.updatedAt } });
  }
  for (const id of prev.actions.keys()) {
    if (!next.actions.has(id) && !isRemoteTombstone('actions', id, stamps)) out.push({ kind: 'delete_action', payload: { id } });
  }
  return out;
}

// Pull key -> the delete kind the pusher queues for it.
const DELETE_KINDS = { assignments: 'delete_assignment', exams: 'delete_exam', actions: 'delete_action' };

/**
 * StudyDesk#232. These three lists are deleted by removal, with no local
 * tombstone, so a pull that lands while the delete is still queued would put
 * the server's live copy straight back (the homework reappears). Drops, from a
 * pull, every live row whose newest queued outbox item is its delete.
 *
 * @param {object} remote  A full or partial pull.
 * @param {{kind: string, payload?: {id?: string}}[]} queued  The outbox items, oldest first.
 */
export function withoutQueuedDeletes(remote, queued) {
  if (!remote || !queued?.length) return remote;
  const last = new Map();
  for (const it of queued) {
    const id = it?.payload?.id;
    if (id) last.set(`${it.kind.replace(/^(upsert|delete)_/, '')}:${id}`, it.kind);
  }
  let out = remote;
  for (const [key, kind] of Object.entries(DELETE_KINDS)) {
    const rows = remote[key];
    if (!Array.isArray(rows)) continue;
    const noun = kind.slice('delete_'.length);
    const kept = rows.filter((r) => r.deleted_at || last.get(`${noun}:${r.id}`) !== kind);
    if (kept.length !== rows.length) out = { ...out, [key]: kept };
  }
  return out;
}
