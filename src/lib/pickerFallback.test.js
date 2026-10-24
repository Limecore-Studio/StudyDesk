import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  REPEAT_MS, isRepeatTap, markNativePickerBroken, minuteOptions, monthGrid,
  nativePickerBroken, parseTime, splitLocal, weekStartFor, withinBounds,
} from './pickerFallback.js';

describe('isRepeatTap (#186: did the native picker open?)', () => {
  it('a first tap waits for the native picker', () => {
    expect(isRepeatTap(null, 1000)).toBe(false);
  });
  it('a second tap soon after, with no change, means nothing opened', () => {
    expect(isRepeatTap({ at: 1000, changed: false }, 1000 + 400)).toBe(true);
    expect(isRepeatTap({ at: 1000, changed: false }, 1000 + REPEAT_MS)).toBe(true);
  });
  it('a value change in between means the picker worked', () => {
    expect(isRepeatTap({ at: 1000, changed: true }, 1400)).toBe(false);
  });
  it('a tap long after the first is a fresh attempt, not a repeat', () => {
    expect(isRepeatTap({ at: 1000, changed: false }, 1000 + REPEAT_MS + 1)).toBe(false);
  });
});

describe('per-device memory', () => {
  let store;
  beforeEach(() => {
    store = {};
    globalThis.localStorage = {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
    };
  });
  afterEach(() => { delete globalThis.localStorage; });

  it('remembers each kind of field separately', () => {
    expect(nativePickerBroken('date')).toBe(false);
    markNativePickerBroken('date');
    expect(nativePickerBroken('date')).toBe(true);
    expect(nativePickerBroken('time')).toBe(false);
  });
  it('a throwing storage leaves the picker working, not crashing', () => {
    globalThis.localStorage = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
    expect(() => markNativePickerBroken('date')).not.toThrow();
    expect(nativePickerBroken('date')).toBe(false);
  });
});

describe('monthGrid', () => {
  it('is always six weeks and starts on the week start', () => {
    // October 2026 starts on a Thursday.
    const mon = monthGrid(2026, 9, 1);
    expect(mon).toHaveLength(42);
    expect(mon[0]).toEqual({ iso: '2026-09-28', day: 28, inMonth: false });
    expect(mon[3]).toEqual({ iso: '2026-10-01', day: 1, inMonth: true });
    const sun = monthGrid(2026, 9, 0);
    expect(sun[0].iso).toBe('2026-09-27');
    expect(sun[4].iso).toBe('2026-10-01');
  });
  it('handles a month that starts on the week start and crosses a year', () => {
    const feb = monthGrid(2026, 1, 0); // 1 Feb 2026 is a Sunday
    expect(feb[0].iso).toBe('2026-02-01');
    const dec = monthGrid(2026, 11, 1);
    expect(dec.at(-1).iso.startsWith('2027-01')).toBe(true);
  });
});

describe('weekStartFor', () => {
  it('reads Intl week info and falls back to Monday', () => {
    expect([0, 1, 6]).toContain(weekStartFor('en-US'));
    expect(weekStartFor('not a locale!!')).toBe(1);
  });
});

describe('minuteOptions', () => {
  it('follows the step attribute (seconds)', () => {
    expect(minuteOptions(900)).toEqual([0, 15, 30, 45]);
    expect(minuteOptions(300)).toHaveLength(12);
    expect(minuteOptions(undefined)).toHaveLength(12);
  });
  it('keeps an off-grid saved minute instead of moving it', () => {
    expect(minuteOptions(900, 20)).toEqual([0, 15, 20, 30, 45]);
  });
});

describe('value helpers', () => {
  it('bounds compare like the native input', () => {
    expect(withinBounds('2026-10-22', '2026-10-01', '2026-10-31')).toBe(true);
    expect(withinBounds('2026-11-01', '', '2026-10-31')).toBe(false);
    expect(withinBounds('2026-10-22T10:00', '', '2026-10-22T09:59')).toBe(false);
    expect(withinBounds('', '2026-10-01', '')).toBe(true);
  });
  it('splits and parses local values', () => {
    expect(splitLocal('2026-10-22T14:30')).toEqual({ date: '2026-10-22', time: '14:30' });
    expect(splitLocal('')).toEqual({ date: '', time: '' });
    expect(parseTime('09:05:00')).toEqual({ h: 9, m: 5 });
    expect(parseTime('')).toEqual({ h: null, m: null });
  });
});

// The regression guard #186 asked for. Tests here cannot render components,
// so this checks the source: every date/time field goes through DateInput,
// and DateInput itself never renders its input read-only or untappable.
describe('no field depends on the native picker alone', () => {
  const srcDir = join(import.meta.dirname, '..');
  const files = [];
  const walk = (d) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.jsx?$/.test(f) && !f.endsWith('.test.js')) files.push(p);
    }
  };
  walk(srcDir);

  it('has no raw <input type="date|time|datetime-local">', () => {
    const offenders = files.filter((p) => !p.endsWith('DateInput.jsx'))
      // Code lines only: several comments quote `<input type="time">` by name.
      .filter((p) => readFileSync(p, 'utf8').split('\n')
        .filter((l) => !/^\s*(\/\/|\/?\*)/.test(l))
        .join('\n')
        .match(/(^|[^`])<input\s+type=["'](date|time|datetime-local)["']/m))
      .map((p) => p.slice(srcDir.length + 1));
    expect(offenders).toEqual([]);
  });
  it('DateInput renders an enabled, tappable input', () => {
    const src = readFileSync(join(srcDir, 'lib', 'DateInput.jsx'), 'utf8');
    const input = src.slice(src.indexOf('<input'), src.indexOf('/>', src.indexOf('<input')));
    expect(input).not.toMatch(/readOnly|pointerEvents|tabIndex=\{?-1/);
    expect(input).toMatch(/onClick=\{handleClick\}/);
  });
});
