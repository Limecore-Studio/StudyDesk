// The live-sync channel's state, for the sync panel. Kept apart from
// liveSync.js so the panel can read it without loading the engine, which is
// fetched only once a user is signed in (v1.20, StudyDesk#201).

// What the channel is actually doing, for the sync panel (limecore#24). It
// said "Realtime active" for every signed-in user through two months of a
// dead channel. 'off' (not started) | 'connecting' | 'live' | 'down'.
let realtimeState = 'off';
const realtimeListeners = new Set();
export function setRealtimeState(next) {
  if (next === realtimeState) return;
  realtimeState = next;
  for (const l of realtimeListeners) l();
}
export function subscribeRealtimeState(listener) {
  realtimeListeners.add(listener);
  return () => realtimeListeners.delete(listener);
}
export function getRealtimeState() {
  return realtimeState;
}
