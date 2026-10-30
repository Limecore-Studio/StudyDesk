// v1.20 (StudyDesk#156) — progress counters: the model and its arithmetic.
//
// A counter counts something with +/− buttons: pages of a book, chapters,
// hours. Its `period` says what the number on the card means:
//   'total' — everything so far (progress through a book, toward `target`);
//   'day'   — today's count (a daily quota);
//   'week'  — this week's count (a weekly quota).
// Counts are kept per day (one row per counter per day), so a 'day' or 'week'
// counter starts again by itself, and changing a counter's period re-reads the
// same history. The day is the user's study day (lib/studyDay.js), so a 00:30
// session counts toward the evening it belongs to.
//
// No imports beyond the study-day helpers, so it is testable on its own.

import { studyDayKey, dayKeyToDate } from './studyDay.js';

export const PERIODS = ['total', 'day', 'week'];

/** NCC/StudyDesk-style uuidv5 namespace for counter days (a fixed random v4). */
const NAMESPACE = '3b2a9f40-6c1e-4d8a-9e57-1f0c2b7d4e61';

/** The id of a counter's row for one day: the same on every device, so two
 *  devices counting on the same day write one row (the newer write wins). */
export async function counterDayId(counterId, day) {
  const ns = NAMESPACE.replace(/-/g, '').match(/../g).map((h) => parseInt(h, 16));
  const name = new TextEncoder().encode(`${counterId}:${day}`);
  const buf = new Uint8Array(16 + name.length);
  buf.set(ns);
  buf.set(name, 16);
  const b = new Uint8Array(await crypto.subtle.digest('SHA-1', buf)).slice(0, 16);
  b[6] = (b[6] & 0x0f) | 0x50;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** The Monday-start week a day key belongs to, as the key of its first day.
 *  Same rule as the Timer's weekly hours. */
export function weekStartKey(dayKey) {
  const d = dayKeyToDate(dayKey);
  const dow = d.getDay();
  d.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1));
  return studyDayKey(d, 0);
}

/** The number a counter shows: today's, this week's or the running total. */
export function counterValue(counter, days, todayKey) {
  const own = (days || []).filter((d) => d.counterId === counter.id);
  if (counter.period === 'day') return round(own.filter((d) => d.day === todayKey).reduce((s, d) => s + d.value, 0));
  if (counter.period === 'week') {
    const start = weekStartKey(todayKey);
    return round(own.filter((d) => d.day >= start && d.day <= todayKey).reduce((s, d) => s + d.value, 0));
  }
  return round(own.reduce((s, d) => s + d.value, 0));
}

/** 0..1 toward the target, or null without one. */
export function counterProgress(counter, value) {
  if (!(counter.target > 0)) return null;
  return Math.max(0, Math.min(1, value / counter.target));
}

/** How much one tap adds: a quarter hour for an hours counter, otherwise 1. */
export function stepFor(counter) {
  return /^(h|hr|hrs|hour|hours|t|tunti|tuntia|stunden|heures|horas|jam|घंटे|小时|ساعات)$/i.test(String(counter.unit).trim()) ? 0.25 : 1;
}

const round = (n) => Math.round(n * 100) / 100;

/** Last writer wins on `updatedAt`, a deletion included. */
export function newer(a, b) {
  if (!b) return true;
  return new Date(a?.updatedAt || 0).getTime() > new Date(b.updatedAt || 0).getTime();
}

/** Server rows → local shape. */
export function counterFromRow(r) {
  return {
    id: r.id,
    name: r.name,
    unit: r.unit,
    period: PERIODS.includes(r.period) ? r.period : 'total',
    target: r.target != null ? Number(r.target) : null,
    subjectId: r.subject_id ?? null,
    position: Number(r.position) || 0,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at ?? null,
  };
}
export function dayFromRow(r) {
  return { id: r.id, counterId: r.counter_id, day: r.day, value: Number(r.value) || 0, updatedAt: r.updated_at };
}

/** Fold a pull into local state: per row, the newer side wins. Tombstones are
 *  kept (the newer one decides, so a delete still queued here is not undone by
 *  the pull that arrives first); the days of a deleted counter go. */
export function mergePulled(local, pulled) {
  const counters = new Map((local.counters || []).map((c) => [c.id, c]));
  for (const c of pulled.counters || []) {
    if (newer(c, counters.get(c.id))) counters.set(c.id, c);
  }
  const days = new Map((local.days || []).map((d) => [d.id, d]));
  for (const d of pulled.days || []) {
    if (newer(d, days.get(d.id))) days.set(d.id, d);
  }
  const dead = new Set([...counters.values()].filter((c) => c.deletedAt).map((c) => c.id));
  return {
    counters: [...counters.values()],
    days: [...days.values()].filter((d) => !dead.has(d.counterId)),
  };
}

/** The counters to show, in order. */
export function liveCounters(counters) {
  return (counters || []).filter((c) => !c.deletedAt).sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
}
