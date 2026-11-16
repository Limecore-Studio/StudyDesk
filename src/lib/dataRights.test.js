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

const { deleteAccount } = await import('./dataRights.js');

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
