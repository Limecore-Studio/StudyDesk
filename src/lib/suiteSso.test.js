import { describe, it, expect, vi, beforeEach } from 'vitest';

// v1.21.1 (limecore#101) — no path may hand NCC's refresh token to this
// client. setSession() with NCC's tokens rotated NCC's refresh token and got
// the whole family revoked on NCC's next start: the daily sign-out loop.

const h = vi.hoisted(() => ({
  bundle: null,
  invoke: vi.fn(),
  setSession: vi.fn(async () => ({ data: {}, error: null })),
  verifyOtp: vi.fn(async () => ({ data: {}, error: null })),
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true },
  registerPlugin: () => ({
    getNexusSession: async () => ({ available: true, bundleJson: JSON.stringify(h.bundle) }),
  }),
}));
vi.mock('./supabase.js', () => ({
  supabase: {
    functions: { invoke: h.invoke },
    auth: { setSession: h.setSession, verifyOtp: h.verifyOtp },
  },
}));
vi.mock('./deviceOwner.js', () => ({ tokenUserId: () => 'user-a' }));

const { inheritFromNexus, bundleIsStale, nexusErrorKey } = await import('./suiteSso.js');

const nowSec = () => Math.floor(Date.now() / 1000);
const bundle = (expiresAt) => ({
  access_token: 'at', refresh_token: 'rt', expires_at: expiresAt, email: 'a@x.test',
});

beforeEach(() => {
  h.invoke.mockReset();
  h.setSession.mockClear();
  h.verifyOtp.mockClear();
});

describe('inheritFromNexus (limecore#101)', () => {
  it('an expired bundle makes no network call and no setSession', async () => {
    h.bundle = bundle(nowSec() - 60);
    const result = await inheritFromNexus();
    expect(result).toEqual({ ok: false, reason: 'nexus-stale' });
    expect(h.invoke).not.toHaveBeenCalled();
    expect(h.verifyOtp).not.toHaveBeenCalled();
    expect(h.setSession).not.toHaveBeenCalled();
  });

  it('a bundle without expires_at counts as stale', async () => {
    h.bundle = bundle(undefined);
    expect((await inheritFromNexus()).reason).toBe('nexus-stale');
    expect(h.invoke).not.toHaveBeenCalled();
    expect(bundleIsStale({ expires_at: 0 })).toBe(true);
  });

  it('a 401 from suite-session never reaches setSession', async () => {
    h.bundle = bundle(nowSec() + 600);
    h.invoke.mockResolvedValue({ data: null, error: { message: 'Edge Function returned a non-2xx status code', context: { status: 401 } } });
    const result = await inheritFromNexus();
    expect(result.ok).toBe(false);
    expect(h.invoke).toHaveBeenCalledTimes(1);
    expect(h.setSession).not.toHaveBeenCalled();
  });

  it('a thrown or rejected one-time credential never reaches setSession', async () => {
    h.bundle = bundle(nowSec() + 600);
    h.invoke.mockRejectedValueOnce(new Error('offline'));
    expect((await inheritFromNexus()).ok).toBe(false);
    h.invoke.mockResolvedValueOnce({ data: { token_hash: 'th' }, error: null });
    h.verifyOtp.mockResolvedValue({ data: {}, error: { message: 'One-time token not found' } });
    expect((await inheritFromNexus()).ok).toBe(false);
    expect(h.verifyOtp).toHaveBeenCalledTimes(3);
    expect(h.setSession).not.toHaveBeenCalled();
  });

  it('a fresh bundle signs in through the one-time credential', async () => {
    h.bundle = bundle(nowSec() + 600);
    h.invoke.mockResolvedValue({ data: { token_hash: 'th' }, error: null });
    h.verifyOtp.mockResolvedValue({ data: {}, error: null });
    expect(await inheritFromNexus()).toEqual({ ok: true, email: 'a@x.test' });
    expect(h.setSession).not.toHaveBeenCalled();
  });

  it('another account is refused before the expiry check', async () => {
    h.bundle = bundle(nowSec() + 600);
    expect((await inheritFromNexus({ onlyUserId: 'user-b' })).reason).toBe('other-account');
    expect(h.invoke).not.toHaveBeenCalled();
  });
});

// v1.22 (limecore#113)
describe('inheritFromNexus: a choice made meanwhile wins, failures are codes', () => {
  it('writes no session when the user chose something else while it ran', async () => {
    h.bundle = bundle(nowSec() + 3600);
    h.invoke.mockResolvedValue({ data: { token_hash: 'th' }, error: null });
    const result = await inheritFromNexus({ shouldAbort: async () => true });
    expect(result).toEqual({ ok: false, reason: 'superseded' });
    expect(h.verifyOtp).not.toHaveBeenCalled();
  });
  it('still signs in when nothing else was chosen', async () => {
    h.bundle = bundle(nowSec() + 3600);
    h.invoke.mockResolvedValue({ data: { token_hash: 'th' }, error: null });
    expect((await inheritFromNexus({ shouldAbort: async () => false })).ok).toBe(true);
  });
  it('a failed exchange is a code that maps to a localised key, with no raw text', async () => {
    h.bundle = bundle(nowSec() + 3600);
    h.invoke.mockResolvedValue({ data: null, error: { message: 'GoTrue: raw english' } });
    const result = await inheritFromNexus();
    expect(result).toEqual({ ok: false, reason: 'failed' });
    expect(nexusErrorKey(result.reason)).toBe('auth.nexusErr.failed');
    expect(nexusErrorKey('no-session')).toBe('auth.nexusErr.noSession');
    expect(nexusErrorKey('unavailable')).toBe('auth.nexusErr.unavailable');
  });
});
