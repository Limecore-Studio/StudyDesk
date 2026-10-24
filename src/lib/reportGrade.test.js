import { describe, expect, it, vi } from 'vitest';

// gradeScaleCloud imports the client; only its pure toCloud/fromCloud are used here.
vi.mock('./supabase.js', () => ({ supabase: {} }));
import { DE15_REPORT, DE15_STEPS, bandOf, normalizeReport, overallReport, reportText, stepLabel, subjectReport } from './reportGrade.js';
import { normalizeScale, SCALE_PRESETS } from './gradeScale.js';
import { fromCloud, toCloud } from './gradeScaleCloud.js';
import { overallAverage } from './gpa.js';

const g = (grade, weight = 1, extra = {}) => ({ grade, weight, ...extra });
const avgThen = { ...DE15_REPORT, method: 'averageThenConvert' };

describe('DIA 15-point bands (#178)', () => {
  it('maps every point to its whole report grade', () => {
    const expected = { 15: 1, 14: 1, 13: 1, 12: 2, 11: 2, 10: 2, 9: 3, 8: 3, 7: 3, 6: 4, 5: 4, 4: 4, 3: 5, 2: 5, 1: 5, 0: 6 };
    for (const [pts, grade] of Object.entries(expected)) expect(bandOf(Number(pts), DE15_REPORT)).toBe(grade);
  });
  it('a hand-typed half point rounds to the nearest point first', () => {
    expect(bandOf(12.5, DE15_REPORT)).toBe(1);
    expect(bandOf(12.4, DE15_REPORT)).toBe(2);
  });
  it('names the steps: 12 is 2+, 13 is 1−', () => {
    expect(stepLabel(12, DE15_STEPS)).toBe('2+');
    expect(stepLabel(13, DE15_STEPS)).toBe('1−');
    expect(stepLabel(12.5, DE15_STEPS)).toBeNull();
  });
});

describe('subject report grade', () => {
  it('a subject full of 2+ is a 2, not the 12-point average read as better', () => {
    const r = subjectReport([g(12), g(12), g(12)], DE15_REPORT);
    expect(r).toMatchObject({ fine: 12, value: 2, whole: 2, between: null });
  });
  it('convert first (default): 13 (1−) and 12 (2+) give 1.5, shown as 1–2', () => {
    const r = subjectReport([g(13), g(12)], DE15_REPORT);
    expect(r.value).toBe(1.5);
    expect(r.whole).toBeNull();
    expect(r.between).toEqual([1, 2]);
    expect(reportText(r)).toBe('1–2');
    expect(r.fine).toBe(12.5);
  });
  it('average first: the same grades give 12.5 → 13 → 1', () => {
    const r = subjectReport([g(13), g(12)], avgThen);
    expect(r).toMatchObject({ value: 1, whole: 1, between: null });
  });
  it('weights apply to the whole grades', () => {
    // 15 (1) at weight 3 and 9 (3) at weight 1: (3·1 + 1·3) / 4 = 1.5 → between.
    expect(subjectReport([g(15, 3), g(9, 1)], DE15_REPORT).between).toEqual([1, 2]);
    // 15 at weight 1 and 9 at weight 3: (1 + 9) / 4 = 2.5 → between 2 and 3.
    expect(subjectReport([g(15, 1), g(9, 3)], DE15_REPORT).between).toEqual([2, 3]);
    expect(subjectReport([g(15, 1), g(10, 2)], DE15_REPORT)).toMatchObject({ whole: 2 });
  });
  it('no grades, or deleted ones only, is no grade', () => {
    expect(subjectReport([], DE15_REPORT)).toBeNull();
    expect(subjectReport([g(12, 1, { deletedAt: 'x' })], DE15_REPORT)).toBeNull();
  });
});

describe('overall report average', () => {
  it('credit-weighted mean of whole report grades', () => {
    const subjects = [
      { report: subjectReport([g(12)], DE15_REPORT), credits: 2 }, // 2
      { report: subjectReport([g(14)], DE15_REPORT), credits: 1 }, // 1
    ];
    expect(overallReport(subjects)).toEqual({ value: 1.67, projection: false });
  });
  it('a subject still between two grades counts at x.5 and makes it a projection', () => {
    const subjects = [
      { report: subjectReport([g(13), g(12)], DE15_REPORT), credits: 1 }, // 1.5
      { report: subjectReport([g(11)], DE15_REPORT), credits: 1 }, // 2
    ];
    expect(overallReport(subjects)).toEqual({ value: 1.75, projection: true });
  });
});

describe('the scale carries steps and the report rule', () => {
  const de15 = SCALE_PRESETS.find((p) => p.id === 'de15').scale;
  it('the German preset: 0–15, pass 5, with steps and report', () => {
    const s = normalizeScale(de15);
    expect(s).toMatchObject({ min: 0, max: 15, passMark: 5, direction: 'up' });
    expect(s.steps).toHaveLength(16);
    expect(s.report).toMatchObject({ enabled: true, method: 'convertThenAverage', best: 1, worst: 6 });
  });
  it('a scale without them keeps its exact old shape', () => {
    expect(Object.keys(normalizeScale({ min: 4, max: 10, passMark: 5 }))).toEqual(['min', 'max', 'passMark', 'direction', 'name']);
  });
  it('clearing them (another preset chip) removes them', () => {
    const s = normalizeScale({ ...de15, steps: null, report: null, min: 0, max: 20, passMark: 10 });
    expect(s.steps).toBeUndefined();
    expect(s.report).toBeUndefined();
  });
  it('survives the cloud round trip, so NCC and other devices see it', () => {
    const back = fromCloud(JSON.parse(JSON.stringify(toCloud('custom', de15))));
    expect(back.custom.report).toEqual(normalizeReport(DE15_REPORT));
    expect(back.custom.steps).toEqual(DE15_STEPS);
  });
  it('rejects a report with no usable bands', () => {
    expect(normalizeReport({ bands: [{ min: 'x' }] })).toBeNull();
    expect(normalizeReport(null)).toBeNull();
  });
});

describe('overallAverage: one number for every screen', () => {
  const courses = { a: { id: 'a', credits: 1 }, b: { id: 'b', credits: 1 } };
  const grades = [{ subjectId: 'a', grade: 12, weight: 1 }, { subjectId: 'b', grade: 14, weight: 1 }];
  const de15 = normalizeScale(SCALE_PRESETS.find((p) => p.id === 'de15').scale);
  it('report grades when the rule is on', () => {
    expect(overallAverage(courses, grades, 'custom', de15)).toEqual({ value: 1.5, projection: false, report: true });
  });
  it('the fine GPA when it is off, or on another mode', () => {
    const off = { ...de15, report: { ...de15.report, enabled: false } };
    expect(overallAverage(courses, grades, 'custom', off)).toMatchObject({ value: 13, report: false });
    expect(overallAverage(courses, grades, 'ib', de15)).toMatchObject({ value: 13, report: false });
  });
});
