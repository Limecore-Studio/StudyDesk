import { describe, it, expect } from 'vitest';
import { applyFocusAction } from './focusActions.js';
import { chipFor, chipActions } from '../app/useFocusChip.js';

// StudyDesk#289 — Pause / Resume / +5 min / End from the focus chip.
const NOW = 1_800_000_000_000;
const running = (over = {}) => ({ customFocus: 25, phase: 'focus', mode: 'pomodoro', running: true, startedAt: NOW - 10 * 60_000, secsAtStart: 1500, secsLeft: 1500, phaseStartedAt: NOW - 10 * 60_000, runId: 'run-1', planId: 'p1', task: 'Essay', courseId: 'c1', ...over });

describe('applyFocusAction', () => {
  it('Pause keeps what is left and stops the clock', () => {
    const { rec } = applyFocusAction(running(), 'pause', NOW);
    expect(rec).toMatchObject({ running: false, secsLeft: 900, startedAt: null, secsAtStart: null, runId: 'run-1' });
  });

  it('Resume restarts from what was left', () => {
    const paused = applyFocusAction(running(), 'pause', NOW).rec;
    const { rec } = applyFocusAction(paused, 'resume', NOW + 60_000);
    expect(rec).toMatchObject({ running: true, startedAt: NOW + 60_000, secsAtStart: 900 });
  });

  it('+5 min moves the end and grows the block, running or paused', () => {
    const { rec } = applyFocusAction(running(), 'plus5', NOW);
    expect(rec).toMatchObject({ customFocus: 30, secsAtStart: 1200, startedAt: NOW });
    const paused = applyFocusAction(running(), 'pause', NOW).rec;
    expect(applyFocusAction(paused, 'plus5', NOW).rec).toMatchObject({ customFocus: 30, secsLeft: 1200, running: false });
    expect(applyFocusAction(running({ mode: 'stopwatch' }), 'plus5', NOW).rec).toBeNull();
  });

  it('End saves exactly one session for the time done, and leaves the timer idle', () => {
    const { rec, session } = applyFocusAction(running(), 'end', NOW);
    expect(session).toEqual({ durationMinutes: 10, task: 'Essay', subjectId: 'c1', startedAt: new Date(NOW - 10 * 60_000).toISOString(), planId: 'p1', runId: 'run-1' });
    expect(rec).toMatchObject({ running: false, secsLeft: 1500, runId: null, planId: null, phaseStartedAt: null });
    // Ending the idle timer again saves nothing.
    expect(applyFocusAction(rec, 'end', NOW).session).toBeNull();
  });

  it('End under a minute, or on a break, saves nothing', () => {
    expect(applyFocusAction(running({ startedAt: NOW - 30_000 }), 'end', NOW).session).toBeNull();
    expect(applyFocusAction(running({ phase: 'short' }), 'end', NOW).session).toBeNull();
  });

  it('Pause on a block that already ran out does nothing (completion handles it)', () => {
    expect(applyFocusAction(running({ startedAt: NOW - 30 * 60_000 }), 'pause', NOW).rec).toBeNull();
  });
});

describe('chip state and buttons', () => {
  const t = (k) => k;
  it('a paused block keeps its chip with Resume; a running one has Pause, +5, End', () => {
    const paused = applyFocusAction(running(), 'pause', NOW).rec;
    expect(chipFor(paused, NOW)).toMatchObject({ paused: true, endsAt: 0 });
    expect(chipActions(chipFor(paused, NOW), t).map((a) => a.id)).toEqual(['resume', 'plus5', 'end']);
    expect(chipActions(chipFor(running(), NOW), t).map((a) => a.id)).toEqual(['pause', 'plus5', 'end']);
    expect(chipActions(chipFor(running({ mode: 'stopwatch', secsAtStart: 60 }), NOW), t).map((a) => a.id)).toEqual(['pause', 'end']);
  });
  it('an idle timer at a full block has no chip', () => {
    expect(chipFor({ ...running(), running: false, secsLeft: 1500 }, NOW)).toBeNull();
  });
});
