// v1.20 (StudyDesk#156) — progress counters on the server. Loaded on demand:
// by the counters panel, by the outbox when it drains a counter write, and by
// a live-sync hint naming a counters table. Nothing here is in the startup
// bundle.
//
// The writes are the outbox's handlers (outbox.js KIND_DISPATCH): each
// carries the edit's own stamp (editStamp.js), and the server keeps the newer
// write (set_updated_at). A delete is a tombstone.

import { supabase } from './supabase.js';
import { pushStamp, recordPull } from './editStamp.js';
import { isPageStale } from './deviceOwner.js';
import { selectAll } from './selectAll.js';
import { counterFromRow, dayFromRow } from './counters.js';

async function currentUserId() {
  // Same rule as sync.js: a tab whose data another tab replaced must not write.
  if (isPageStale()) throw new Error('another tab replaced the local data; this tab is reloading');
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');
  return user.id;
}

export async function upsertCounter({ id, name, unit, period, target, subjectId, position, updatedAt }) {
  const userId = await currentUserId();
  const { error } = await supabase.from('progress_counters').upsert({
    id,
    user_id: userId,
    name,
    unit,
    period,
    target: target ?? null,
    subject_id: subjectId || null,
    position: position ?? 0,
    updated_at: pushStamp(updatedAt),
  });
  if (error) throw error;
  return id;
}

export async function deleteCounter({ id, updatedAt }) {
  await currentUserId();
  const stamp = pushStamp(updatedAt);
  const { error } = await supabase
    .from('progress_counters')
    .update({ deleted_at: stamp, updated_at: stamp })
    .eq('id', id);
  if (error) throw error;
  return id;
}

export async function upsertCounterDay({ id, counterId, day, value, updatedAt }) {
  const userId = await currentUserId();
  const { error } = await supabase.from('progress_counter_days').upsert({
    id,
    user_id: userId,
    counter_id: counterId,
    day,
    value,
    updated_at: pushStamp(updatedAt),
  });
  if (error) throw error;
  return id;
}

/** Every counter (tombstones included) and every counted day of the user.
 *  Until the table exists (the migration is the owner's to apply), there is
 *  nothing to pull and the counters stay on this device. */
export async function pullCounters() {
  const [c, d] = await Promise.all([
    selectAll(supabase, 'progress_counters'),
    selectAll(supabase, 'progress_counter_days'),
  ]);
  const missing = (res) => res.error && (res.error.code === '42P01' || res.error.code === 'PGRST205' || /does not exist/i.test(res.error.message || ''));
  if (missing(c) || missing(d)) return null;
  if (c.error) throw c.error;
  if (d.error) throw d.error;
  recordPull({ counters: c.data || [], counterDays: d.data || [] });
  return { counters: (c.data || []).map(counterFromRow), days: (d.data || []).map(dayFromRow) };
}
