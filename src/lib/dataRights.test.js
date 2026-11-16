import { describe, it, expect, vi, beforeEach } from 'vitest';

// v1.21.1 (limecore#102) — delete account never pretends. An expired session
// that cannot be refreshed used to look exactly like a guest: the device was
// wiped, the account stayed, and the user was told it was done.

const h = vi.hoisted(() => ({
  getSession: vi.fn(),
  signOut: vi.fn(async () => ({ error: null })),
  invoke: vi.fn(async () => ({ data: { ok: true }, error: null })),
  stored: null,
  cleared: vi.fn(async () => {}),
  owner: null,
  save: vi.fn(async () => ({ saved: true })),
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true },
  registerPlugin: () => ({ save: h.save }),
}));

vi.mock('./supabase.js', () => ({
  supabase: {
    auth: { getSession: h.getSession, signOut: h.signOut },
    functions: { invoke: h.invoke },
  },
  readStoredSession: async () => h.stored,
  clearStoredSession: h.cleared,
}));
vi.mock('./deviceOwner.js', () => ({ readOwner: () => h.owner }));
vi.mock('./userStorage.js', () => ({ removeForUser: async () => {} }));
vi.mock('./selectAll.js', () => ({ selectAll: async () => ({ data: [], error: null }) }));
vi.mock('./profile.js', () => ({ AVATAR_BUCKET: 'avatars', AVATAR_FILE: 'avatar.webp' }));

const { deleteAccount, downloadExport } = await import('./dataRights.js');

const SESSION = { user: { id: 'user-a' }, access_token: 'at', refresh_token: 'rt' };

beforeEach(() => {
  h.getSession.mockReset();
  h.signOut.mockClear();
  h.invoke.mockClear();
  h.cleared.mockClear();
  h.stored = null;
  h.owner = null;
});

describe('deleteAccount (limecore#102)', () => {
  it('a refresh failure with an owner recorded wipes nothing and calls no function', async () => {
    h.owner = 'user-a';
    h.getSession.mockResolvedValue({ data: { session: null }, error: { message: 'Invalid Refresh Token' } });
    const clearLocal = vi.fn();
    expect(await deleteAccount({ clearLocal })).toEqual({ deleted: 'none' });
    expect(clearLocal).not.toHaveBeenCalled();
    expect(h.invoke).not.toHaveBeenCalled();
    expect(h.cleared).not.toHaveBeenCalled();
  });

  it('no session but a stored one (no owner record) is still an account: refused', async () => {
    h.stored = SESSION;
    h.getSession.mockResolvedValue({ data: { session: null }, error: null });
    const clearLocal = vi.fn();
    expect(await deleteAccount({ clearLocal })).toEqual({ deleted: 'none' });
    expect(clearLocal).not.toHaveBeenCalled();
    expect(h.invoke).not.toHaveBeenCalled();
  });

  it('getSession throwing or erroring is refused, even with no owner record', async () => {
    h.getSession.mockRejectedValue(new Error('storage unavailable'));
    const clearLocal = vi.fn();
    expect(await deleteAccount({ clearLocal })).toEqual({ deleted: 'none' });
    expect(clearLocal).not.toHaveBeenCalled();
  });

  it('a real guest wipes the device', async () => {
    h.getSession.mockResolvedValue({ data: { session: null }, error: null });
    const clearLocal = vi.fn();
    expect(await deleteAccount({ clearLocal })).toEqual({ deleted: 'local' });
    expect(clearLocal).toHaveBeenCalledTimes(1);
    expect(h.invoke).not.toHaveBeenCalled();
  });

  it('a real delete clears the stored session and signs out locally', async () => {
    h.owner = 'user-a';
    h.getSession.mockResolvedValue({ data: { session: SESSION }, error: null });
    const clearLocal = vi.fn();
    expect(await deleteAccount({ clearLocal })).toEqual({ deleted: 'account' });
    expect(h.invoke).toHaveBeenCalledWith('delete-account', { body: { confirm: true } });
    expect(h.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(h.cleared).toHaveBeenCalledTimes(1);
    expect(clearLocal).toHaveBeenCalledTimes(1);
  });

  it('a failed delete throws and wipes nothing', async () => {
    h.getSession.mockResolvedValue({ data: { session: SESSION }, error: null });
    h.invoke.mockResolvedValueOnce({ data: null, error: { message: 'unauthorized' } });
    const clearLocal = vi.fn();
    await expect(deleteAccount({ clearLocal })).rejects.toThrow('unauthorized');
    expect(clearLocal).not.toHaveBeenCalled();
    expect(h.cleared).not.toHaveBeenCalled();
  });
});

// v1.21.1 (limecore#103) — the export goes through the native save picker,
// and never carries a credential. The export is a hand list today; this test
// makes "no token, session or PIN" a guarantee rather than an observation.
describe('downloadExport (limecore#103)', () => {
  const ACCESS = 'eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiJ1c2VyLWEifQ.c2lnbmF0dXJl';
  const REFRESH = 'r3fr3sh-t0k3n-v4lu3';
  const SECRET_KEY = /token|secret|password|passw|passcode|jwt|apikey|api_key|^pin$|pin_?code|^session$|auth_?session|provider_?token/i;
  const JWT = /eyJ[\w-]{5,}\.[\w-]{5,}\.[\w-]+/;

  function walk(value, path, out) {
    if (Array.isArray(value)) value.forEach((v, i) => walk(v, `${path}[${i}]`, out));
    else if (value && typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) {
        if (SECRET_KEY.test(k)) out.push(`${path}.${k} (key)`);
        walk(v, `${path}.${k}`, out);
      }
    } else if (typeof value === 'string') {
      if (JWT.test(value) || value.includes(ACCESS) || value.includes(REFRESH)) out.push(`${path} (value)`);
    }
  }

  beforeEach(() => {
    h.save.mockClear();
    const store = new Map(Object.entries({
      limecore_lang: 'fi',
      'studydesk-supabase-session': JSON.stringify({ access_token: ACCESS, refresh_token: REFRESH }),
      'sb-nexus-sso-bundle': JSON.stringify({ access_token: ACCESS, refresh_token: REFRESH }),
    }));
    vi.stubGlobal('localStorage', { getItem: (k) => (store.has(k) ? store.get(k) : null) });
  });

  it('saves through the native picker and reports the name only once written', async () => {
    expect(await downloadExport({}, null)).toMatch(/^studydesk-export-\d{4}-\d\d-\d\d\.json$/);
    expect(h.save).toHaveBeenCalledWith(expect.objectContaining({ mimeType: 'application/json' }));
    h.save.mockResolvedValueOnce({ saved: false });
    expect(await downloadExport({}, null)).toBeNull();
    h.save.mockRejectedValueOnce(new Error('Could not write the file.'));
    await expect(downloadExport({}, null)).rejects.toThrow('Could not write the file.');
  });

  it('no exported key or value looks like a token, session or PIN', async () => {
    const session = {
      access_token: ACCESS, refresh_token: REFRESH, provider_token: ACCESS, expires_at: 1,
      user: { id: 'user-a', email: 'a@x.test', created_at: '2026-01-01', app_metadata: { provider: 'google' } },
    };
    const state = {
      courses: { c1: { id: 'c1', name: 'Maths', color: '#000' } },
      grades: [{ id: 'g1', courseId: 'c1', grade: 6 }],
      studySessions: [{ id: 's1', courseId: 'c1', minutes: 25 }],
      assignments: [{ id: 'a1', title: 'Essay' }],
      exams: [{ id: 'e1', title: 'Final' }],
      gradeMode: 'ib', customScale: null,
    };
    await downloadExport(state, session);
    const exported = JSON.parse(h.save.mock.calls[0][0].data);
    expect(exported.account.userId).toBe('user-a');   // the account is there…
    const hits = [];
    walk(exported, '$', hits);
    expect(hits).toEqual([]);                          // …its credentials are not
  });
});
