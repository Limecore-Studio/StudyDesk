// v1.21.1 (limecore#87) — the app-open records and the F-Droid update check
// are opt-in.
//
// Both were on without asking. Now each is off until the user says yes, and
// the answer belongs to whoever owns this device's data (the account, or the
// guest), not to the device: another account signing in here is asked again.
// Design A later moves this record into the owner's own storage.
//
// { opens?: boolean, update?: boolean }. Missing means "not asked yet", which
// is also what every install from before this version is: both stop until the
// user answers. The old default is deliberately not carried forward.
//
// Only the read is here, because it runs at startup (app opens, the outbox,
// App's "is a question pending"). The write is in consentWrite.js, which only
// on-demand screens import.
import { readOwner } from './deviceOwner.js';

export const consentKey = () => 'studydesk.consent.' + (readOwner() || 'guest');

export function readConsent() {
  try { return JSON.parse(localStorage.getItem(consentKey())) || {}; } catch { return {}; }
}
