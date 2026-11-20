import { describe, it, expect } from 'vitest';
import { chipFor } from './useFocusChip.js';

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
