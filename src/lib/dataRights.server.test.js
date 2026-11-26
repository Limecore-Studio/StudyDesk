import { describe, it, expect, vi, beforeEach } from 'vitest';

// limecore#88 — "Export my data" covers everything the account holds on the
// server (all three apps, same list as NCC#317) and the files StudyDesk owns.

const H = vi.hoisted(() => ({ calls: [], failTable: null, objects: {}, blobs: {} }));

function query(table) {
  const q = {
    _eq: null, _range: null,
    select() { return q; },
    eq(col, val) { q._eq = [col, val]; H.calls.push({ table, eq: q._eq }); return q; },
    order() { return q; },
    range(from) { q._range = from; return q.then ? q : q; },
    gt() { return q; },
    limit() { return q; },
    then(resolve) {
      if (H.failTable === table) return resolve({ data: null, error: new Error('permission denied') });
      return resolve({ data: q._range > 0 ? [] : [{ table }], error: null, count: 1 });
    },
  };
  return q;
}

vi.mock('./supabase.js', () => ({
  supabase: {
    from: (table) => query(table),
    storage: {
      from: (bucket) => ({
        list: async (prefix) => ({ data: H.objects[`${bucket}:${prefix}`] || [], error: null }),
        download: async (path) => ({ data: H.blobs[path], error: H.blobs[path] ? null : new Error('missing') }),
      }),
    },
  },
  readStoredSession: () => null,
  clearStoredSession: () => {},
}));
vi.mock('./selectAll.js', () => ({
  selectAll: async (client, table, { filter = (q) => q } = {}) => {
    const q = filter(query(table));
    return new Promise((res) => q.then(res));
  },
}));
vi.mock('./userStorage.js', () => ({ removeForUser: async () => {} }));
vi.mock('./profile.js', () => ({ AVATAR_BUCKET: 'avatars', AVATAR_FILE: 'avatar.jpg' }));

const DR = await import('./dataRights.js');

beforeEach(() => { H.calls.length = 0; H.failTable = null; H.objects = {}; H.blobs = {}; });

describe('serverOnlyData', () => {
  it('covers the account tables and all three apps', async () => {
    const out = await DR.serverOnlyData('u1');
    for (const t of ['profiles', 'user_preferences', 'app_opens', 'feedback', 'client_errors',
      'subjects', 'notebook_entries', 'notebook_attachments', 'assignment_attachments', 'timetable_entries',
      'lesson_attendance', 'planned_sessions', 'readings', 'progress_counters', 'progress_counter_days',
      'commitments', 'focus_timers', 'study_actions', 'academic_terms',
      'transactions', 'tasks', 'habits', 'workout_sessions', 'workout_sets', 'body_metrics']) {
      expect(out[t], t).toBeDefined();
    }
  });

  it('reads each table by its owner: user_id, id for profiles, RLS alone for feedback', async () => {
    await DR.serverOnlyData('u1');
    expect(H.calls).toContainEqual({ table: 'subjects', eq: ['user_id', 'u1'] });
    expect(H.calls).toContainEqual({ table: 'profiles', eq: ['id', 'u1'] });
    expect(H.calls.some((c) => c.table === 'feedback')).toBe(false);
  });

  it('a table it cannot read records the error rather than vanishing', async () => {
    H.failTable = 'notebook_entries';
    const out = await DR.serverOnlyData('u1');
    expect(out.notebook_entries).toEqual({ error: 'permission denied' });
  });
});

describe('serverFiles', () => {
  const blob = (text) => new Blob([text]);

  it('embeds the user\'s files from every bucket, recursing into folders', async () => {
    H.objects['notebook:u1'] = [{ name: 'note-1', id: null }];
    H.objects['notebook:u1/note-1'] = [{ name: 'a.png', id: 'f1', metadata: { size: 5, mimetype: 'image/png' } }];
    H.blobs['u1/note-1/a.png'] = blob('hello');
    const out = await DR.serverFiles('u1');
    expect(out.notebook).toEqual([{ path: 'u1/note-1/a.png', size: 5, createdAt: null, contentType: 'image/png', dataBase64: btoa('hello') }]);
    expect(out.avatars).toEqual([]);
    expect(out['assignment-attachments']).toEqual([]);
  });

  it('lists but skips a file over the per-file cap, and records a failed download', async () => {
    H.objects['assignment-attachments:u1'] = [
      { name: 'big.pdf', id: 'f2', metadata: { size: DR.FILE_CAP + 1 } },
      { name: 'gone.pdf', id: 'f3', metadata: { size: 10 } },
    ];
    const out = await DR.serverFiles('u1');
    expect(out['assignment-attachments'][0].skipped).toMatch(/limit/);
    expect(out['assignment-attachments'][0].dataBase64).toBeUndefined();
    expect(out['assignment-attachments'][1].error).toBe('missing');
  });
});
