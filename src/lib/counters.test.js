import { describe, it, expect } from 'vitest';
import { counterValue, counterProgress, counterDayId, weekStartKey, stepFor, mergePulled, liveCounters } from './counters.js';

// v1.20 (StudyDesk#156) — progress counters: what the card shows, and how a
// pull folds in.

const C = (over = {}) => ({ id: 'c1', name: 'Physics', unit: 'pages', period: 'total', target: null, position: 0, updatedAt: '2026-10-01T00:00:00Z', deletedAt: null, ...over });
const D = (day, value, over = {}) => ({ id: `${day}`, counterId: 'c1', day, value, updatedAt: '2026-10-01T00:00:00Z', ...over });
const days = [D('2026-10-26', 10), D('2026-10-28', 5), D('2026-10-30', 3), D('2026-10-30', 0, { counterId: 'other' })];

describe('counterValue', () => {
  it('total sums every day; day is today; week is Monday to today', () => {
    expect(counterValue(C(), days, '2026-10-30')).toBe(18);
    expect(counterValue(C({ period: 'day' }), days, '2026-10-30')).toBe(3);
    // 2026-10-30 is a Friday; the week started Monday the 26th.
    expect(counterValue(C({ period: 'week' }), days, '2026-10-30')).toBe(18);
    expect(counterValue(C({ period: 'week' }), days, '2026-11-02')).toBe(0);
  });

  it('a week starting on a Sunday counts back to Monday', () => {
    expect(weekStartKey('2026-11-01')).toBe('2026-10-26');
    expect(weekStartKey('2026-10-26')).toBe('2026-10-26');
  });

  it('progress toward a target, capped at 1; none without one', () => {
    expect(counterProgress(C({ target: 40 }), 10)).toBe(0.25);
    expect(counterProgress(C({ target: 40 }), 50)).toBe(1);
    expect(counterProgress(C(), 10)).toBeNull();
  });

  it('hours step by a quarter, in any of the app\'s languages; the rest by one', () => {
    expect(stepFor(C({ unit: 'hours' }))).toBe(0.25);
    expect(stepFor(C({ unit: 'tuntia' }))).toBe(0.25);
    expect(stepFor(C({ unit: '小时' }))).toBe(0.25);
    expect(stepFor(C({ unit: 'pages' }))).toBe(1);
  });
});

describe('counterDayId', () => {
  it('is the same on every device for a counter and day, and differs otherwise', async () => {
    const a = await counterDayId('c1', '2026-10-30');
    expect(a).toBe(await counterDayId('c1', '2026-10-30'));
    expect(a).not.toBe(await counterDayId('c1', '2026-10-31'));
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe('mergePulled', () => {
  it('the newer side wins per row', () => {
    const local = { counters: [C({ name: 'Old', updatedAt: '2026-10-02T00:00:00Z' })], days: [D('2026-10-30', 4, { updatedAt: '2026-10-30T10:00:00Z' })] };
    const pulled = { counters: [C({ name: 'New', updatedAt: '2026-10-03T00:00:00Z' })], days: [D('2026-10-30', 9, { updatedAt: '2026-10-30T09:00:00Z' })] };
    const out = mergePulled(local, pulled);
    expect(out.counters[0].name).toBe('New');
    expect(out.days[0].value).toBe(4);
  });

  it('a counter deleted elsewhere leaves, with its days', () => {
    const local = { counters: [C()], days: [D('2026-10-30', 4)] };
    const out = mergePulled(local, { counters: [C({ deletedAt: '2026-10-05T00:00:00Z', updatedAt: '2026-10-05T00:00:00Z' })], days: [] });
    expect(liveCounters(out.counters)).toEqual([]);
    expect(out.days).toEqual([]);
  });

  it('a delete still queued here is not undone by an older server copy', () => {
    const local = { counters: [C({ deletedAt: '2026-10-05T00:00:00Z', updatedAt: '2026-10-05T00:00:00Z' })], days: [] };
    const out = mergePulled(local, { counters: [C({ updatedAt: '2026-10-01T00:00:00Z' })], days: [] });
    expect(liveCounters(out.counters)).toEqual([]);
  });

  it('a counter made here and not pushed yet stays', () => {
    const out = mergePulled({ counters: [C({ id: 'mine' })], days: [] }, { counters: [], days: [] });
    expect(liveCounters(out.counters).map((c) => c.id)).toEqual(['mine']);
  });
});
