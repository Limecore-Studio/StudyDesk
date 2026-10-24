// Turning feed events into assignment rows.
//
// ── The identity problem, and why the id is derived ──────────────────────
//
// An imported event has to become a real assignment: that is what "due dates
// arrive on their own" means, and it is why the feature removes typing rather
// than adding a second list to check. Real rows also mean the imported dates
// sync to a second device, appear in Next Up, and count towards everything
// else — none of which a parallel local-only list would do.
//
// That creates an identity question. The feed is re-fetched on a schedule, so
// the same event must land on the same row every time or a term duplicates
// itself every six hours. The obvious answer — a `feed_uid` column with a
// unique index — needs DDL and, worse, would put a fragment of a capability
// URL's contents into the shared database, which is exactly what the
// device-only decision exists to prevent.
//
// So the id is DERIVED from the event UID: a deterministic UUID, computed by
// hashing the feed's own identifier. Three things fall out of that, and the
// third is the one that made the decision:
//
//   1. Re-fetching is idempotent for free. Same UID, same uuid, and the
//      existing upsert path converges with no new column and no lookup table.
//   2. No feed data reaches the server. The uuid is a hash; the UID it came
//      from is not recoverable from it, and nothing about the subscription is
//      stored anywhere but the device.
//   3. TWO DEVICES AGREE. A device-side mapping table would work on the
//      device that built it and duplicate everything on any other. A student
//      who subscribes on their phone and then their laptop gets one set of
//      rows, because both devices compute the same id from the same event.
//
// The namespace prefix is what stops a feed UID colliding with anything else
// this app hashes, now or later.

import { normalizeDueTime } from './dueAt.js';

const NAMESPACE = 'studydesk.calendar-feed.v1:';

/**
 * A stable UUID for one feed event.
 *
 * SHA-256 through Web Crypto, laid out as a v5-shaped UUID (version 5 is
 * precisely "name-based, SHA-1"; this is the same idea with a stronger hash,
 * and the version nibble is set so the value is a well-formed UUID that
 * Postgres will accept in a `uuid` column).
 *
 * Async because `crypto.subtle` is. Every caller here is already async.
 */

export async function idForUid(feedUid) {
  const input = `${NAMESPACE}${String(feedUid ?? '')}`;

  const bytes = await sha256(input);
  const hex = Array.from(bytes.slice(0, 16), (b) => b.toString(16).padStart(2, '0')).join('');

  // Version 5, variant RFC 4122. Without these the string is still 32 hex
  // digits but is not a valid UUID, and Postgres accepts it while other
  // tooling does not — a difference that would surface much later and much
  // more confusingly than a rejected insert.
  const v = `${hex.slice(0, 12)}5${hex.slice(13, 16)}`;
  const variantNibble = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  const rest = `${variantNibble}${hex.slice(17, 32)}`;

  return `${v.slice(0, 8)}-${v.slice(8, 12)}-${v.slice(12, 16)}-${rest.slice(0, 4)}-${rest.slice(4, 16)}`;
}

async function sha256(text) {
  const enc = new TextEncoder().encode(text);
  if (globalThis.crypto?.subtle?.digest) {
    const buf = await globalThis.crypto.subtle.digest('SHA-256', enc);
    return new Uint8Array(buf);
  }
  // Fallback for an insecure context, where `crypto.subtle` is absent. Four
  // FNV-1a passes with different offset bases, giving 128 bits.
  //
  // Weaker than SHA-256 and deliberately not pretended otherwise — but the
  // property that matters here is collision resistance across ONE user's few
  // hundred calendar events, not resistance to an adversary, because nothing
  // about this value is a secret or a credential.
  const out = new Uint8Array(32);
  const bases = [0x811c9dc5, 0x01000193, 0xdeadbeef, 0xcafebabe];
  for (let k = 0; k < 4; k++) {
    let h = bases[k] >>> 0;
    for (let i = 0; i < enc.length; i++) {
      h ^= enc[i];
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    out[k * 4] = (h >>> 24) & 0xff;
    out[k * 4 + 1] = (h >>> 16) & 0xff;
    out[k * 4 + 2] = (h >>> 8) & 0xff;
    out[k * 4 + 3] = h & 0xff;
  }
  return out;
}

/**
 * Feed items → assignment payloads.
 *
 * @param {Array} items      from `toFeedItems`
 * @param {string|null|function} courseId  the course the user filed this feed
 *   under, or (v1.19, #187) a function from item to course id, so each item can
 *   go to its own source course's mapping (see courseForItem)
 *
 * The `type` is set to a fixed marker rather than guessed from the title.
 * The build plan is explicit about why:
 *
 *   > "ICS carries titles, dates and descriptions — not assignment type,
 *      points or submission status. This is 'due dates arrive on their own',
 *      not 'Canvas mirrored'; say so in the reply to #44 so nobody expects
 *      the latter."
 *
 * Inferring "Quiz" from a title containing the word quiz is exactly how a
 * feature starts being read as a full mirror, and it would be wrong often
 * enough to be worse than blank. `type` is free text (see assignTypes.js), so
 * a marker is a legal value the user can change.
 */
export async function toAssignments(items, courseId) {
  const out = [];
  for (const item of items || []) {
    if (!item.uid || !item.dueDate) continue;
    out.push({
      id: await idForUid(item.uid),
      courseId: (typeof courseId === 'function' ? courseId(item) : courseId) || null,
      title: item.title || item.uid,
      type: 'imported',
      dueDate: item.dueDate,
      // v1.14 Item 5 — this used to read "`assignments` has no time column",
      // and the feed's time was folded into the notes to avoid losing it. The
      // column exists now, so the time goes where it belongs and stops
      // crowding the first line of every imported note.
      //
      // An all-day event is not a deadline at 00:00 — it is a day with no time
      // on it, which is precisely what an empty due time means.
      dueTime: item.allDay ? '' : normalizeDueTime(item.time),
      // The location, description and source URL still go here: there is no
      // more honest place for them, and unlike the time they were never
      // pretending to be structured.
      notes: buildNotes(item),
      done: false,
    });
  }
  return out;
}

function buildNotes(item) {
  const parts = [];
  // The time is no longer prepended here — it is a real field now, and having
  // it in both places would leave a stale copy in the notes the first time
  // someone edits the deadline.
  if (item.location) parts.push(item.location);
  if (item.notes) parts.push(item.notes);
  const joined = parts.join('\n');
  // A description in a feed can be kilobytes of boilerplate. Truncated with
  // an ellipsis rather than dropped, so the user can see there was more.
  return joined.length > 2000 ? `${joined.slice(0, 1999)}…` : (joined || null);
}

// ── v1.19 (#187) — which course an imported item belongs to ──────────────
//
// A feed used to be filed under ONE course (or none), so a term of items from
// six courses all landed on one of them, or on none — and an assignment with
// no course never syncs (useCloudPushers skips it). The feed itself says which
// course each item is from. Checked against the generator's own source
// (instructure/canvas-lms app/models/calendar_event.rb, 2026-10-22), not
// assumed:
//
//   URL      …/calendar?include_contexts=course_<id>&month=…#assignment_<id>
//   SUMMARY  "<title> [<course_code>]" when the item belongs to a course
//
// The course id from the URL is the key (a course code can repeat across
// sections); the bracketed code is the label. A feed from elsewhere that only
// brackets a code still groups by it; one with neither is not mappable and
// stays on the feed's default course, exactly as before.

const CONTEXT_RE = /[?&]include_contexts=(course_\d+)/;
const CODE_RE = /\s\[([^[\]]+)\]\s*$/;

/** `{ key, label }` for the source course an item came from, or null. */
export function sourceCourse(item) {
  const code = CODE_RE.exec(item?.title || '')?.[1]?.trim() || null;
  const ctx = CONTEXT_RE.exec(item?.url || '')?.[1] || null;
  if (ctx) return { key: ctx, label: code || `#${ctx.slice('course_'.length)}` };
  if (code) return { key: `code:${code}`, label: code };
  return null;
}

/** The source courses in a feed's items, with how many items each has. */
export function sourceCourses(items) {
  const byKey = new Map();
  for (const it of items || []) {
    const s = sourceCourse(it);
    if (!s) continue;
    const cur = byKey.get(s.key);
    if (cur) cur.count++;
    else byKey.set(s.key, { ...s, count: 1 });
  }
  return [...byKey.values()].sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * The StudyDesk course an item goes to: its source course's mapping when
 * there is one (and the course still exists), else the feed's default.
 */
export function courseForItem(item, feed, courseExists = () => true) {
  const s = sourceCourse(item);
  const mapped = s ? feed?.courseMap?.[s.key] : null;
  if (mapped && courseExists(mapped)) return mapped;
  return feed?.courseId || null;
}
