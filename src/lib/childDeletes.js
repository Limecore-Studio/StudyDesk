// StudyDesk#244, #245 — deleting a parent takes its children with it.
//
// #244: deleting an assignment, a notebook page or a course tombstoned only the
// parent. Its attachment rows stayed live on the server and their files stayed
// in Storage; once a purge removed the parent, the cascade dropped the rows
// and left the files with nothing pointing at them, for good. The delete now
// queues each attachment's own delete as well (row tombstoned, file removed),
// through the same ops a single-attachment delete uses.
//
// #245: deleting a lesson (or a term, or unticking a weekday of a lesson)
// removed the timetable entry but kept every attendance mark on it. Those
// marks kept counting in the term percentage, under "No course", and could not
// be seen or cleared any more. Decision: a lesson's marks go with the lesson.
// The reducer drops them locally; these ops tombstone them on the server.
//
// Pure: the call sites dispatch and enqueue.

/** Outbox entries that delete an assignment's attachments (rows + files). */
export function assignmentAttachmentOps(attachments, assignmentIds) {
  const ids = new Set(assignmentIds);
  return (attachments || [])
    .filter((a) => a && !a.deletedAt && ids.has(a.assignmentId))
    .map((a) => ['delete_attachment', { id: a.id, storagePath: a.storagePath || null }]);
}

/** Outbox entries that delete a notebook page's attachments (rows + files). */
export function noteAttachmentOps(noteAttachments, noteId) {
  return (noteAttachments || [])
    .filter((a) => a && !a.deletedAt && a.entryId === noteId)
    .map((a) => ['delete_note_attachment', { id: a.id, storagePath: a.storagePath || null }]);
}

/** Outbox entries that clear the attendance marks of these lessons. */
export function attendanceOps(attendance, entryIds) {
  const ids = new Set(entryIds);
  return (attendance || [])
    .filter((a) => a && !a.deletedAt && ids.has(a.timetableEntryId))
    .map((a) => ['delete_attendance', { id: a.id, timetableEntryId: a.timetableEntryId, date: a.date }]);
}
