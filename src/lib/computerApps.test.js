import { describe, it, expect, beforeEach } from 'vitest';
import { shouldShowComputerNote, markComputerNoteSeen } from './computerApps.js';

// StudyDesk#260 — the Next Up note: once per account, after its first week.
const store = new Map();
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };

const NOW = Date.parse('2026-11-19T12:00:00Z');
const user = (days, id = 'u1') => ({ id, created_at: new Date(NOW - days * 86_400_000).toISOString() });

describe('shouldShowComputerNote', () => {
  beforeEach(() => store.clear());

  it('shows for an account a week old with data, until seen', () => {
    expect(shouldShowComputerNote(user(8), { hasData: true, now: NOW })).toBe(true);
    markComputerNoteSeen('u1');
    expect(shouldShowComputerNote(user(8), { hasData: true, now: NOW })).toBe(false);
  });

  it('is per account: another account on the phone still gets it once', () => {
    markComputerNoteSeen('u1');
    expect(shouldShowComputerNote(user(30, 'u2'), { hasData: true, now: NOW })).toBe(true);
  });

  it('not in the first week, not without data, not without an account', () => {
    expect(shouldShowComputerNote(user(6), { hasData: true, now: NOW })).toBe(false);
    expect(shouldShowComputerNote(user(30), { hasData: false, now: NOW })).toBe(false);
    expect(shouldShowComputerNote(null, { hasData: true, now: NOW })).toBe(false);
    expect(shouldShowComputerNote({ id: 'u3' }, { hasData: true, now: NOW })).toBe(false);
  });
});
