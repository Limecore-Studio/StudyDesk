import { describe, expect, it } from 'vitest';
import { INITIAL, reducer } from './appReducer.js';
import { DONE_ACTION_KEEP_DAYS, doneItems, groupByDay, isExpiredDoneAction, offerUndo, onUndoOffer, toggleFor } from './doneList.js';

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-10-22T12:00:00').getTime();

const state = () => ({
  ...INITIAL,
  actions: [
    { id: 'x1', text: 'Flashcards', done: true, doneAt: NOW - 2 * 60 * 60 * 1000, courseId: 'c1' },
    { id: 'x2', text: 'Open task', done: false },
    { id: 'x3', text: 'Suggested', done: true, doneAt: NOW, suggested: true },
  ],
  assignments: [
    { id: 'a1', title: 'Essay', done: true, courseId: 'c1', updatedAt: new Date(NOW - DAY).toISOString() },
    { id: 'a2', title: 'Lab', done: false, courseId: 'c1', updatedAt: new Date(NOW).toISOString() },
  ],
  exams: [{ id: 'e1', title: 'Final', done: true, courseId: 'c2', updatedAt: new Date(NOW - 3 * DAY).toISOString() }],
});

describe('the Done list (#87)', () => {
  it('holds ticked tasks, assignments and exams, newest first', () => {
    expect(doneItems(state()).map((i) => i.id)).toEqual(['x1', 'a1', 'e1']);
  });
  it('filters to one course for the course page', () => {
    expect(doneItems(state(), { courseId: 'c1' }).map((i) => i.id)).toEqual(['x1', 'a1']);
  });
  it('groups by the local day it was ticked', () => {
    const days = groupByDay(doneItems(state())).map(([d, items]) => [d, items.length]);
    expect(days).toEqual([['2026-10-22', 1], ['2026-10-21', 1], ['2026-10-19', 1]]);
  });
  it('unticking from the list puts the item back in upcoming', () => {
    let s = state();
    const essay = doneItems(s).find((i) => i.id === 'a1');
    s = reducer(s, toggleFor(essay));
    expect(s.assignments.find((a) => a.id === 'a1').done).toBe(false);
    expect(doneItems(s).map((i) => i.id)).not.toContain('a1');
    const task = doneItems(s).find((i) => i.id === 'x1');
    s = reducer(s, toggleFor(task));
    expect(s.actions.find((a) => a.id === 'x1')).toMatchObject({ done: false, doneAt: null });
  });
});

describe('done tasks are kept, not deleted the next morning', () => {
  it('kept within the window, removed after it', () => {
    expect(isExpiredDoneAction({ done: true, doneAt: NOW - 2 * DAY }, NOW)).toBe(false);
    expect(isExpiredDoneAction({ done: true, doneAt: NOW - (DONE_ACTION_KEEP_DAYS + 1) * DAY }, NOW)).toBe(true);
  });
  it('an open task is never removed', () => {
    expect(isExpiredDoneAction({ done: false, doneAt: 1 }, NOW)).toBe(false);
  });
});

describe('undo right after a tick', () => {
  it('delivers the offer to the one listener, and stops after unsubscribe', () => {
    const got = [];
    const off = onUndoOffer((o) => got.push(o));
    offerUndo('Essay', { type: 'TOGGLE_ASSIGNMENT', id: 'a1' });
    off();
    offerUndo('Ignored', { type: 'TOGGLE_ASSIGNMENT', id: 'a2' });
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ title: 'Essay', undo: { type: 'TOGGLE_ASSIGNMENT', id: 'a1' } });
  });
});
