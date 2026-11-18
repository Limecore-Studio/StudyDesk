import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// A stand-in for user_preferences: one row per user, grade_scale merged in.
const server = vi.hoisted(() => ({ rows: new Map(), failReads: false, upserts: [], maxBytes: Infinity }));
vi.mock('./supabase.js', () => ({
  supabase: {
    from() {
      return {
        upsert(row) {
          server.upserts.push(row);
          // Stands in for the CHECK on pg_column_size (StudyDesk#233).
          if (JSON.stringify(row.grade_scale).length > server.maxBytes) {
            return Promise.resolve({ error: { code: '23514', message: 'violates check constraint' } });
          }
          server.rows.set(row.user_id, { ...(server.rows.get(row.user_id) || {}), ...row });
          return Promise.resolve({ error: null });
        },
        select() {
          return {
            eq(_col, userId) {
              return {
                maybeSingle() {
                  if (server.failReads) return Promise.resolve({ data: null, error: { message: 'offline' } });
                  const r = server.rows.get(userId);
                  return Promise.resolve({ data: r ? { grade_scale: r.grade_scale ?? null } : null, error: null });
                },
              };
            },
          };
        },
      };
    },
  },
}));

// The suite runs under Node, which has no localStorage.
const store = new Map();
vi.stubGlobal('localStorage', {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
});

const mod = await import('./gradeScaleCloud.js');
const { syncGradeScaleOnSignIn, onLocalScaleChange, onScaleRefused, fromCloud, toCloud, _resetForTests } = mod;
const { SCALE_PRESETS } = await import('./gradeScale.js');

const GERMAN = { min: 1, max: 6, passMark: 4, direction: 'down', name: 'DE' };
const FINNISH = { min: 4, max: 10, passMark: 5, direction: 'up', name: '' };

beforeEach(() => {
  server.rows.clear();
  server.upserts = [];
  server.failReads = false;
  server.maxBytes = Infinity;
  localStorage.clear();
  _resetForTests();
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe('grade scale follows the account (v1.18.2)', () => {
  it('back-fills the server when it has no scale yet', async () => {
    const apply = vi.fn();
    expect(await syncGradeScaleOnSignIn('u1', { mode: 'custom', custom: GERMAN }, apply)).toBe('backfilled');
    expect(apply).not.toHaveBeenCalled();
    expect(fromCloud(server.rows.get('u1').grade_scale)).toEqual({ mode: 'custom', custom: GERMAN });
  });

  it('adopts the server scale on sign-in and does not echo it back', async () => {
    server.rows.set('u1', { user_id: 'u1', grade_scale: toCloud('custom', GERMAN) });
    const apply = vi.fn();
    expect(await syncGradeScaleOnSignIn('u1', { mode: 'ib', custom: FINNISH }, apply)).toBe('applied');
    expect(apply).toHaveBeenCalledWith('custom', GERMAN);
    // The app re-renders with the adopted scale: not a local change.
    onLocalScaleChange('custom', GERMAN, 'u1');
    await vi.advanceTimersByTimeAsync(2000);
    expect(server.upserts).toHaveLength(0);
  });

  it('pushes a change made while signed in, once, after the debounce', async () => {
    server.rows.set('u1', { user_id: 'u1', grade_scale: toCloud('ib', null) });
    await syncGradeScaleOnSignIn('u1', { mode: 'ib', custom: FINNISH }, vi.fn());
    onLocalScaleChange('custom', { ...GERMAN, max: 5 }, 'u1');
    onLocalScaleChange('custom', GERMAN, 'u1');
    expect(server.upserts).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(2000);
    expect(server.upserts).toHaveLength(1);
    expect(fromCloud(server.rows.get('u1').grade_scale)).toEqual({ mode: 'custom', custom: GERMAN });
    expect(localStorage.getItem('studydesk-grade-scale-dirty')).toBeNull();
  });

  it('a change whose push never landed wins over the server at the next sign-in', async () => {
    server.rows.set('u1', { user_id: 'u1', grade_scale: toCloud('ib', null) });
    await syncGradeScaleOnSignIn('u1', { mode: 'ib', custom: FINNISH }, vi.fn());
    onLocalScaleChange('custom', GERMAN, 'u1');   // app closed before the debounce fired
    _resetForTests();
    const apply = vi.fn();
    expect(await syncGradeScaleOnSignIn('u1', { mode: 'custom', custom: GERMAN }, apply)).toBe('pushed-dirty');
    expect(apply).not.toHaveBeenCalled();
    expect(fromCloud(server.rows.get('u1').grade_scale)).toEqual({ mode: 'custom', custom: GERMAN });
  });

  it('a guest change stays on the device', async () => {
    await syncGradeScaleOnSignIn(null, { mode: 'ib', custom: FINNISH }, vi.fn());
    onLocalScaleChange('custom', GERMAN, null);
    await vi.advanceTimersByTimeAsync(2000);
    expect(server.upserts).toHaveLength(0);
    expect(localStorage.getItem('studydesk-grade-scale-dirty')).toBeNull();
  });

  it('offline at sign-in: later changes are still noticed', async () => {
    server.failReads = true;
    expect(await syncGradeScaleOnSignIn('u1', { mode: 'ib', custom: FINNISH }, vi.fn())).toBe('error');
    onLocalScaleChange('us', FINNISH, 'u1');
    expect(localStorage.getItem('studydesk-grade-scale-dirty')).toBe('u1');
  });

  it('ignores unusable server values', () => {
    expect(fromCloud(null)).toBeNull();
    expect(fromCloud({ mode: 'weird' })).toBeNull();
    expect(fromCloud({ mode: 'custom' })).toBeNull();
    expect(fromCloud({ mode: 'ib', custom: null })).toEqual({ mode: 'ib', custom: null });
  });
});

// v1.21.1 (StudyDesk#233). The server's CHECK is pg_column_size(grade_scale)
// <= 8192 (supabase/migrations/20261116_grade_scale_size.sql). jsonb is larger
// than its JSON text: measured on Postgres, DE15 is 807 B of text and 1,474 B
// stored, the largest scale below 3,431 B of text and 4,650 B stored. Twice the
// text plus 64 bounds every measured case, so a scale that passes this
// estimate fits the server.
const SERVER_LIMIT = 8192;
const estimate = (v) => 2 * new TextEncoder().encode(JSON.stringify(v)).length + 64;

const LARGEST = {
  min: -99999.99, max: 99999.99, passMark: -99999.99, direction: 'down', name: '界'.repeat(24),
  steps: Array.from({ length: 40 }, (_, i) => ({ label: '界'.repeat(6), value: -99999.99 + i * 0.01 })),
  report: {
    enabled: true, method: 'averageThenConvert', best: -99999.99, worst: 99999.98,
    bands: Array.from({ length: 20 }, (_, i) => ({ min: -99999.99 + i, max: -99999.5 + i, grade: -99999.99 + i })),
  },
};

describe('every scale the client can make fits the server (StudyDesk#233)', () => {
  it('every preset fits', () => {
    const presets = SCALE_PRESETS.filter((p) => p.scale);
    expect(presets.length).toBeGreaterThan(0);
    for (const p of presets) expect(estimate(toCloud('custom', p.scale)), p.id).toBeLessThanOrEqual(SERVER_LIMIT);
  });

  it('the largest allowed custom scale (40 steps, 20 bands, every cap) fits', () => {
    // Over the caps on purpose: normalizeScale trims it to what can be saved.
    const over = { ...LARGEST, steps: [...LARGEST.steps, ...LARGEST.steps], report: { ...LARGEST.report, bands: [...LARGEST.report.bands, ...LARGEST.report.bands] } };
    const cloud = toCloud('custom', over);
    expect(cloud.custom.steps).toHaveLength(40);
    expect(cloud.custom.report.bands).toHaveLength(20);
    expect(estimate(cloud)).toBeLessThanOrEqual(SERVER_LIMIT);
  });
});

describe('a save the server refuses (StudyDesk#233)', () => {
  it('is shown once and not retried at the next sign-in', async () => {
    server.maxBytes = 300;   // the old 1024 B limit, scaled to the JSON text
    const refused = vi.fn();
    onScaleRefused(refused);
    const de15 = SCALE_PRESETS.find((p) => p.id === 'de15').scale;
    server.rows.set('u1', { user_id: 'u1', grade_scale: toCloud('ib', null) });
    await syncGradeScaleOnSignIn('u1', { mode: 'ib', custom: FINNISH }, vi.fn());
    onLocalScaleChange('custom', de15, 'u1');
    await vi.advanceTimersByTimeAsync(2000);
    expect(refused).toHaveBeenCalledTimes(1);
    expect(server.upserts).toHaveLength(1);

    // Next launch: no retry, and the server's older scale does not replace it.
    _resetForTests();
    const apply = vi.fn();
    expect(await syncGradeScaleOnSignIn('u1', { mode: 'custom', custom: de15 }, apply)).toBe('refused');
    expect(server.upserts).toHaveLength(1);
    expect(apply).not.toHaveBeenCalled();
    expect(refused).toHaveBeenCalledTimes(1);

    // A different scale is a new attempt, and a save that lands clears it.
    server.maxBytes = Infinity;
    onLocalScaleChange('custom', GERMAN, 'u1');
    await vi.advanceTimersByTimeAsync(2000);
    expect(server.upserts).toHaveLength(2);
    expect(localStorage.getItem('studydesk-grade-scale-refused')).toBeNull();
    onScaleRefused(null);
  });
});

