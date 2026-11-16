// v1.4 — cross-app SSO consumer (StudyDesk side).
//
// Mirror of LimeLog's suiteSso.ts. Queries NCC's signature-protected
// SessionContentProvider and applies the returned bundle to StudyDesk's
// Supabase client. See LimeLog's wrapper for the full design rationale.

import { Capacitor, registerPlugin } from '@capacitor/core';
import { supabase } from './supabase.js';
import { tokenUserId } from './deviceOwner.js';

const SuiteSso = registerPlugin('SuiteSso');

// How long any single network step in the SSO path may take before we stop
// waiting and fall through to the next option.
//
// v1.13 review, item G. `adoptSession` awaited `functions.invoke` and
// `setSession` with no timeout, no AbortController and no Promise.race, from a
// session-init effect that renders a loading label until it settles. A request
// that never settles — not one that fails, one that HANGS — therefore pinned
// the app on that label indefinitely. An OS-level TCP timeout on a
// half-connected network is minutes, not seconds, and a captive portal or a
// device with partial connectivity (the test phone was Tailscale-only, with no
// general internet path) reproduces it exactly. So does a normal user on a
// hotel wifi that accepts the connection and then drops the traffic.
//
// Eight seconds is chosen to be longer than any plausible successful round
// trip on a slow mobile connection and far shorter than a TCP timeout. The
// cost of expiring too early is one degraded sign-in; the cost of not
// expiring at all is an app that never opens.
const SSO_STEP_TIMEOUT_MS = 8000;

/** Resolve to `{ timedOut: true }` rather than hanging forever.
 *
 *  Deliberately resolves rather than rejects: every caller here already
 *  branches on a result object, and a timeout is an expected outcome on a bad
 *  network, not an exceptional one. The timer is always cleared, so a slow
 *  call that eventually settles does not leave a pending handle behind. */
function withTimeout(promise, ms = SSO_STEP_TIMEOUT_MS) {
  let timer;
  const expiry = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ timedOut: true }), ms);
  });
  return Promise.race([
    Promise.resolve(promise).then(
      (value) => ({ value }),
      (error) => ({ error }),
    ),
    expiry,
  ]).finally(() => clearTimeout(timer));
}


// -- v1.10: inherit the IDENTITY, not the refresh token -------------------
// We hand NCC's access_token to the `suite-session` Edge Function, which
// verifies it and returns a one-time credential; redeeming it gives this app a
// session with its own independent rotation chain, so the apps cannot revoke
// one another.
//
// v1.21.1 (limecore#101): the old fallback is gone. Every failure here used to
// end in setSession() with NCC's refresh token, which rotated NCC's token and
// got the whole family revoked on NCC's next start - the daily sign-out loop.
// No path hands NCC's refresh token to this client any more. A failure is just
// a failure: the user signs in normally, or opens Nexus once and comes back.
async function adoptSession(bundle) {
  const failed = { ok: false, reason: 'Nexus sign-in failed. Sign in normally.' };
  try {
    const invoked = await withTimeout(supabase.functions.invoke('suite-session', {
      body: { app: 'studydesk' },
      headers: { Authorization: 'Bearer ' + bundle.access_token },
    }));
    if (invoked.timedOut || invoked.error) return failed;
    const { data, error } = invoked.value || {};
    if (error || !data || !data.token_hash) return failed;
    // v1.11 - try each credential type rather than betting on one.
    // `suite-session` mints with `generateLink({ type: 'magiclink' })`, which
    // GoTrue files under `recovery_token`; which string `verifyOtp` wants for
    // that row has moved between GoTrue versions.
    for (const type of ['magiclink', 'email', 'recovery']) {
      const verified = await withTimeout(
        supabase.auth.verifyOtp({ token_hash: data.token_hash, type }),
      );
      // A hung verify is not worth retrying with another type.
      if (verified.timedOut) return failed;
      const { error: otpErr } = verified.error ? { error: verified.error } : (verified.value || {});
      if (!otpErr) return { ok: true, email: bundle.email };
      // A consumed one-time token cannot be retried with another type.
      if (!/not found|invalid|expired/i.test(otpErr.message || '')) break;
    }
  } catch (e) {
    console.warn('[sso] suite-session threw:', e.message);
  }
  return failed;
}

/** limecore#101: NCC republishes its token only while it runs, so a bundle
 *  whose access token has expired cannot be exchanged. Seconds, as Supabase
 *  stores it; a missing value counts as stale. */
export function bundleIsStale(bundle, nowMs = Date.now()) {
  const exp = Number(bundle && bundle.expires_at) || 0;
  return exp * 1000 <= nowMs;
}

/** Open NCC so it republishes a fresh session (AuthGate's "Open Nexus"). */
export async function openNexus() {
  try { await SuiteSso.openNexus(); return true; } catch { return false; }
}

/** Pull NCC's active session and apply it to StudyDesk's Supabase client.
 *  No-op on web. Returns { ok, reason?, email? }.
 *
 *  v1.18.1 (limecore#59 §1): `onlyUserId`, when given, refuses a bundle for a
 *  different account (`reason: 'other-account'`). The automatic sign-in at
 *  startup passes this device's data owner, so another account signed in to
 *  NCC is never adopted silently; the user can still pick it on AuthGate.
 *
 *  v1.21.1 (limecore#101): an expired bundle makes no network call and
 *  returns `reason: 'nexus-stale'`. */
export async function inheritFromNexus({ onlyUserId } = {}) {
  if (!Capacitor.isNativePlatform()) {
    return { ok: false, reason: 'Cross-app sign-in is only available on Android.' };
  }
  let queryResult;
  try {
    queryResult = await SuiteSso.getNexusSession();
  } catch (e) {
    return { ok: false, reason: 'SSO plugin unavailable: ' + e.message };
  }
  if (!queryResult.available) {
    return { ok: false, reason: queryResult.reason || 'No Nexus session available.' };
  }
  let bundle;
  try {
    bundle = JSON.parse(queryResult.bundleJson || '{}');
  } catch {
    return { ok: false, reason: 'Nexus returned a malformed session bundle.' };
  }
  if (!bundle.access_token) {
    return { ok: false, reason: 'Nexus session missing required tokens.' };
  }
  if (onlyUserId && tokenUserId(bundle.access_token) !== onlyUserId) {
    return { ok: false, reason: 'other-account' };
  }
  if (bundleIsStale(bundle)) return { ok: false, reason: 'nexus-stale' };
  return adoptSession(bundle);
}
