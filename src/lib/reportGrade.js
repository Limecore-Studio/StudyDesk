// v1.19 (#178) — tendency grades and whole report grades.
//
// A DIA / German pre-year grades on 1–6 with tendencies (1+, 1, 1−, 2+ …),
// which line up with the 15-point system: 15 = 1+, 14 = 1, 13 = 1−, 12 = 2+
// … 0 = 6. The report card shows WHOLE grades: 15, 14 and 13 are all a 1.
// StudyDesk averaged the fine values, so a subject full of 2+ (12 points)
// pulled the average above the 2 the report card gives.
//
// Two optional parts of a custom scale, both stored in it (and so synced
// through user_preferences.grade_scale with no migration; grades.grade stays
// the numeric fine value):
//
//   steps   [{ label, value }] — named grades to enter by tapping a chip
//           ("2+" stores 12). Rows show the label.
//   report  { enabled, method, bands: [{ min, max, grade }], best, worst }
//           — how a fine value maps to the whole grade on the report card,
//           and how a subject's report grade is formed from its grades.
//
// The method is a setting because the owner believes, but has not confirmed,
// how the school does it (decision on #178, 2026-10-22):
//   convertThenAverage (default) — each grade becomes its whole grade first,
//                       and the subject is the weighted mean of those:
//                       13 (1−) and 12 (2+) give (1 + 2) / 2 = 1.5.
//   averageThenConvert — the fine values are averaged, rounded to a whole
//                       point, and that point's band is the grade:
//                       12.5 → 13 → 1.
// A subject that lands exactly on x.5 is shown as "1–2", not rounded either
// way: at that point the teacher decides, and the app must not guess.
//
// NCC shows these grades too (nexus-command-center#160), so this file is the
// one definition; NCC ports it with the same tests.

export const REPORT_METHODS = ['convertThenAverage', 'averageThenConvert'];

/** DIA 15-point / German 1–6 with tendencies. */
export const DE15_STEPS = [
  ['1+', 15], ['1', 14], ['1−', 13],
  ['2+', 12], ['2', 11], ['2−', 10],
  ['3+', 9], ['3', 8], ['3−', 7],
  ['4+', 6], ['4', 5], ['4−', 4],
  ['5+', 3], ['5', 2], ['5−', 1],
  ['6', 0],
].map(([label, value]) => ({ label, value }));

export const DE15_REPORT = {
  enabled: true,
  method: 'convertThenAverage',
  // Whole grades run 1 (best) to 6.
  best: 1,
  worst: 6,
  bands: [
    { min: 13, max: 15, grade: 1 },
    { min: 10, max: 12, grade: 2 },
    { min: 7, max: 9, grade: 3 },
    { min: 4, max: 6, grade: 4 },
    { min: 1, max: 3, grade: 5 },
    { min: 0, max: 0, grade: 6 },
  ],
};

const finite = (v) => {
  const n = typeof v === 'string' ? parseFloat(v) : v;
  return Number.isFinite(n) ? n : null;
};

/** Steps as stored, or null. Bad entries are dropped one by one. */
export function normalizeSteps(raw) {
  if (!Array.isArray(raw)) return null;
  const out = [];
  for (const s of raw.slice(0, 40)) {
    const value = finite(s?.value);
    const label = typeof s?.label === 'string' ? s.label.trim().slice(0, 6) : '';
    if (value === null || !label) continue;
    out.push({ label, value });
  }
  return out.length ? out : null;
}

/** A report definition as stored, or null when it has no usable bands. */
export function normalizeReport(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.bands)) return null;
  const bands = [];
  for (const b of raw.bands.slice(0, 20)) {
    const min = finite(b?.min); const max = finite(b?.max); const grade = finite(b?.grade);
    if (min === null || max === null || grade === null) continue;
    bands.push({ min: Math.min(min, max), max: Math.max(min, max), grade });
  }
  if (!bands.length) return null;
  const grades = bands.map((b) => b.grade);
  const best = finite(raw.best) ?? Math.min(...grades);
  const worst = finite(raw.worst) ?? Math.max(...grades);
  return {
    enabled: raw.enabled !== false,
    method: REPORT_METHODS.includes(raw.method) ? raw.method : REPORT_METHODS[0],
    best,
    worst,
    bands,
  };
}

/** The scale's report definition when it is switched on, else null. */
export function activeReport(scale) {
  return scale?.report?.enabled ? scale.report : null;
}

/** "2+" for 12 on a scale with steps; null when the value has no name. */
export function stepLabel(value, steps) {
  const n = finite(value);
  if (n === null || !steps) return null;
  return steps.find((s) => s.value === n)?.label ?? null;
}

/**
 * The whole report grade a fine value maps to. A value between two bands
 * (12.5 typed by hand) is rounded to the nearest point first, half up, which
 * is how a point total becomes a point. Null when no band covers it.
 */
export function bandOf(value, report) {
  const n = finite(value);
  if (n === null || !report) return null;
  const point = Math.round(n);
  const hit = report.bands.find((b) => point >= b.min && point <= b.max);
  if (hit) return hit.grade;
  // Outside every band: clamp to the nearest end rather than drop the grade.
  const sorted = [...report.bands].sort((a, b) => a.min - b.min);
  if (point < sorted[0].min) return sorted[0].grade;
  if (point > sorted.at(-1).max) return sorted.at(-1).grade;
  return null;
}

// Weighted mean with the same weight rules as gpa.js subjectEffectiveGrade:
// weights that sum to zero mean "all equal".
function weightedMean(pairs) {
  if (!pairs.length) return null;
  const totalW = pairs.reduce((s, [, w]) => s + w, 0);
  if (totalW === 0) return pairs.reduce((s, [v]) => s + v, 0) / pairs.length;
  return pairs.reduce((s, [v, w]) => s + v * w, 0) / totalW;
}

const EPS = 1e-9;

/**
 * A subject's report grade from its grade rows.
 * Returns null with no grades, else:
 *   fine     weighted mean of the fine values (shown as the secondary line)
 *   value    the subject's report value on the report scale (1.5 possible)
 *   whole    the whole report grade, or null when `value` is exactly x.5
 *   between  [better, worse] whole grades when `value` is exactly x.5
 */
export function subjectReport(grades, report) {
  const live = (grades || []).filter((g) => !g.deletedAt && finite(g.grade) !== null);
  if (!live.length || !report) return null;
  const pairs = live.map((g) => [finite(g.grade), finite(g.weight) ?? 0]);
  const fine = weightedMean(pairs);

  let value;
  if (report.method === 'averageThenConvert') {
    value = bandOf(fine, report);
  } else {
    value = weightedMean(pairs.map(([v, w]) => [bandOf(v, report), w]));
  }
  if (value === null) return null;

  const frac = value - Math.floor(value);
  if (Math.abs(frac - 0.5) < EPS) {
    const lo = Math.floor(value); const hi = lo + 1;
    const better = report.best <= report.worst ? lo : hi;
    const worse = better === lo ? hi : lo;
    return { fine, value, whole: null, between: [better, worse] };
  }
  return { fine, value, whole: Math.round(value), between: null };
}

/**
 * The overall average: credit-weighted mean of the subjects' whole report
 * grades. A subject still at x.5 counts at x.5 — it is between two grades,
 * so neither is assumed — and the result is then a projection.
 *
 * `subjects` is [{ report, credits }] where report came from subjectReport.
 */
export function overallReport(subjects) {
  const usable = (subjects || []).filter((s) => s.report);
  if (!usable.length) return { value: 0, projection: false };
  const pairs = usable.map((s) => [s.report.whole ?? s.report.value, s.credits]);
  const value = weightedMean(pairs);
  return {
    value: Math.round(value * 100) / 100,
    projection: usable.some((s) => s.report.whole === null),
  };
}

/** "2", or "1–2" for a subject between two grades. */
export function reportText(r) {
  if (!r) return '—';
  return r.between ? `${r.between[0]}–${r.between[1]}` : String(r.whole);
}
