// v1.20 Block A (StudyDesk#201, limecore#68) — live sync v2: the hint protocol.
//
// Every signed-in device joins the private Realtime topic `user:<uid>`. After
// a successful push it broadcasts one `changed` event per table it wrote, and
// the other devices pull just those tables. The payload names tables, never
// rows: the data always comes from an RLS-scoped pull, so a hint can make a
// device pull early but can never put anything on its screen.
//
//     { app: 'studydesk', table: 'grades', at: <epoch ms>, device: <id> }
//
// NCC and LimeLog speak the same protocol on the same topic. A hint for a
// table this app does not pull (an NCC transaction, a LimeLog set) is ignored.
// Old builds never join the topic and keep postgres_changes plus the resume
// pull, so nothing changes for them.

export const HINT_EVENT = 'changed';
export const HINT_APP = 'studydesk';

/** The private topic for a user. Realtime Authorization only lets the
 *  user's own JWT join or send on it (realtime.messages RLS, limecore#68). */
export const hintTopic = (userId) => `user:${userId}`;

/** Server table → key in the object `pullAllStudyData()` returns. Also the
 *  set of tables a hint can make this app pull. */
export const TABLE_KEYS = {
  subjects: 'subjects',
  grades: 'grades',
  study_sessions: 'sessions',
  assignments: 'assignments',
  exams: 'exams',
  study_actions: 'actions',
  planned_sessions: 'plannedSessions',
  academic_terms: 'academicTerms',
  timetable_entries: 'timetableEntries',
  assignment_attachments: 'attachments',
  commitments: 'commitments',
  notebook_entries: 'notes',
  notebook_attachments: 'noteAttachments',
  lesson_attendance: 'attendance',
};

/** Outbox kind → the table its push writes. Feedback and app opens are
 *  absent: no device shows them, so there is nothing to announce. */
export const KIND_TABLES = {
  upsert_subject: 'subjects',
  delete_subject: 'subjects',
  archive_semester: 'subjects',
  restore_semester: 'subjects',
  upsert_grade: 'grades',
  delete_grade: 'grades',
  log_session: 'study_sessions',
  update_session: 'study_sessions',
  delete_session: 'study_sessions',
  upsert_assignment: 'assignments',
  delete_assignment: 'assignments',
  upsert_exam: 'exams',
  delete_exam: 'exams',
  upsert_action: 'study_actions',
  delete_action: 'study_actions',
  upsert_planned: 'planned_sessions',
  delete_planned: 'planned_sessions',
  upsert_term: 'academic_terms',
  delete_term: 'academic_terms',
  upsert_timetable: 'timetable_entries',
  delete_timetable: 'timetable_entries',
  delete_attachment: 'assignment_attachments',
  upsert_commitment: 'commitments',
  delete_commitment: 'commitments',
  upsert_attendance: 'lesson_attendance',
  delete_attendance: 'lesson_attendance',
  upsert_note: 'notebook_entries',
  delete_note: 'notebook_entries',
  upsert_note_attachment: 'notebook_attachments',
  delete_note_attachment: 'notebook_attachments',
};

/** This page's id. `broadcast.self: false` already keeps a channel's own
 *  sends from coming back to it; the id covers a second channel instance in
 *  the same page (a rejoin racing the old one) and reads well in logs. */
export const DEVICE_ID = (() => {
  try { return crypto.randomUUID(); } catch { return `d-${Math.random().toString(36).slice(2)}`; }
})();

/** v1.20 (#202): tables a hint can name that are not study data, so
 *  `pullStudyTables` never sees them. The shared focus timer is read by
 *  lib/focusSync.js instead. */
const HINT_ONLY = new Set(['focus_timers']);

/** True for a table a hint may name: study data, or the shared timer. */
export function isHintTable(t) {
  return typeof t === 'string' && (Object.prototype.hasOwnProperty.call(TABLE_KEYS, t) || HINT_ONLY.has(t));
}

/** The tables a hint asks this app to pull, or [] for one to ignore: its own
 *  echo, malformed, or only tables this app does not hold. */
export function tablesFromHint(payload, ownDevice = DEVICE_ID) {
  if (!payload || typeof payload !== 'object') return [];
  if (payload.device && payload.device === ownDevice) return [];
  return isHintTable(payload.table) ? [payload.table] : [];
}

/** Rejoin delay after the n-th consecutive failure: 1 s, 2 s, 4 s … 30 s. */
export function backoffMs(attempt) {
  return Math.min(30_000, 1000 * 2 ** Math.max(0, attempt));
}

/**
 * Collects table names over a short window and hands them over as one batch,
 * so a burst of hints (a semester archive writes many rows in several tables)
 * costs one pull per table rather than one per hint.
 */
export function createTableBatcher(flush, windowMs) {
  let pending = new Set();
  let timer = null;
  return {
    add(tables) {
      for (const t of tables) pending.add(t);
      if (timer || pending.size === 0) return;
      timer = setTimeout(() => {
        timer = null;
        const batch = [...pending];
        pending = new Set();
        flush(batch);
      }, windowMs);
    },
    cancel() {
      if (timer) clearTimeout(timer);
      timer = null;
      pending = new Set();
    },
  };
}
