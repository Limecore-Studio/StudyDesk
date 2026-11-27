import { describe, it, expect } from 'vitest';
import { chipFor, tileFor } from './useFocusChip.js';

// StudyDesk#259 — which timer states get the live chip outside Lock In.
const NOW = 1_800_000_000_000;
const rec = (over = {}) => ({ running: true, mode: 'pomodoro', phase: 'focus', startedAt: NOW, secsAtStart: 1500, task: ' Essay ', lockedIn: false, ...over });

describe('chipFor', () => {
  it('a running focus countdown gets a chip counting down to its end', () => {
    expect(chipFor(rec(), NOW)).toEqual({ endsAt: NOW + 1_500_000, task: 'Essay', stopwatch: false, paused: false });
  });
  it('a running stopwatch gets a chip with no countdown', () => {
    expect(chipFor(rec({ mode: 'stopwatch', secsAtStart: 120 }), NOW)).toEqual({ endsAt: 0, task: 'Essay', stopwatch: true, paused: false });
  });
  it('Lock In is left to TimerView', () => {
    expect(chipFor(rec({ lockedIn: true }), NOW)).toBe('lockin');
  });
  it('no chip when paused, on a break, ended, or with no timer', () => {
    expect(chipFor(rec({ running: false }), NOW)).toBeNull();
    expect(chipFor(rec({ phase: 'short' }), NOW)).toBeNull();
    expect(chipFor(rec({ startedAt: NOW - 2_000_000 }), NOW)).toBeNull();
    expect(chipFor(null, NOW)).toBeNull();
  });
});

describe('tileFor (limecore#127, the Quick Settings tile)', () => {
  it('running countdown shows its end; a stopwatch runs with no end', () => {
    expect(tileFor(rec(), NOW)).toEqual({ state: 'running', endsAt: NOW + 1_500_000 });
    expect(tileFor(rec({ mode: 'stopwatch' }), NOW)).toEqual({ state: 'running', endsAt: 0 });
  });
  it('a block paused part-way is paused; a break paused part-way too', () => {
    expect(tileFor(rec({ running: false, secsLeft: 600 }), NOW).state).toBe('paused');
    expect(tileFor(rec({ running: false, phase: 'short', secsLeft: 120 }), NOW).state).toBe('paused');
  });
  it('idle at a full block, after the end, or with no timer: a tap starts one', () => {
    expect(tileFor(rec({ running: false, secsLeft: 1500 }), NOW).state).toBe('idle');
    expect(tileFor(rec({ startedAt: NOW - 2_000_000 }), NOW).state).toBe('idle');
    expect(tileFor(null, NOW).state).toBe('idle');
  });
});
