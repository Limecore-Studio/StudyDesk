// v1.20 (#219) — how the Stats grade-trend card names and draws the scale.
//
// The card said "IB average · 1–7 scale" for every non-US mode, custom scales
// included, and drew higher numbers higher. On a lower-is-better scale (a
// German 1–6, or report grades 1–6 over 0–15 points) an improving average
// then looked like a fall. The wording here is the Grades screen's own
// (describeScale, gv.reportScale), so the two screens describe one scale alike.

import { scaleFor, describeScale } from './gradeScale.js';
import { activeReport } from './reportGrade.js';

/** { title, note, lowerIsBetter } for the trend card in `mode`. */
export function trendScaleInfo(mode, customScale, t) {
  if (mode === 'us') return { title: t('st.gpaTrend'), note: t('st.usScale'), lowerIsBetter: false };
  if (mode !== 'custom') return { title: t('st.ibTrend'), note: t('st.ibScale'), lowerIsBetter: false };
  const scale = scaleFor(mode, customScale);
  // With report grades on, the average is in report grades (lib/gpa.js
  // overallAverage), whose order is their own: German 0–15 points run up, the
  // 1–6 report grades they turn into run down.
  const report = activeReport(scale);
  const summary = report ? t('gv.reportScale', { best: report.best, worst: report.worst }) : describeScale(scale, t);
  return {
    title: t('st.avgTrend'),
    note: scale.name ? `${scale.name} · ${summary}` : summary,
    lowerIsBetter: report ? report.best < report.worst : scale.direction === 'down',
  };
}
