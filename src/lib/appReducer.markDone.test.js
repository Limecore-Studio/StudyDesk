import { describe, it, expect } from 'vitest';
import { reducer, INITIAL } from './appReducer.js';

// StudyDesk#239: a reminder's "Mark done" never reopens an assignment.
describe('SET_ASSIGNMENT_DONE', () => {
  const state = (done) => ({ ...INITIAL, assignments: [{ id: 'a1', title: 'Essay', done, updatedAt: '2026-11-01T00:00:00.000Z' }] });

  it('marks an open assignment done and stamps it', () => {
    const next = reducer(state(false), { type: 'SET_ASSIGNMENT_DONE', id: 'a1' });
    expect(next.assignments[0].done).toBe(true);
    expect(next.assignments[0].updatedAt).not.toBe('2026-11-01T00:00:00.000Z');
  });

  it('is a no-op on an assignment already done (same state, nothing to push)', () => {
    const s = state(true);
    expect(reducer(s, { type: 'SET_ASSIGNMENT_DONE', id: 'a1' })).toBe(s);
  });

  it('is a no-op for an assignment that no longer exists', () => {
    const s = state(false);
    expect(reducer(s, { type: 'SET_ASSIGNMENT_DONE', id: 'gone' })).toBe(s);
  });
});
