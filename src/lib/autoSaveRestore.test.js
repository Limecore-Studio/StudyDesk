import { describe, it, expect } from 'vitest';
import { reducer, INITIAL } from './appReducer.js';
import { planSaveSteps } from './planRun.js';

// v1.21 (#205) — an automatic save is undone by putting back exactly the rows
// it touched. These run the real save steps through the reducer, then undo.

const base = (over = {}) => ({ ...INITIAL, studySessions: [], plannedSessions: [], ...over });
const run = (state, actions) => actions.reduce(reducer, state);
const save = { subjectId: 'c1', durationMinutes: 25, notes: 'ch 4', startedAt: '2026-11-06T08:00:00.000Z', focusRating: null };

describe('RESTORE_ROWS after an automatic save', () => {
  it('a new session is removed outright, with no tombstone', () => {
    const s0 = base({ studySessions: [{ id: 'old', durationMinutes: 10 }] });
    const steps = planSaveSteps({ save, planId: null, plans: [], sessions: s0.studySessions, newId: 'run-1' });
    const s1 = run(s0, steps.actions);
    expect(s1.studySessions.map((s) => s.id)).toEqual(['old', 'run-1']);
    const s2 = reducer(s1, { type: 'RESTORE_ROWS', sessionId: 'run-1', session: null, planId: null, plan: null });
    expect(s2.studySessions).toEqual(s0.studySessions);
  });

  it('a plan the save fulfilled goes back to exactly what it was', () => {
    const plan = { id: 'p1', subjectId: 'c1', startsAt: '2026-11-06T08:00:00.000Z', durationMinutes: 25, status: 'planned', fulfilledBy: null, updatedAt: 'x' };
    const s0 = base({ plannedSessions: [plan] });
    const steps = planSaveSteps({ save, planId: 'p1', plans: s0.plannedSessions, sessions: [], newId: 'run-2' });
    const s1 = run(s0, steps.actions);
    expect(s1.plannedSessions[0].fulfilledBy).toBe('run-2');
    const s2 = reducer(s1, { type: 'RESTORE_ROWS', sessionId: 'run-2', session: null, planId: 'p1', plan });
    expect(s2.plannedSessions).toEqual([plan]);
    expect(s2.studySessions).toEqual([]);
  });

  it('an extended session gets its old length back', () => {
    const linked = { id: 's1', subjectId: 'c1', durationMinutes: 25, notes: null, focusRating: 3, updatedAt: 'x' };
    const plan = { id: 'p1', fulfilledBy: 's1', status: 'kept' };
    const s0 = base({ studySessions: [linked], plannedSessions: [plan] });
    const steps = planSaveSteps({ save, planId: 'p1', plans: s0.plannedSessions, sessions: s0.studySessions, newId: 'unused' });
    expect(steps.kind).toBe('extend');
    const s1 = run(s0, steps.actions);
    expect(s1.studySessions[0].durationMinutes).toBe(50);
    const s2 = reducer(s1, { type: 'RESTORE_ROWS', sessionId: 's1', session: linked, planId: null, plan: null });
    expect(s2.studySessions).toEqual([linked]);
  });

  it('the setting is off by default and toggles', () => {
    expect(INITIAL.autoSaveSessions).toBe(false);
    expect(reducer(base(), { type: 'SET_AUTO_SAVE_SESSIONS', on: true }).autoSaveSessions).toBe(true);
  });
});
