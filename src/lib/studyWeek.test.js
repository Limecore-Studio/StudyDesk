import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { studyWeekKey } from './studyWeek.js';

// v1.22 (StudyDesk#246) — timer lows.

describe('studyWeekKey', () => {
  it("files a Sunday session in the Sunday-start user's own week, not Monday's", () => {
    // Sunday 2026-11-22, 19:00 local.
    const sun = new Date(2026, 10, 22, 19, 0);
    expect(studyWeekKey(sun, 0, 0)).toBe('2026-11-22');
    expect(studyWeekKey(sun, 0, 1)).toBe('2026-11-16');
  });
  it('uses the study day, so a 01:00 session with a 04:00 day start is the previous day', () => {
    const monEarly = new Date(2026, 10, 23, 1, 0);
    expect(studyWeekKey(monEarly, 4, 1)).toBe('2026-11-16');
    expect(studyWeekKey(monEarly, 0, 1)).toBe('2026-11-23');
  });
  it('null for no date', () => expect(studyWeekKey(null, 0, 1)).toBeNull());
});

describe('TimerView', () => {
  const src = readFileSync(new URL('../features/timer/TimerView.jsx', import.meta.url), 'utf8');
  it('the Pomodoro dots keep the space before their state class', () => {
    expect(src).toContain(`"pomo-seg"+(i<focusDone%4?" done":i===session&&phase==="focus"?" current":"")`);
  });
  it('the done-today count is stored with its day and reset on another', () => {
    expect(src).toMatch(/focusDay: todayStudyDayKey\(/);
    expect(src).toMatch(/_saved\.focusDay === todayStudyDayKey\(/);
  });
  it('changing the length of a part-done block harvests it first', () => {
    const fn = src.slice(src.indexOf('const changeCustom'), src.indexOf('const harvestFocus'));
    expect(fn.indexOf('harvestFocus()')).toBeGreaterThan(-1);
    expect(fn.indexOf('harvestFocus()')).toBeLessThan(fn.indexOf('setCustomFocus(m)'));
  });
});
