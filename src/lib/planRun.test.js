import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { INITIAL, reducer } from './appReducer.js';
import { buildEvents } from './calendar.js';
import { isOpenPlan, nextPlanStartAt, openPlansBetween, planSaveSteps, planToOffer } from './planRun.js';
import { timerPlanId } from './timerSnapshot.js';

const MIN = 60 * 1000;
const NOW = new Date('2026-10-22T14:00:00Z').getTime();
const at = (offsetMin) => new Date(NOW + offsetMin * MIN).toISOString();
const block = (id, offsetMin, extra = {}) => ({ id, startsAt: at(offsetMin), durationMinutes: 60, subjectId: 'c1', title: '', notes: '', fulfilledBy: null, dismissedAt: null, seriesId: null, ...extra });

describe('which block the start sheet offers', () => {
  it('a block that just started', () => {
    expect(planToOffer([block('a', -1)], NOW)?.id).toBe('a');
  });
  it('not one that has not started, or started too long ago', () => {
    expect(planToOffer([block('a', 2)], NOW)).toBeNull();
    expect(planToOffer([block('a', -11)], NOW)).toBeNull();
  });
  it('overlapping blocks: the start closest to now', () => {
    expect(planToOffer([block('early', -9), block('late', -2)], NOW)?.id).toBe('late');
  });
  it('never a kept, skipped, deleted, or already-offered block', () => {
    const plans = [block('k', -1, { fulfilledBy: 's1' }), block('d', -1, { dismissedAt: at(-1) }), block('x', -1, { deletedAt: at(0) }), block('o', -1)];
    expect(planToOffer(plans, NOW, { skip: new Set(['o']) })).toBeNull();
  });
  it('the next start to wait for, and today\'s open blocks in order', () => {
    const plans = [block('b', 90), block('a', 30), block('k', 10, { fulfilledBy: 's' })];
    expect(nextPlanStartAt(plans, NOW)).toBe(NOW + 30 * MIN);
    expect(openPlansBetween(plans, NOW, NOW + 24 * 60 * MIN).map((p) => p.id)).toEqual(['a', 'b']);
    expect(isOpenPlan(plans[2])).toBe(false);
  });
});

// Applies a save the way App does: the actions through the real reducer, the
// outbox operations into a list.
function applySave(state, save, planId, newId, queue) {
  const steps = planSaveSteps({ save, planId, plans: state.plannedSessions, sessions: state.studySessions, newId });
  for (const a of steps.actions) state = reducer(state, a);
  queue.push(...steps.outbox);
  return { state, steps };
}

const round = (minutes, startOffset = 0) => ({ subjectId: 'c1', durationMinutes: minutes, notes: '', startedAt: at(startOffset), focusRating: null });

describe('one block makes one session', () => {
  const start = () => ({ ...INITIAL, plannedSessions: [block('p1', 0)], studySessions: [] });

  it('the first round creates the session and links the block, session first in the outbox', () => {
    const queue = [];
    const { state, steps } = applySave(start(), round(25), 'p1', 's1', queue);
    expect(steps.kind).toBe('link');
    expect(state.studySessions).toHaveLength(1);
    expect(state.plannedSessions[0].fulfilledBy).toBe('s1');
    expect(queue.map(([op]) => op)).toEqual(['log_session', 'upsert_planned']);
    expect(queue[1][1]).toMatchObject({ id: 'p1', fulfilledBy: 's1', dismissedAt: null });
  });

  it('a second round adds to that session instead of creating another', () => {
    const queue = [];
    let { state } = applySave(start(), round(25), 'p1', 's1', queue);
    ({ state } = applySave(state, round(25, 30), 'p1', 's2', queue));
    expect(state.studySessions).toHaveLength(1);
    expect(state.studySessions[0]).toMatchObject({ id: 's1', durationMinutes: 50 });
    expect(queue.map(([op]) => op)).toEqual(['log_session', 'upsert_planned', 'update_session']);
    expect(queue[2][1]).toEqual({ id: 's1', durationMinutes: 50 });
  });

  it('partial counts as kept: 35 of 60 saves 35 and the block is kept', () => {
    const { state } = applySave(start(), round(35), 'p1', 's1', []);
    expect(state.studySessions[0].durationMinutes).toBe(35);
    const ev = [...buildEvents(state).byDay.values()].flat().find((e) => e.kind === 'planned');
    expect(ev.status).toBe('kept');
  });

  it('a free run (no block) is a plain session, as before', () => {
    const queue = [];
    const { state, steps } = applySave(start(), round(25), null, 's1', queue);
    expect(steps.kind).toBe('free');
    expect(state.plannedSessions[0].fulfilledBy).toBeNull();
    expect(queue.map(([op]) => op)).toEqual(['log_session']);
  });

  it('a deleted linked session starts a new one rather than editing nothing', () => {
    let { state } = applySave(start(), round(25), 'p1', 's1', []);
    state = { ...state, studySessions: state.studySessions.map((s) => ({ ...s, deletedAt: at(1) })) };
    const { steps } = applySave(state, round(25), 'p1', 's2', []);
    expect(steps.kind).toBe('link');
    expect(steps.sessionId).toBe('s2');
  });
});

describe('the run survives a restart', () => {
  afterEach(() => { delete globalThis.localStorage; });
  it('planId is read back from the persisted timer record', () => {
    const store = { 'sd-timer': JSON.stringify({ running: false, phase: 'focus', planId: 'p1' }) };
    globalThis.localStorage = { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = v; } };
    expect(timerPlanId()).toBe('p1');
    store['sd-timer'] = JSON.stringify({ running: false });
    expect(timerPlanId()).toBeNull();
  });
});

describe('guard: no path makes a second session for a kept block', () => {
  it('the calendar sheet offers neither Start nor Log on a kept block', () => {
    const src = readFileSync(join(import.meta.dirname, '..', 'features', 'calendar', 'CalendarView.jsx'), 'utf8');
    const editor = src.slice(src.indexOf('function PlanEditor'));
    expect(editor).toMatch(/\{onStart && draft\.status !== 'kept'[^(]*\(\s*<button[^>]*onClick=\{onStart\}/);
    expect(editor).toMatch(/\{draft\.status !== 'kept' && \(\s*<button[^>]*onClick=\{onLog\}/);
  });
});
