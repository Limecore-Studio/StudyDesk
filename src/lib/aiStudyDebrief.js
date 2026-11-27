// AI study-session debrief — v1.4; on the user's own key since v1.22.
//
// The user types a free-text note about what they studied and Gemini pulls
// out structured fields. v1.22 (limecore#122, Design H): the note goes from
// this device straight to Google on the user's own key (aiProvider.js), not
// through the shared `ai-generate` function on the owner's key. No account
// is needed, so guests can use it too.

import { generate } from './aiProvider.js';

function buildPrompt(userText) {
  return `Extract study session data from this note. Return ONLY valid JSON matching this exact schema — no prose, no markdown fences:
{
  "subjectCovered": <string: main topic studied, 1-5 words>,
  "comprehension": <number 1-5: 1=totally lost, 5=fully understood, or null>,
  "confusionFlags": <string[]: specific concepts mentioned as confusing; empty array if none>,
  "sessionSummary": <string: clean one-sentence summary of what was studied, max 80 chars>
}

Note: "${userText.slice(0, 400).replace(/"/g, "'")}"`;
}

/** Analyse a free-text study note. Resolves `{ ok: true, debrief }`, or
 *  `{ ok: false, error }` with one of aiProvider's AI_ERRORS (or 'off'), so the
 *  sheet can say what the user can fix. Never throws. */
export async function analyseStudySession(userText, { fetchImpl } = {}) {
  const text = (userText || '').trim();
  if (!text) return { ok: false, error: 'other' };
  // The opt-in gate. `canDebrief` already hides the UI, but this is the one
  // place the note actually leaves the device, so the check belongs here too —
  // a future caller cannot route around the user's choice by forgetting it.
  try {
    if (localStorage.getItem('studydesk-ai-enabled') !== '1') return { ok: false, error: 'off' };
  } catch {
    return { ok: false, error: 'off' };
  }
  const res = await generate({ prompt: buildPrompt(text), json: true, maxTokens: 200, temperature: 0.2, fetchImpl });
  if (!res.ok) return res;
  const debrief = parse(res.text);
  return debrief ? { ok: true, debrief } : { ok: false, error: 'other' };
}

function parse(raw) {
  let obj;
  try {
    obj = JSON.parse(raw);
  } catch {
    // Defensive: pull the first {...} block if the model wrapped it in fences.
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      obj = JSON.parse(m[0]);
    } catch {
      return null;
    }
  }
  if (!obj || typeof obj !== 'object') return null;

  const subjectCovered =
    typeof obj.subjectCovered === 'string' ? obj.subjectCovered.slice(0, 80) : '';
  const comprehension =
    typeof obj.comprehension === 'number' && obj.comprehension >= 1 && obj.comprehension <= 5
      ? Math.round(obj.comprehension)
      : null;
  const confusionFlags = Array.isArray(obj.confusionFlags)
    ? obj.confusionFlags
        .filter((x) => typeof x === 'string' && x.trim().length > 0)
        .map((x) => x.trim().slice(0, 60))
        .slice(0, 8)
    : [];
  const sessionSummary =
    typeof obj.sessionSummary === 'string' ? obj.sessionSummary.slice(0, 200) : '';

  return { subjectCovered, comprehension, confusionFlags, sessionSummary };
}
