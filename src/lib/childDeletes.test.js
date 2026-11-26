import { describe, it, expect } from 'vitest';
import { assignmentAttachmentOps, noteAttachmentOps, attendanceOps } from './childDeletes.js';
import { reducer, INITIAL } from './appReducer.js';

// StudyDesk#244, #245 — a parent's delete takes its children with it.
describe('child delete ops', () => {
  it('an assignment takes its live attachments (row + file)', () => {
    const att = [
      { id: 'f1', assignmentId: 'a1', storagePath: 'u/a1/x.pdf' },
      { id: 'f2', assignmentId: 'a2', storagePath: 'u/a2/y.pdf' },
      { id: 'f3', assignmentId: 'a1', storagePath: 'u/a1/z.pdf', deletedAt: '2026-01-01' },
    ];
    expect(assignmentAttachmentOps(att, ['a1'])).toEqual([['delete_attachment', { id: 'f1', storagePath: 'u/a1/x.pdf' }]]);
  });
  it('a notebook page takes its attachments', () => {
    expect(noteAttachmentOps([{ id: 'n1f', entryId: 'n1', storagePath: 'u/n1/p.png' }, { id: 'n2f', entryId: 'n2' }], 'n1'))
      .toEqual([['delete_note_attachment', { id: 'n1f', storagePath: 'u/n1/p.png' }]]);
  });
  it('lessons take their attendance marks, by natural key', () => {
    const marks = [{ id: 'm1', timetableEntryId: 'te1', date: '2026-11-02' }, { id: 'm2', timetableEntryId: 'te2', date: '2026-11-02' }];
    expect(attendanceOps(marks, ['te1'])).toEqual([['delete_attendance', { id: 'm1', timetableEntryId: 'te1', date: '2026-11-02' }]]);
  });
});

describe('reducer drops a lesson\'s marks with it (#245)', () => {
  const s = {
    ...INITIAL,
    academicTerms: [{ id: 't1' }],
    timetableEntries: [{ id: 'te1', termId: 't1' }, { id: 'te2', termId: 't1' }, { id: 'te3', termId: 't2' }],
    attendance: [{ id: 'm1', timetableEntryId: 'te1' }, { id: 'm2', timetableEntryId: 'te2' }, { id: 'm3', timetableEntryId: 'te3' }],
  };
  it('one lesson', () => {
    expect(reducer(s, { type: 'DELETE_TT_ENTRY', id: 'te1' }).attendance.map((a) => a.id)).toEqual(['m2', 'm3']);
  });
  it('a set of lessons', () => {
    expect(reducer(s, { type: 'DELETE_TT_ENTRIES', ids: ['te1', 'te2'] }).attendance.map((a) => a.id)).toEqual(['m3']);
  });
  it('a term and its lessons', () => {
    expect(reducer(s, { type: 'DELETE_TERM', id: 't1', descendantIds: [] }).attendance.map((a) => a.id)).toEqual(['m3']);
  });
});
