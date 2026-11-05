import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fakeClient, makeUuids } from '../test/fakePostgrest.js';

// v1.16 (limecore#28, StudyDesk#73) — the real `pullAllStudyData`, run against
// a PostgREST stand-in that truncates at 1000 rows without an error, the way
// the real one does.

const holder = vi.hoisted(() => ({ client: null }));
vi.mock('./supabase.js', () => ({
  get supabase() {
    return holder.client;
  },
}));

const { pullAllStudyData, pullStudyTables } = await import('./sync.js');
const { mergeStamps, stampsFromPull, isInSync } = await import('./syncStamps.js');

const TABLES = [
  'subjects', 'grades', 'study_sessions', 'assignments', 'exams', 'study_actions',
  'planned_sessions', 'academic_terms', 'timetable_entries', 'assignment_attachments',
  'commitments', 'notebook_entries', 'notebook_attachments', 'lesson_attendance',
];

function seed(sizes = {}) {
  const tables = {};
  for (const t of TABLES) {
    tables[t] = makeUuids(sizes[t] ?? 3).map((id) => ({ id, updated_at: '2026-01-01T00:00:00Z' }));
  }
  return tables;
}

beforeEach(() => {
  holder.client = null;
});

describe('pullAllStudyData', () => {
  it('returns every attendance row past the 1000-row cap', async () => {
    // `lesson_attendance` is the table that actually gets there: it grows
    // every school day. Before v1.16 this pull returned exactly 1000 of these.
    const tables = seed({ lesson_attendance: 1200 });
    holder.client = fakeClient(tables);
    const remote = await pullAllStudyData();
    expect(remote.attendance).toHaveLength(1200);
    expect(new Set(remote.attendance.map((r) => r.id))).toEqual(
      new Set(tables.lesson_attendance.map((r) => r.id)),
    );
  });

  it('pages every table it reads, not just the ones that are big today', async () => {
    // The structural guard. A table added to this pull later with a bare
    // `select('*')` makes a request with no keyset order, and fails here —
    // whatever it is called and however small it is when it is added.
    holder.client = fakeClient(seed());
    await pullAllStudyData();
    const unpaged = holder.client.requests.filter((r) => !r.order || r.order.col !== 'id');
    expect(unpaged.map((r) => r.table)).toEqual([]);
    expect(new Set(holder.client.requests.map((r) => r.table))).toEqual(new Set(TABLES));
  });

  it('maps each table to the key the merge reads', async () => {
    holder.client = fakeClient(seed({ subjects: 2, notebook_entries: 4 }));
    const remote = await pullAllStudyData();
    expect(remote.subjects).toHaveLength(2);
    expect(remote.notes).toHaveLength(4);
    expect(Object.keys(remote).sort()).toEqual([
      'academicTerms', 'actions', 'assignments', 'attachments', 'attendance',
      'commitments', 'exams', 'grades', 'noteAttachments', 'notes',
      'plannedSessions', 'sessions', 'subjects', 'timetableEntries',
    ]);
  });

  it('still tolerates a missing notebook or attendance table', async () => {
    // The 1.13 window: a newer app against a database the owner has not
    // migrated yet. Paging must not turn "feature not there yet" into
    // "sync is broken".
    const tables = seed();
    delete tables.notebook_entries;
    delete tables.notebook_attachments;
    delete tables.lesson_attendance;
    holder.client = fakeClient(tables);
    const remote = await pullAllStudyData();
    expect(remote.notes).toEqual([]);
    expect(remote.attendance).toEqual([]);
    expect(remote.subjects).toHaveLength(3);
  });

  it('throws, rather than returning a partial pull, when a later page fails', async () => {
    const tables = seed({ assignments: 2500 });
    holder.client = fakeClient(tables, {
      failWhen: (req) =>
        req.table === 'assignments' && req.gt
          ? { code: '57014', message: 'canceling statement due to statement timeout' }
          : null,
    });
    await expect(pullAllStudyData()).rejects.toMatchObject({ code: '57014' });
  });

  it('throws on a missing core table, as before', async () => {
    const tables = seed();
    delete tables.grades;
    holder.client = fakeClient(tables);
    await expect(pullAllStudyData()).rejects.toMatchObject({ code: '42P01' });
  });
});

// v1.20 (StudyDesk#201) — the targeted pull a live-sync hint runs.
describe('pullStudyTables', () => {
  it('selects only the named tables and returns only their keys', async () => {
    const client = fakeClient(seed());
    holder.client = client;
    const remote = await pullStudyTables(['grades', 'notebook_entries', 'grades', 'transactions']);
    expect(Object.keys(remote).sort()).toEqual(['grades', 'notes']);
    expect(new Set(client.requests.map((r) => r.table))).toEqual(new Set(['grades', 'notebook_entries']));
  });

  it('pages a table past the row cap like the full pull', async () => {
    holder.client = fakeClient(seed({ grades: 1500 }));
    const remote = await pullStudyTables(['grades']);
    expect(remote.grades).toHaveLength(1500);
  });

  it('tolerates a notebook table that does not exist yet, and nothing else', async () => {
    const tables = seed();
    delete tables.notebook_entries;
    delete tables.exams;
    holder.client = fakeClient(tables);
    await expect(pullStudyTables(['notebook_entries'])).resolves.toEqual({ notes: [] });
    await expect(pullStudyTables(['exams'])).rejects.toMatchObject({ code: '42P01' });
  });
});

describe('mergeStamps', () => {
  const row = (id, at, deleted = null) => ({ id, updated_at: at, deleted_at: deleted });

  it('replaces only the kinds the partial pull carried', () => {
    const full = stampsFromPull({
      assignments: [row('a1', '2026-10-01T00:00:00Z')],
      exams: [row('e1', '2026-10-01T00:00:00Z')],
    });
    const next = mergeStamps(full, { assignments: [row('a1', '2026-10-02T00:00:00Z')] });
    expect(next.assignments.get('a1').at).toBe(Date.parse('2026-10-02T00:00:00Z'));
    expect(next.exams).toBe(full.exams);
  });

  it('a hint for a row this device just pushed leaves it in sync, so nothing is re-queued', () => {
    // The push stamped the row with its edit time; the server stores it as is
    // and the hinted pull hands back the same instant in Postgres format.
    const local = { id: 'a1', updatedAt: '2026-10-29T09:00:00.123Z' };
    const stamps = mergeStamps(null, { assignments: [row('a1', '2026-10-29T09:00:00.123+00:00')] });
    expect(isInSync('assignments', local, stamps)).toBe(true);
  });
});
