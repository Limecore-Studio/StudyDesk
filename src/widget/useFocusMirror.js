// v1.20 (#189, #202) — the shared focus timer, for the desktop glance widget.
//
// The widget has no TimerView behind it, and may be open with the main window
// closed, so it reads the `focus_timers` row itself, the way useGlance reads
// the plan. Read-only, like the rest of the widget: pausing, resuming and
// ending a block happen in the main window (a click on the timer opens it
// there), which is also where stopping offers to save the block.
//
// Realtime here, where useGlance polls: the plan changes over hours, the timer
// over seconds. The widget joins the user's private hint topic and re-reads
// the row when a device announces a `focus_timers` change, which costs one
// more socket while the widget is open. It also re-reads on focus and every
// 30 s, in case a hint was missed.

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { serverNow } from '../lib/serverClock.js';
import { HINT_EVENT, hintTopic } from '../lib/liveHints.js';
import { FOCUS_TIMERS_TABLE, isActive, remainingSecs } from '../lib/focusTimer.js';

const POLL_MS = 30_000;

/**
 * @returns {{ timer: object|null, secs: number }}
 *   `timer` is the shared state while a block is on the clock, else null.
 */
export function useFocusMirror() {
  const [userId, setUserId] = useState(null);
  // The row as last read, tagged with whose it is, so a sign-out or another
  // account never shows the previous account's timer.
  const [read_, setRead] = useState({ userId: null, state: null });
  // Bumped once a second while counting, to re-render; the time itself is
  // read at render, so the first frame after a start is already right.
  const [, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    supabase.auth.getSession().then(({ data }) => {
      if (!cancelled) setUserId(data?.session?.user?.id ?? null);
    }).catch(() => {});
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setUserId(s?.user?.id ?? null));
    return () => { cancelled = true; sub?.subscription?.unsubscribe(); };
  }, []);

  const read = useCallback(async () => {
    if (!userId) return;
    const { data, error } = await supabase
      .from(FOCUS_TIMERS_TABLE)
      .select('state')
      .eq('user_id', userId)
      .maybeSingle();
    // Keep what is on screen through a dropped connection.
    if (!error) setRead({ userId, state: data?.state ?? null });
  }, [userId]);

  useEffect(() => {
    if (!userId) return undefined;
    // The first read on the next tick, like the poll's later ones.
    const first = setTimeout(read, 0);
    const c = supabase.channel(hintTopic(userId), { config: { private: true, broadcast: { self: false } } });
    c.on('broadcast', { event: HINT_EVENT }, (msg) => {
      if (msg?.payload?.table === FOCUS_TIMERS_TABLE) void read();
    });
    c.subscribe();
    const poll = setInterval(read, POLL_MS);
    const onFocus = () => { void read(); };
    window.addEventListener('focus', onFocus);
    return () => {
      clearTimeout(first);
      clearInterval(poll);
      window.removeEventListener('focus', onFocus);
      void supabase.removeChannel(c);
    };
  }, [userId, read]);

  const state = userId && read_.userId === userId ? read_.state : null;
  const timer = isActive(state) ? state : null;

  // The display ticks only while something is counting.
  useEffect(() => {
    if (!timer?.running) return undefined;
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [timer?.running]);

  return { timer, secs: timer ? remainingSecs(timer, serverNow()) : 0 };
}
