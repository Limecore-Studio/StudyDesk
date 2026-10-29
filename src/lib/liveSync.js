// Live sync: the Realtime channels and their lifecycle. Moved out of sync.js
// in v1.20 (StudyDesk#201) and loaded on demand once a user is signed in, so
// none of it counts against the startup bundle. The hint protocol is in
// liveHints.js; the pulls it triggers are still sync.js's.

import { supabase } from './supabase.js';
import {
  HINT_APP, HINT_EVENT, DEVICE_ID, isHintTable, hintTopic, tablesFromHint, backoffMs, createTableBatcher,
} from './liveHints.js';
import { setRealtimeState } from './realtimeState.js';

let channel = null;
let pullTimer = null;
const COALESCE_MS = 1500;
// v1.20 (StudyDesk#201): hints are socket to socket, with no replication hop
// to wait out, so their window is short. It only has to gather one push's
// burst of `changed` events into a single pull per table.
const HINT_COALESCE_MS = 300;

function schedulePull(pullAll) {
  if (pullTimer) return;
  pullTimer = setTimeout(() => {
    pullTimer = null;
    Promise.resolve(pullAll()).catch((e) => {
      console.error('[sync] pullAll failed:', e);
    });
  }, COALESCE_MS);
}

/**
 * Every table the channel binds. Each one must be in the `supabase_realtime`
 * publication: the server rejects the whole channel for one that is not
 * (limecore#24). `realtime.test.js` fails if a table here is missing from
 * supabase/migrations/20261006_realtime_publish.sql.
 */
export const REALTIME_TABLES = [
  // v1.7 — assignments/exams/study_actions joined the set (StudyDesk#6). All
  // six coalesce into the same debounced pull, so adding three tables costs one
  // extra subscription each, not three extra round-trips.
  // v1.10 — planned sessions, terms, timetable and attachments join the same
  // debounced pull. Ten subscriptions, still one round-trip per burst.
  'subjects', 'grades', 'study_sessions', 'assignments', 'exams', 'study_actions',
  'planned_sessions', 'academic_terms', 'timetable_entries', 'assignment_attachments',
  'commitments',
  // v1.13 review. These three shipped without a subscription, so notes and
  // attendance did not propagate live between devices at all — they appeared
  // only when some OTHER table's event happened to trigger a pull. Notes are
  // the most valuable thing in the app to see up to date on a second device.
  'notebook_entries', 'notebook_attachments', 'lesson_attendance',
];


// The running live session, or null. Holds the callbacks, the retry state of
// both channels and the listeners that revive them.
let live = null;
let hintChannel = null;

/** Hand Realtime the current access token before a rejoin. supabase-js
 *  forwards each refresh on its own, but a channel that died while the app
 *  slept may come back before that refresh has landed. */
async function refreshRealtimeAuth() {
  try {
    const { data } = await supabase.auth.getSession();
    const token = data?.session?.access_token;
    if (token) await supabase.realtime.setAuth(token);
  } catch { /* the join reports its own failure */ }
}

/**
 * Start live sync: the `postgres_changes` channel on every table in
 * REALTIME_TABLES, and the private hint channel `user:<userId>` (see
 * liveHints.js).
 *
 * `onChange()` is the full pull+merge. It runs for a `postgres_changes` event
 * when no `onTables` is given, and once after every REJOIN, to catch up on
 * whatever happened while the channel was down. The first join of a session
 * does not resync: the caller's launch pull is already covering that.
 *
 * `onTables(tables)` pulls and merges just the named tables. When given, a
 * hint and a `postgres_changes` event both use it, since each names its table.
 *
 * `userId` scopes every binding to the user's own rows (limecore#24). RLS is
 * still the boundary; the filter means the server stops evaluating everyone
 * else's writes against this subscription. No table in the set is shared.
 *
 * v1.20 (StudyDesk#201): a channel that drops is removed and joined again,
 * backing off from 1 s to 30 s, and at once when the app comes back to the
 * foreground or the network returns. Before this, the first error left live
 * sync down for the rest of the session — and Android drops the WebView's
 * socket every time the app is backgrounded.
 */
export function startRealtime(onChange, userId, { onTables } = {}) {
  if (live) return;
  const run = (fn, arg) => Promise.resolve(fn(arg)).catch((e) => console.error('[sync] live pull failed:', e));
  const session = {
    onChange,
    onTables,
    userId,
    joinedOnce: false,
    attempt: 0,
    retryTimer: null,
    hintAttempt: 0,
    hintTimer: null,
    hintLive: false,
    hintsRefused: false,
    hintBatch: createTableBatcher((tables) => run(onTables, tables), HINT_COALESCE_MS),
    changeBatch: createTableBatcher((tables) => run(onTables, tables), COALESCE_MS),
    detach: null,
  };
  live = session;
  joinChanges(session);
  if (userId && onTables) joinHints(session);

  const revive = () => reviveChannels(session);
  const onVisible = () => { if (document.visibilityState === 'visible') revive(); };
  if (typeof window !== 'undefined') {
    window.addEventListener('online', revive);
    document.addEventListener('visibilitychange', onVisible);
  }
  session.detach = () => {
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', revive);
      document.removeEventListener('visibilitychange', onVisible);
    }
  };
}

function joinChanges(session) {
  const c = supabase.channel('studydesk-sync');
  const filter = session.userId ? { filter: `user_id=eq.${session.userId}` } : {};
  for (const table of REALTIME_TABLES) {
    c.on(
      'postgres_changes',
      { event: '*', schema: 'public', table, ...filter },
      () => {
        if (session.onTables) session.changeBatch.add([table]);
        else schedulePull(session.onChange);
      },
    );
  }
  // Limekana/limecore#24 — this channel was silently dead from v1.7 to v1.17:
  // it bound tables that were not in the `supabase_realtime` publication, and
  // the Realtime server rejects the WHOLE channel for one missing table (a
  // `system` frame with status "error", sent after the join succeeded, never
  // retried). Log it, and show it in the sync panel.
  c.on('system', {}, (payload) => {
    if (payload?.status === 'error') {
      console.warn('[sync] realtime rejected the subscription:', payload.message || payload);
      dropChanges(session, c);
    }
  });
  channel = c;
  setRealtimeState('connecting');
  c.subscribe((status, err) => {
    // CLOSED after stopRealtime() or a drop is expected; `channel` has moved on.
    if (live !== session || channel !== c) return;
    if (status === 'SUBSCRIBED') {
      session.attempt = 0;
      setRealtimeState('live');
      if (session.joinedOnce) void Promise.resolve(session.onChange()).catch((e) => console.error('[sync] resync failed:', e));
      session.joinedOnce = true;
      return;
    }
    console.warn(`[sync] realtime channel ${status}`, err?.message || '');
    dropChanges(session, c);
  });
}

function dropChanges(session, c) {
  if (live !== session || channel !== c) return;
  channel = null;
  try { supabase.removeChannel(c); } catch { /* ignore */ }
  setRealtimeState('down');
  if (session.retryTimer) return;
  session.retryTimer = setTimeout(() => {
    session.retryTimer = null;
    void rejoinChanges(session);
  }, backoffMs(session.attempt++));
}

async function rejoinChanges(session) {
  await refreshRealtimeAuth();
  if (live !== session || channel) return;
  joinChanges(session);
}

function joinHints(session) {
  const h = supabase.channel(hintTopic(session.userId), {
    config: { private: true, broadcast: { self: false } },
  });
  h.on('broadcast', { event: HINT_EVENT }, (msg) => {
    const tables = tablesFromHint(msg?.payload);
    if (tables.length) session.hintBatch.add(tables);
  });
  hintChannel = h;
  h.subscribe((status, err) => {
    if (live !== session || hintChannel !== h) return;
    if (status === 'SUBSCRIBED') {
      session.hintAttempt = 0;
      session.hintLive = true;
      return;
    }
    session.hintLive = false;
    hintChannel = null;
    try { supabase.removeChannel(h); } catch { /* ignore */ }
    // Refused by Realtime Authorization: the server does not have the
    // `realtime.messages` policy yet (limecore#68), or this token is not the
    // topic's owner. Retrying cannot fix either. The postgres_changes channel
    // still carries every edit, a little later.
    if (/unauthori[sz]ed|permission/i.test(err?.message || '')) {
      session.hintsRefused = true;
      console.info('[sync] live hints unavailable:', err.message);
      return;
    }
    console.warn(`[sync] hint channel ${status}`, err?.message || '');
    if (session.hintTimer) return;
    session.hintTimer = setTimeout(() => {
      session.hintTimer = null;
      void rejoinHints(session);
    }, backoffMs(session.hintAttempt++));
  });
}

async function rejoinHints(session) {
  await refreshRealtimeAuth();
  if (live !== session || hintChannel || session.hintsRefused) return;
  joinHints(session);
}

const DEAD_STATES = new Set(['closed', 'errored']);
const isDead = (c) => !c || DEAD_STATES.has(c.state);

/** Foreground or back online: rejoin whatever is not live, now. */
function reviveChannels(session) {
  if (live !== session) return;
  if (isDead(channel)) {
    if (channel) dropChanges(session, channel);
    clearTimeout(session.retryTimer);
    session.retryTimer = null;
    session.attempt = 0;
    void rejoinChanges(session);
  }
  if (session.userId && session.onTables && !session.hintsRefused && isDead(hintChannel)) {
    if (hintChannel) {
      try { supabase.removeChannel(hintChannel); } catch { /* ignore */ }
      hintChannel = null;
      session.hintLive = false;
    }
    clearTimeout(session.hintTimer);
    session.hintTimer = null;
    session.hintAttempt = 0;
    void rejoinHints(session);
  }
}

/**
 * Tell this user's other devices which tables a push just wrote. Called once
 * per drained outbox pass, only with the tables of items that succeeded, so a
 * failed push announces nothing. A no-op until the hint channel is joined:
 * a send on an unjoined channel would fall back to a REST call per table.
 */
export function announceChanged(tables) {
  if (!live?.hintLive || !hintChannel) return;
  const at = Date.now();
  for (const table of new Set(tables)) {
    if (!isHintTable(table)) continue;
    void Promise.resolve(hintChannel.send({
      type: 'broadcast',
      event: HINT_EVENT,
      payload: { app: HINT_APP, table, at, device: DEVICE_ID },
    })).catch(() => { /* a lost hint costs only latency */ });
  }
}

export function stopRealtime() {
  const session = live;
  live = null;
  if (session) {
    session.detach?.();
    clearTimeout(session.retryTimer);
    clearTimeout(session.hintTimer);
    session.hintBatch.cancel();
    session.changeBatch.cancel();
  }
  if (channel) {
    const c = channel;
    channel = null;
    try { supabase.removeChannel(c); } catch { /* ignore */ }
  }
  if (hintChannel) {
    const h = hintChannel;
    hintChannel = null;
    try { supabase.removeChannel(h); } catch { /* ignore */ }
  }
  setRealtimeState('off');
  if (pullTimer) {
    clearTimeout(pullTimer);
    pullTimer = null;
  }
}
