// v1.22 (limecore#122, Design H) — AI on the user's own key.
//
// The request goes from this device straight to Google's Gemini API, on a key
// the user supplies, and never through Limecore's servers (the old
// `ai-generate` function, which held the owner's key, is retired). No key, no
// request. One provider for now (Gemini); `generate` is the single entry point
// so another can be added behind it. Guests can use it: no account is needed.
//
// Google answers browser requests (CORS) with the key in the `x-goog-api-key`
// header (checked 2026-11-16 on limecore#122), so the web, desktop and Android
// editions all call it directly. The key never goes in the URL: fetch errors
// and logs carry URLs.
import { getAiKey, getAiModel } from './aiKey.js';

export const AI_HOST = 'https://generativelanguage.googleapis.com';

/** Why a request failed. Each has its own message: with the user's own key,
 *  the user is the one who can fix it.
 *  'no-key' | 'invalid-key' | 'quota' | 'model' | 'network' | 'other' */
export const AI_ERRORS = ['no-key', 'invalid-key', 'quota', 'model', 'network', 'other'];

/** Maps Google's answer to one of AI_ERRORS. Exported for the tests. */
export function classifyAiError(status, message = '') {
  if (status === 401 || status === 403 || /api key not valid|API_KEY_INVALID|permission/i.test(message)) return 'invalid-key';
  if (status === 429 || /quota|RESOURCE_EXHAUSTED/i.test(message)) return 'quota';
  if (status === 404 || /not found|is not supported/i.test(message)) return 'model';
  return 'other';
}

/** The generation config for `model`, as `ai-generate` built it
 *  (limecore#60): a 2.x model takes a temperature and `thinkingBudget: 0`;
 *  3.x replaced thinkingBudget with `thinkingLevel` (sending both is a 400)
 *  and ignores temperature. Thinking counts against maxOutputTokens, so it is
 *  kept at the minimum for these short extraction tasks. */
export function generationConfigFor(model, { maxTokens, temperature, json }) {
  const legacy = /^gemini-2\./.test(model);
  const config = legacy
    ? { temperature, maxOutputTokens: maxTokens, thinkingConfig: { thinkingBudget: 0 } }
    : { maxOutputTokens: maxTokens, thinkingConfig: { thinkingLevel: 'MINIMAL' } };
  if (json) config.responseMimeType = 'application/json';
  return config;
}

/**
 * One request. Resolves `{ ok: true, text }` or `{ ok: false, error }`, never
 * throws. `key` and `model` override the saved ones (the Settings test runs
 * on what is typed there); `fetchImpl` is for the tests.
 */
export async function generate({ prompt, maxTokens = 256, temperature = 0.6, json = false, key, model, fetchImpl } = {}) {
  const k = (key ?? (await getAiKey()))?.trim();
  if (!k) return { ok: false, error: 'no-key' };
  const m = model?.trim() || (await getAiModel());
  const doFetch = fetchImpl ?? fetch;
  let res;
  try {
    res = await doFetch(`${AI_HOST}/v1beta/models/${encodeURIComponent(m)}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': k },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: generationConfigFor(m, { maxTokens, temperature, json }),
      }),
    });
  } catch {
    return { ok: false, error: 'network' };
  }
  let body = {};
  try { body = await res.json(); } catch { /* not JSON */ }
  if (!res.ok) return { ok: false, error: classifyAiError(res.status, body?.error?.message ?? '') };
  const text = (body?.candidates?.[0]?.content?.parts ?? []).map((p) => p?.text ?? '').join('').trim();
  return text ? { ok: true, text } : { ok: false, error: 'other' };
}
