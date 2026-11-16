// v1.21.1 (limecore#87) — record an answer to the opt-in question. Separate
// from consent.js so the startup chunk carries only the read. See consent.js.
import { consentKey, readConsent } from './consent.js';

export function setConsent(patch) {
  try { localStorage.setItem(consentKey(), JSON.stringify({ ...readConsent(), ...patch })); } catch { /* best-effort */ }
  globalThis.dispatchEvent?.(new Event('studydesk:consent'));
  // A yes counts today's open at once.
  if (patch.opens) void import('./appOpens.js').then((m) => m.recordAppOpen());
}
