import { describe, it, expect, vi, beforeEach } from 'vitest';

// v1.22 (limecore#122, Design H) — AI on the user's own key, straight to Google.

const h = vi.hoisted(() => ({ key: null, model: 'gemini-3.5-flash-lite' }));
vi.mock('./aiKey.js', () => ({ getAiKey: async () => h.key, getAiModel: async () => h.model }));

const { generate, classifyAiError, generationConfigFor, AI_HOST } = await import('./aiProvider.js');
const { analyseStudySession } = await import('./aiStudyDebrief.js');

const ok = (text) => async () => ({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }) });
const fail = (status, message) => async () => ({ ok: false, status, json: async () => ({ error: { message } }) });

beforeEach(() => {
  h.key = null;
  const store = new Map([['studydesk-ai-enabled', '1']]);
  vi.stubGlobal('localStorage', { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) });
});

describe('aiProvider', () => {
  it('makes no request without a key', async () => {
    const f = vi.fn();
    expect(await generate({ prompt: 'x', fetchImpl: f })).toEqual({ ok: false, error: 'no-key' });
    expect(f).not.toHaveBeenCalled();
  });

  it('sends the key in the header, never the URL, to Google only', async () => {
    h.key = 'AIza-test-key';
    const f = vi.fn(ok('hi'));
    expect(await generate({ prompt: 'x', json: true, fetchImpl: f })).toEqual({ ok: true, text: 'hi' });
    const [url, init] = f.mock.calls[0];
    expect(url.startsWith(`${AI_HOST}/v1beta/models/gemini-3.5-flash-lite:generateContent`)).toBe(true);
    expect(url).not.toContain('AIza-test-key');
    expect(init.headers['x-goog-api-key']).toBe('AIza-test-key');
    expect(JSON.parse(init.body).generationConfig.responseMimeType).toBe('application/json');
  });

  it('2.x and 3.x models get their own thinking config (limecore#60)', () => {
    expect(generationConfigFor('gemini-2.5-flash', { maxTokens: 9, temperature: 0.2 })).toEqual({ temperature: 0.2, maxOutputTokens: 9, thinkingConfig: { thinkingBudget: 0 } });
    expect(generationConfigFor('gemini-3.5-flash-lite', { maxTokens: 9, temperature: 0.2 })).toEqual({ maxOutputTokens: 9, thinkingConfig: { thinkingLevel: 'MINIMAL' } });
  });

  it('names each failure', async () => {
    h.key = 'k';
    expect(classifyAiError(400, 'API key not valid')).toBe('invalid-key');
    expect(classifyAiError(429, '')).toBe('quota');
    expect(classifyAiError(404, '')).toBe('model');
    expect(classifyAiError(500, '')).toBe('other');
    expect(await generate({ prompt: 'x', fetchImpl: async () => { throw new Error('offline'); } })).toEqual({ ok: false, error: 'network' });
    expect(await generate({ prompt: 'x', fetchImpl: fail(403, '') })).toEqual({ ok: false, error: 'invalid-key' });
  });
});

describe('analyseStudySession', () => {
  it('parses the debrief, and reports why it failed otherwise', async () => {
    h.key = 'k';
    const json = JSON.stringify({ subjectCovered: 'Limits', comprehension: 4, confusionFlags: ['epsilon'], sessionSummary: 'Limits.' });
    const r = await analyseStudySession('limits', { fetchImpl: ok(json) });
    expect(r.ok).toBe(true);
    expect(r.debrief.comprehension).toBe(4);
    expect(await analyseStudySession('limits', { fetchImpl: fail(429, '') })).toEqual({ ok: false, error: 'quota' });
    h.key = null;
    expect((await analyseStudySession('limits')).error).toBe('no-key');
  });

  it('sends nothing when switched off', async () => {
    h.key = 'k';
    localStorage.removeItem('studydesk-ai-enabled');
    const f = vi.fn();
    expect(await analyseStudySession('limits', { fetchImpl: f })).toEqual({ ok: false, error: 'off' });
    expect(f).not.toHaveBeenCalled();
  });
});
