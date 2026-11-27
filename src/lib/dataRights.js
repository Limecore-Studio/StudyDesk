// GDPR data-subject rights — Article 20 (portability) and Article 17 (erasure).
//
// Both are exposed as buttons in Settings rather than as a "contact us" address,
// so a user never has to ask and we never have to service a request by hand.
//
// Export works signed in or as a guest: a guest's data lives only on the device,
// and it is still their data. Deletion only means anything when there is a
// server-side account to delete.

import { Capacitor, registerPlugin } from '@capacitor/core';
import { supabase, readStoredSession, clearStoredSession } from './supabase.js';
import { readOwner } from './deviceOwner.js';
import { selectAll } from './selectAll.js';
import { removeForUser } from './userStorage.js';
import { AVATAR_BUCKET, AVATAR_FILE } from './profile.js';

const EXPORT_SCHEMA_VERSION = 1;

/**
 * Everything we hold about the user, as a plain object.
 *
 * Built from local state rather than by re-reading the server: local state is
 * the union of what synced down and what has not synced up yet, so it is the
 * more complete picture. Article 20 asks for "structured, commonly used and
 * machine-readable" — JSON qualifies, and unlike CSV it can carry the nested
 * shape without inventing a flattening the user then has to undo.
 *
 * Soft-deleted rows are included, and flagged. They still exist in the
 * database, so omitting them would make the export a misleading account of what
 * we hold.
 */
// ── limecore#88 — everything the account holds on the server ──────────────
//
// One account spans StudyDesk, NCC and LimeLog, and the privacy policy says
// "Export my data" from any of them covers all of them. The list matches NCC's
// (NCC#317) so the three exports agree. Each table is read as the signed-in
// user, filtered to rows the user OWNS (a task merely shared with them is the
// owner's), so RLS and the filter together decide what comes back. A table
// that cannot be read records its error, so an incomplete export says so.

// v1.18.1 (StudyDesk#153): only these `feedback` columns are granted; RLS
// limits the rows to the user's own.
const FEEDBACK_EXPORT_COLUMNS = 'id, app, app_version, category, rating, message, status, shipped_in, created_at';

// owner: which column names the user ('user_id' default, 'id' for profiles,
// 'none' when RLS alone decides). orderBy: tables without an `id` column are
// read in ranges ordered by these, since the id-keyed pager cannot page them.
export const SERVER_TABLES = [
  // Account
  { table: 'profiles', owner: 'id' },
  { table: 'user_preferences', orderBy: ['user_id'] },
  { table: 'supporter_entitlements', orderBy: ['user_id'] },
  // Only these columns are granted; the verification code itself is not.
  { table: 'kofi_alt_emails', columns: 'email, verified_at, code_expires_at, last_sent_at, user_id', orderBy: ['email'] },
  { table: 'app_opens', orderBy: ['opened_on', 'app'] },
  { table: 'audit_log', owner: 'none' },
  { table: 'feedback', columns: FEEDBACK_EXPORT_COLUMNS, owner: 'none' },
  { table: 'client_errors' },
  // StudyDesk
  { table: 'subjects' },
  { table: 'grades' },
  { table: 'study_sessions' },
  { table: 'assignments' },
  { table: 'assignment_attachments' },
  { table: 'exams' },
  { table: 'study_actions' },
  { table: 'notebook_entries' },
  { table: 'notebook_attachments' },
  { table: 'academic_terms' },
  { table: 'timetable_entries' },
  { table: 'lesson_attendance' },
  { table: 'planned_sessions' },
  { table: 'readings' },
  { table: 'progress_counters' },
  { table: 'progress_counter_days' },
  { table: 'commitments' },
  { table: 'focus_timers', orderBy: ['user_id'] },
  // Nexus Command Center
  { table: 'transactions' },
  { table: 'budget_categories' },
  { table: 'budget_category_shares', orderBy: ['user_id'] },
  { table: 'manual_assets' },
  { table: 'portfolio_holdings' },
  { table: 'portfolio_lots' },
  { table: 'stock_sales' },
  { table: 'portfolio_cash_entries' },
  { table: 'watchlist_items' },
  { table: 'recurring_rules' },
  { table: 'goals' },
  { table: 'tasks' },
  { table: 'task_shares', orderBy: ['user_id'] },
  { table: 'habits' },
  { table: 'habit_completions' },
  { table: 'braindump_entries' },
  { table: 'work_quality_logs' },
  // LimeLog
  { table: 'workout_sessions' },
  { table: 'workout_sets' },
  { table: 'exercise_prs' },
  { table: 'body_metrics' },
];

/** Kept for callers of the v1.16 name: the two server-only tables. */
export const SERVER_ONLY_TABLES = ['feedback', 'client_errors'];

const RANGE = 1000;

async function readRanged(t, userId) {
  const rows = [];
  for (let from = 0; ; from += RANGE) {
    let q = supabase.from(t.table).select(t.columns ?? '*').eq('user_id', userId);
    for (const col of t.orderBy ?? []) q = q.order(col, { ascending: true });
    const { data, error } = await q.range(from, from + RANGE - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < RANGE) return rows;
  }
}

async function readTable(t, userId) {
  if (t.orderBy) return readRanged(t, userId);
  const owner = t.owner ?? 'user_id';
  const { data, error } = await selectAll(supabase, t.table, {
    ...(t.columns ? { columns: t.columns } : {}),
    ...(owner === 'none' ? {} : { filter: (q) => q.eq(owner, userId) }),
  });
  if (error) throw error;
  return data ?? [];
}

export async function serverOnlyData(userId) {
  const out = {};
  for (const t of SERVER_TABLES) {
    try {
      out[t.table] = await readTable(t, userId);
    } catch (e) {
      out[t.table] = { error: e?.message ?? String(e) };
    }
  }
  return out;
}

// ── limecore#88 — the uploaded files themselves ──────────────────────────
//
// StudyDesk owns all three buckets, so its export carries the FILES, not only
// a listing: path, size, date, type, and the bytes as base64. Capped so the
// export still saves on a phone: a file over FILE_CAP, or one that would take
// the total past TOTAL_CAP, is listed with `skipped` and why, and can still be
// downloaded in the app. Every storage policy scopes a user to `<user_id>/`.
export const STORAGE_BUCKETS = ['avatars', 'notebook', 'assignment-attachments'];
export const FILE_CAP = 10 * 1024 * 1024;
export const TOTAL_CAP = 25 * 1024 * 1024;

async function listFolder(bucket, prefix, out, depth = 0) {
  if (depth > 4) return;
  for (let offset = 0; ; offset += RANGE) {
    const { data, error } = await supabase.storage.from(bucket).list(prefix, { limit: RANGE, offset });
    if (error) throw error;
    for (const o of data ?? []) {
      const path = `${prefix}/${o.name}`;
      // A folder has no id and no metadata; recurse into it.
      if (!o.id) await listFolder(bucket, path, out, depth + 1);
      else out.push({ path, size: o.metadata?.size ?? null, createdAt: o.created_at ?? null, contentType: o.metadata?.mimetype ?? null });
    }
    if (!data || data.length < RANGE) return;
  }
}

async function toBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export async function serverFiles(userId) {
  const out = {};
  let total = 0;
  for (const bucket of STORAGE_BUCKETS) {
    try {
      const entries = [];
      await listFolder(bucket, userId, entries);
      for (const e of entries) {
        if (e.size != null && e.size > FILE_CAP) { e.skipped = 'larger than the export limit; download it in the app'; continue; }
        if (e.size != null && total + e.size > TOTAL_CAP) { e.skipped = 'export size limit reached; download it in the app'; continue; }
        try {
          const { data, error } = await supabase.storage.from(bucket).download(e.path);
          if (error) throw error;
          e.dataBase64 = await toBase64(data);
          total += data.size ?? 0;
        } catch (err) {
          e.error = err?.message ?? String(err);
        }
      }
      out[bucket] = entries;
    } catch (e) {
      out[bucket] = { error: e?.message ?? String(e) };
    }
  }
  return out;
}

async function buildExport(state, session) {
  const courses = Object.values(state.courses || {});
  const userId = session?.user?.id;
  const server = userId ? await serverOnlyData(userId) : null;
  const files = userId ? await serverFiles(userId) : null;
  // limecore#88: the device's own copy of every list, synced or not yet.
  let counters = null;
  try { counters = JSON.parse(localStorage.getItem('sd-counters') || 'null'); } catch { counters = null; }
  return {
    schemaVersion: EXPORT_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    application: 'StudyDesk',
    account: session
      ? {
          email: session.user?.email ?? null,
          userId: session.user?.id ?? null,
          signInProvider: session.user?.app_metadata?.provider ?? null,
          createdAt: session.user?.created_at ?? null,
        }
      : { mode: 'guest', note: 'No account — this data has never left the device.' },
    counts: {
      courses: courses.length,
      grades: (state.grades || []).length,
      studySessions: (state.studySessions || []).length,
      assignments: (state.assignments || []).length,
      exams: (state.exams || []).length,
    },
    courses,
    grades: state.grades || [],
    studySessions: state.studySessions || [],
    assignments: state.assignments || [],
    exams: state.exams || [],
    // limecore#88: everything else StudyDesk keeps on the device.
    actions: state.actions || [],
    notes: state.notes || [],
    noteAttachments: state.noteAttachments || [],
    attachments: state.attachments || [],
    academicTerms: state.academicTerms || [],
    timetableEntries: state.timetableEntries || [],
    attendance: state.attendance || [],
    plannedSessions: state.plannedSessions || [],
    commitments: state.commitments || [],
    counters,
    ...(server ? { server } : {}),
    ...(files ? { files } : {}),
    settings: {
      gradeMode: state.gradeMode ?? null,
      customScale: state.customScale ?? null,
      language: (() => {
        try { return localStorage.getItem('limecore_lang'); } catch { return null; }
      })(),
    },
  };
}

const SaveFile = registerPlugin('SaveFile');

/** Save the export as a .json file. Returns the filename once it is written,
 *  or null when the user cancelled the save picker; throws on failure.
 *
 *  v1.21.1 (limecore#103): in the Android WebView an <a download> writes
 *  nothing, yet the app said "Saved". On native the file now goes through the
 *  SaveFile plugin (the system "create document" picker); web and desktop keep
 *  the anchor. The crash screen and StorageAlert use this same path. */
export async function downloadExport(state, session) {
  const payload = await buildExport(state, session);
  const json = JSON.stringify(payload, null, 2);
  const name = `studydesk-export-${new Date().toISOString().slice(0, 10)}.json`;
  if (Capacitor.isNativePlatform()) {
    const { saved } = await SaveFile.save({ name, data: json, mimeType: 'application/json' });
    return saved ? name : null;
  }
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on the next tick — revoking synchronously can cancel the download
  // on some browsers before it has started.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return name;
}

/**
 * Erase the account and everything attached to it.
 *
 * Deleting the auth user is sufficient: every user-owned table declares
 * `REFERENCES auth.users(id) ON DELETE CASCADE`, so profiles, subjects, grades
 * and study_sessions all go with it. Verified against the live schema rather
 * than assumed — a soft delete would not satisfy Article 17.
 *
 * The deletion itself runs in the `delete-account` Edge Function because
 * `auth.admin.deleteUser` needs the service-role key, which must never ship in
 * a client bundle. The function authenticates the caller by their own JWT and
 * deletes only that user, so it cannot be aimed at anyone else.
 *
 * Local data is cleared once the server has deleted the account. A user who
 * asked to be deleted should not find their coursework on the device afterwards.
 *
 * v1.21.1 (limecore#102): "guest or account" is decided from the device, not
 * from getSession() alone. An expired session that cannot be refreshed used to
 * look exactly like a guest: the device was wiped, the account stayed, and the
 * user was told it was done. Now:
 *   - an account is recorded (owner record or a stored session) but there is
 *     no usable session, or getSession errored: refuse, wipe nothing
 *     ({ deleted: 'none' });
 *   - a real guest: wipe the device ({ deleted: 'local' });
 *   - account deleted: also drop the stored session ({ deleted: 'account' }).
 */
// limecore#124: offline with an expired session, getSession() keeps retrying
// the refresh and never returns, so the button sat on "Deleting..." for good.
export const SESSION_CHECK_MS = 8000;

export async function deleteAccount({ clearLocal }) {
  let session = null;
  let failed = false;
  // Offline: no session check at all (it cannot settle), so an account is
  // refused at once below; a real guest can still erase the device.
  if (globalThis.navigator?.onLine !== false) {
    let timer;
    try {
      const { data, error } = await Promise.race([
        supabase.auth.getSession(),
        new Promise((_, reject) => { timer = setTimeout(reject, SESSION_CHECK_MS); }),
      ]);
      session = data?.session ?? null;
      failed = !!error;
    } catch {
      // A throw or the timeout: refused below, nothing wiped.
      failed = true;
    } finally {
      clearTimeout(timer);
    }
  }
  if (!session || failed) {
    if (failed || readOwner() || (await readStoredSession())) return { deleted: 'none' };
    // A real guest: there is no server-side account. Clearing the device is
    // the whole of the erasure.
    await clearLocal();
    return { deleted: 'local' };
  }

  // v1.12 Item 9 — remove the avatar object BEFORE the account goes.
  //
  // `auth.admin.deleteUser` cascades DATABASE rows; it does not touch Storage.
  // An avatar left behind would be an orphaned object nobody can ever reach or
  // delete, since the RLS policy keys on a `auth.uid()` that no longer exists —
  // exactly the second orphan class the plan says not to create alongside
  // AUDIT-NCC-V15-1. Done here rather than in the Edge Function because the
  // user is still authenticated at this moment, so their own delete policy
  // applies and no deploy is required.
  //
  // Deliberately not fatal: erasure of the account must not be blocked by a
  // storage hiccup. A failure here leaves one 256 KB object, which is a
  // housekeeping problem; a failure to delete the account is a GDPR one.
  // v1.18.1 (limecore#61): the Edge Function now also removes the user's
  // files from every bucket (attachments included) before deleting the
  // account, on the same terms. This stays for a function not yet redeployed.
  try {
    await removeForUser(AVATAR_BUCKET, AVATAR_FILE);
  } catch (e) {
    console.warn('[delete-account] avatar removal failed, continuing:', e?.message || e);
  }

  const { error } = await supabase.functions.invoke('delete-account', {
    body: { confirm: true },
  });
  if (error) throw new Error(error.message || 'Account deletion failed');

  try {
    await supabase.auth.signOut({ scope: 'local' });
  } catch {
    // The user row is already gone, so the sign-out call may fail. Not fatal.
  }
  // signOut keeps the stored session when the call fails on the network; on
  // Android it lives in Preferences and would survive the wipe.
  await clearStoredSession();
  await clearLocal();
  return { deleted: 'account' };
}
