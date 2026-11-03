import { describe, it, expect } from 'vitest';
import { trendScaleInfo } from './gradeTrend.js';
import { SCALE_PRESETS } from './gradeScale.js';

// v1.20 (#219) — the owner's Stats card read "IB AVERAGE TREND · 1–7 scale"
// on a German 1–6 account, and drew an improving average as a falling line.

// Echoes the key and its values, so assertions can read what was asked for.
const t = (key, vars) => (vars ? `${key}(${Object.entries(vars).map(([k, v]) => `${k}=${v}`).join(',')})` : key);
const preset = (id) => SCALE_PRESETS.find((p) => p.id === id).scale;

describe('trendScaleInfo', () => {
  it('a German 1–6 custom scale: not IB, and lower is better', () => {
    const info = trendScaleInfo('custom', { min: 1, max: 6, passMark: 4, direction: 'down', name: 'Germany' }, t);
    expect(info.title).toBe('st.avgTrend');
    expect(info.note).toBe('Germany · gv.scaleSummary(min=1,max=6,pass=4,best=1)');
    expect(info.lowerIsBetter).toBe(true);
  });

  it('German points with report grades: the average is in 1–6 report grades, lower is better', () => {
    const info = trendScaleInfo('custom', { ...preset('de15'), report: { ...preset('de15').report, enabled: true } }, t);
    expect(info.note).toBe('gv.reportScale(best=1,worst=6)');
    expect(info.lowerIsBetter).toBe(true);
  });

  it('an upward custom scale (Finnish 4–10) draws higher as better', () => {
    const info = trendScaleInfo('custom', preset('fi410'), t);
    expect(info.title).toBe('st.avgTrend');
    expect(info.note).toBe('gv.scaleSummary(min=4,max=10,pass=5,best=10)');
    expect(info.lowerIsBetter).toBe(false);
  });

  it('IB is unchanged', () => {
    expect(trendScaleInfo('ib', null, t)).toEqual({ title: 'st.ibTrend', note: 'st.ibScale', lowerIsBetter: false });
  });

  it('US is unchanged', () => {
    expect(trendScaleInfo('us', null, t)).toEqual({ title: 'st.gpaTrend', note: 'st.usScale', lowerIsBetter: false });
  });
});
