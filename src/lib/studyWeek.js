// v1.22 (StudyDesk#246) — the week a study session counts toward.
//
// Stats and the timer bucketed weeks from Monday whatever the user's week
// start, so a Sunday-start user's Sunday session sat in one week on the
// calendar and in the previous one in Stats. One answer now, from the same
// study day (lib/studyDay.js) and the same week start as the calendar.
import { studyDayKey } from './studyDay.js';
import { startOfWeek, resolveWeekStart } from './calendar.js';
import { formatLocale } from './dates.js';

/** The study-day key ("YYYY-MM-DD") of the first day of `when`'s week, or
 *  null when `when` has no day. `weekStart` 0-6 (Sunday = 0). */
export function studyWeekKey(when, dayStart, weekStart) {
  const day = studyDayKey(when, dayStart);
  return day ? startOfWeek(day, weekStart) : null;
}

/** The week start the calendar uses. */
export function userWeekStart() {
  return resolveWeekStart(formatLocale());
}
