// v1.19 (#186) — the in-app date/time picker's decision logic, kept pure so
// it can be tested without a browser.
//
// Two users (v1.14, v1.17) reported that tapping a date or time field on
// Android opened nothing: no picker, no keyboard, so no due date could be set.
// It does not reproduce on a current emulator WebView, and the feedback rows
// carry no device or WebView version, so the cause on their phones is unknown.
// What we can do is make sure no field DEPENDS on the native picker.
//
// The page cannot see the native picker: on Android WebView it is a platform
// dialog, and opening it fires no blur, no visibilitychange, nothing (checked
// on WebView 152, 2026-10-22). The one signal is a second tap. The native
// dialog covers the screen the moment it opens, so a second tap that reaches
// the SAME field soon after the first, with no value change in between, means
// the first tap opened nothing. That is when the in-app sheet takes over, and
// the device is remembered so later taps go straight to it.

/** A second tap within this window, with no change between, means no picker. */
export const REPEAT_MS = 2500;

const BROKEN_KEY = 'sd.nativePicker.broken';

/**
 * Whether this tap should open the in-app sheet instead of waiting on the
 * native picker. `prev` is the previous tap on the same field: `{ at, changed }`
 * where `changed` is true if the value changed after it. Null for a first tap.
 */
export function isRepeatTap(prev, now) {
  if (!prev || prev.changed) return false;
  const gap = now - prev.at;
  return gap >= 0 && gap <= REPEAT_MS;
}

// A device fact, not an account one, so it is not user-scoped: whoever signs
// in on this phone gets the same WebView. Storage can throw (private mode,
// quota); a picker that cannot remember still works, it just asks twice.
function readBroken() {
  try { return JSON.parse(localStorage.getItem(BROKEN_KEY) || '{}') || {}; } catch { return {}; }
}

/** True once this device's native picker for `kind` was seen not to open. */
export function nativePickerBroken(kind) {
  return readBroken()[kind] === true;
}

export function markNativePickerBroken(kind) {
  try {
    localStorage.setItem(BROKEN_KEY, JSON.stringify({ ...readBroken(), [kind]: true }));
  } catch { /* see readBroken */ }
}

const pad = (n) => String(n).padStart(2, '0');
export const isoDate = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;

/**
 * First day of the week for a locale, as JS `getDay()` (0 = Sunday). Uses
 * Intl week info where the runtime has it and falls back to Monday, which is
 * what most of the app's ten locales use.
 */
export function weekStartFor(locale) {
  try {
    const loc = new Intl.Locale(locale || 'en');
    const info = typeof loc.getWeekInfo === 'function' ? loc.getWeekInfo() : loc.weekInfo;
    if (info && Number.isInteger(info.firstDay)) return info.firstDay % 7; // Intl: 1 = Mon … 7 = Sun
  } catch { /* fall through */ }
  return 1;
}

/**
 * Six rows of seven days covering `month` (0-based) of `year`, starting on
 * `weekStart`. Fixed at six rows so the sheet does not change height between
 * months. Each cell is `{ iso, day, inMonth }`.
 */
export function monthGrid(year, month, weekStart = 1) {
  const first = new Date(year, month, 1);
  const lead = (first.getDay() - weekStart + 7) % 7;
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(year, month, 1 - lead + i);
    cells.push({ iso: isoDate(d.getFullYear(), d.getMonth(), d.getDate()), day: d.getDate(), inMonth: d.getMonth() === month });
  }
  return cells;
}

/**
 * Minute chips for an `<input type="time">` `step` (in seconds, as the
 * attribute is). 900 gives quarters, 300 gives fives; no step gives fives too,
 * because sixty chips is not a picker. A current value that is off the grid
 * is kept, so opening the sheet never silently moves a saved time.
 */
export function minuteOptions(step, current) {
  const s = Number(step);
  const every = Number.isFinite(s) && s >= 60 ? Math.max(1, Math.round(s / 60)) : 5;
  const out = [];
  for (let m = 0; m < 60; m += every) out.push(m);
  if (Number.isInteger(current) && current >= 0 && current < 60 && !out.includes(current)) {
    out.push(current);
    out.sort((a, b) => a - b);
  }
  return out;
}

/** `min`/`max` bounds as the native input applies them; ISO strings compare lexically. */
export function withinBounds(value, min, max) {
  if (!value) return true;
  if (min && value < min) return false;
  if (max && value > max) return false;
  return true;
}

/** "YYYY-MM-DDTHH:mm" → { date, time }; either part may be ''. */
export function splitLocal(value) {
  const [date = '', time = ''] = String(value || '').split('T');
  return { date, time: time.slice(0, 5) };
}

/** "HH:mm" (or "HH:mm:ss") → { h, m }, or nulls when blank or malformed. */
export function parseTime(value) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(value || ''));
  if (!m) return { h: null, m: null };
  return { h: Number(m[1]), m: Number(m[2]) };
}

export const formatTime = (h, m) => `${pad(h)}:${pad(m)}`;
