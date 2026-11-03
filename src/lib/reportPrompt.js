// v1.20 (limecore#71) — the one-time question that offers error reports.
//
// Reports work end to end (four test reports reached client_errors on
// 2026-10-28) but the table had no rows, ever: the only way in was a switch
// deep in Settings. This asks once per device, on the second signed-in launch
// so it never stacks with sign-in or onboarding. The answer is kept next to
// the switch, which is device-local too, and Settings stays the way back.
//
// Never for guests: reports are accounts-only (errorReports.js sendReport).

import { errorReportsEnabled, setErrorReportsEnabled } from './errorReports.js';
import { policyNoticeDue } from './policyNotice.js';

const ASKED = 'sd-error-reports-asked'; // 'yes' | 'no' once answered
const LAUNCHES = 'sd-error-reports-launches'; // signed-in launches counted so far
let counted = false;

/** Count this launch as a signed-in one, once per page load. */
export function noteSignedInLaunch() {
  if (counted) return;
  counted = true;
  try {
    const n = Number(localStorage.getItem(LAUNCHES)) || 0;
    localStorage.setItem(LAUNCHES, String(n + 1));
  } catch { /* storage unavailable: never ask, which is the safe side */ }
}

/** Whether to show the card now. Someone who already turned reports on in
 *  Settings has answered, so that counts as asked. Not while the "privacy
 *  policy updated" note is still up: one one-time card at a time, and that
 *  one comes first. */
export function shouldAskForReports() {
  try {
    if (localStorage.getItem(ASKED)) return false;
    if (errorReportsEnabled()) {
      localStorage.setItem(ASKED, 'yes');
      return false;
    }
    if (policyNoticeDue()) return false;
    return (Number(localStorage.getItem(LAUNCHES)) || 0) >= 2;
  } catch {
    return false;
  }
}

/** Record the answer; Yes turns the existing switch on. */
export function answerReportPrompt(yes) {
  try { localStorage.setItem(ASKED, yes ? 'yes' : 'no'); } catch { /* asked again next launch */ }
  if (yes) setErrorReportsEnabled(true);
}

export function resetReportPromptForTests() {
  counted = false;
}
