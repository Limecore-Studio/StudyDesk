import { describe, it, expect, beforeEach, vi } from 'vitest';

// v1.20 (limecore#71) — the one-time error-report question.

function storage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => void m.set(k, String(v)),
    removeItem: (k) => void m.delete(k),
  };
}
vi.stubGlobal('localStorage', storage());
vi.mock('./supabase.js', () => ({ supabase: {} }));
const prompt = await import('./reportPrompt.js');
const reports = await import('./errorReports.js');
const policy = await import('./policyNotice.js');

/** One app launch: count it (if signed in) and ask whether to show the card. */
function launch() {
  prompt.resetReportPromptForTests();
  prompt.noteSignedInLaunch();
  return prompt.shouldAskForReports();
}

beforeEach(() => {
  vi.stubGlobal('localStorage', storage());
  prompt.resetReportPromptForTests();
  reports.resetErrorReportsForTests(); // re-reads the (now empty) switch
  policy.acknowledgePolicy(); // the policy note is not up, unless a test says so
});

describe('the error-report question', () => {
  it('waits for the second signed-in launch', () => {
    expect(launch()).toBe(false);
    expect(launch()).toBe(true);
  });

  it('counts a launch once, however often the app re-renders', () => {
    prompt.noteSignedInLaunch();
    prompt.noteSignedInLaunch();
    expect(prompt.shouldAskForReports()).toBe(false);
  });

  it('Yes turns reports on and never asks again', () => {
    launch(); launch();
    prompt.answerReportPrompt(true);
    expect(reports.errorReportsEnabled()).toBe(true);
    expect(launch()).toBe(false);
  });

  it('Not now leaves reports off and never asks again', () => {
    launch(); launch();
    prompt.answerReportPrompt(false);
    expect(reports.errorReportsEnabled()).toBe(false);
    expect(launch()).toBe(false);
    expect(launch()).toBe(false);
  });

  it('someone who already switched reports on in Settings is not asked', () => {
    reports.setErrorReportsEnabled(true);
    launch();
    expect(launch()).toBe(false);
  });

  it('waits while the "privacy policy updated" note is still up', () => {
    localStorage.removeItem('sd-policy-seen');
    launch();
    expect(launch()).toBe(false);
    policy.acknowledgePolicy();
    expect(launch()).toBe(true);
  });

  it('a guest never counts a launch, so is never asked', () => {
    // App.jsx only calls noteSignedInLaunch for a signed-in, non-guest user.
    prompt.resetReportPromptForTests();
    expect(prompt.shouldAskForReports()).toBe(false);
    prompt.resetReportPromptForTests();
    expect(prompt.shouldAskForReports()).toBe(false);
  });
});
