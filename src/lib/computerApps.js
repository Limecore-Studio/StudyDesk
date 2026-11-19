// StudyDesk#260 — telling people StudyDesk also runs on a computer.
//
// Feedback asked for "a way to sync on PC", which already exists: the web app
// and the Windows app sign in to the same account and sync. Two places say so:
// a section in Settings, always there, and a note on Next Up, shown once per
// account on the phone after its first week with data in it. Loaded with the
// note and with Settings, never at startup.

export const WEB_APP_URL = 'https://studydesk.limecore.dev';
export const DESKTOP_DOWNLOAD_URL = 'https://github.com/Limecore-Studio/StudyDesk/releases/latest';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** The note's per-account "seen" flag. Keyed by user id, so another account on
 *  the same phone still gets its own note once. */
const seenKey = (userId) => `sd-computer-note:${userId}`;

/** Whether the Next Up note should show for this account now: an account at
 *  least a week old that has something in it, and has not seen the note. */
export function shouldShowComputerNote(user, { hasData, now = Date.now() } = {}) {
  if (!user?.id || !hasData) return false;
  const created = new Date(user.created_at || 0).getTime();
  if (!Number.isFinite(created) || created <= 0 || now - created < WEEK_MS) return false;
  try {
    return localStorage.getItem(seenKey(user.id)) !== '1';
  } catch {
    return false;
  }
}

export function markComputerNoteSeen(userId) {
  if (!userId) return;
  try { localStorage.setItem(seenKey(userId), '1'); } catch { /* best effort */ }
}
