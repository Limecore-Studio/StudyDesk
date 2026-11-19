// Time-of-day parsing shared by the timetable and the deadline code. Split out
// of timetable.js in v1.22 (limecore#126): dueAt.js needs only this one
// conversion, and importing it from timetable.js kept the whole timetable
// module in the startup bundle. timetable.js re-exports `timeToMinutes`.

/** "08:15" / "08:15:00" → 495. Returns null for anything unparseable, which
 *  callers must treat as "no lesson" rather than as midnight — a corrupt row
 *  should drop out of the render, not draw a band across the top of the day. */
export function timeToMinutes(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return clampMinute(value);
  if (typeof value !== 'string') return null;
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(value.trim());
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min)) return null;
  if (h > 23 || min > 59) return null;
  return clampMinute(h * 60 + min);
}

export function clampMinute(n) {
  return Math.max(0, Math.min(24 * 60, Math.round(n)));
}
