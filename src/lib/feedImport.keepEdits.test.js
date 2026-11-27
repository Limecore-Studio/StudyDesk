import { describe, it, expect } from 'vitest';
import { mergeFeedItems } from './icsParse.js';
import { applyFeedChanges } from './feedImport.js';

// StudyDesk#235 — a feed refresh never rewrites the user's edits, and never
// brings back a row they deleted.
const item = (over = {}) => ({ uid: 'u1', title: 'Essay', dueDate: '2026-12-01', time: '09:00', notes: null, ...over });
const row = (over = {}) => ({ uid: 'u1', id: 'id1', courseId: 'c-feed', title: 'Essay', dueDate: '2026-12-01', dueTime: '09:00', notes: null, type: 'imported', done: false, ...over });
const mine = { id: 'id1', courseId: 'c-mine', title: 'Essay (my title)', dueDate: '2026-12-03', dueTime: '10:00', notes: 'my notes', type: 'imported', done: true };

describe('mergeFeedItems reports what changed', () => {
  it('added, changed fields, or nothing', () => {
    const { changes } = mergeFeedItems([item(), item({ uid: 'u2' })], [item({ title: 'Essay v2' }), item({ uid: 'u2' }), item({ uid: 'u3' })]);
    expect(changes.get('u3')).toBe('added');
    expect([...changes.get('u1')]).toEqual(['title']);
    expect(changes.has('u2')).toBe(false);
  });
});

describe('applyFeedChanges', () => {
  const local = (map) => (id) => map[id];

  it('an unchanged event writes nothing, so the user\'s edits stand', () => {
    expect(applyFeedChanges([row()], new Map(), local({ id1: mine }))).toEqual([]);
  });

  it('a changed field updates only that field of the user\'s row', () => {
    const [out] = applyFeedChanges([row({ title: 'Essay v2' })], new Map([['u1', new Set(['title'])]]), local({ id1: mine }));
    expect(out).toEqual({ ...mine, title: 'Essay v2' });
  });

  it('a date change moves the date and keeps the user\'s notes, course and done', () => {
    const [out] = applyFeedChanges([row({ dueDate: '2026-12-05' })], new Map([['u1', new Set(['dueDate'])]]), local({ id1: mine }));
    expect(out).toMatchObject({ dueDate: '2026-12-05', notes: 'my notes', courseId: 'c-mine', done: true, title: 'Essay (my title)' });
  });

  it('a row the user deleted is never brought back, changed upstream or not', () => {
    expect(applyFeedChanges([row({ title: 'Essay v2' })], new Map([['u1', new Set(['title'])]]), local({}))).toEqual([]);
  });

  it('a new event is added, without the internal uid', () => {
    const [out] = applyFeedChanges([row()], new Map([['u1', 'added']]), local({}));
    expect(out.id).toBe('id1');
    expect(out.uid).toBeUndefined();
  });

  it('a "new" event whose row this device already has keeps the user\'s copy', () => {
    expect(applyFeedChanges([row()], new Map([['u1', 'added']]), local({ id1: mine }))).toEqual([]);
  });
});
