import { describe, it, expect, vi, beforeEach } from 'vitest';

// v1.21.1 (limecore#87) — the app-open records are opt-in, per owner.

const h = vi.hoisted(() => ({ enqueue: vi.fn(), guest: false }));
vi.mock('./outbox.js', () => ({ enqueue: h.enqueue }));
vi.mock('./guestMode.js', () => ({ isGuestMode: () => h.guest }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => false, getPlatform: () => 'web' } }));

function storage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => void m.set(k, String(v)),
    removeItem: (k) => void m.delete(k),
  };
}

const { recordAppOpen } = await import('./appOpens.js');
const { readConsent } = await import('./consent.js');
const { setConsent } = await import('./consentWrite.js');

beforeEach(() => {
  vi.stubGlobal('localStorage', storage());
  localStorage.setItem('studydesk.ownerUserId', 'user-a');
  h.enqueue.mockClear();
  h.guest = false;
});

describe('app opens are opt-in (limecore#87)', () => {
  it('nothing is queued before the question is answered (existing installs too)', () => {
    localStorage.setItem('studydesk.lastAppOpen', '2000-01-01');   // a pre-1.21.1 install
    expect(readConsent()).toEqual({});
    expect(recordAppOpen()).toBe(false);
    expect(h.enqueue).not.toHaveBeenCalled();
  });

  it('nothing is queued after a no', () => {
    setConsent({ opens: false });
    expect(recordAppOpen()).toBe(false);
    expect(h.enqueue).not.toHaveBeenCalled();
  });

  it('a yes queues one open per day', () => {
    setConsent({ opens: true });
    expect(recordAppOpen()).toBe(true);
    expect(recordAppOpen()).toBe(false);
    expect(h.enqueue).toHaveBeenCalledTimes(1);
    expect(h.enqueue.mock.calls[0][0]).toBe('record_app_open');
  });

  it("one account's yes is not another account's", () => {
    setConsent({ opens: true });
    localStorage.setItem('studydesk.ownerUserId', 'user-b');
    expect(readConsent()).toEqual({});
    expect(recordAppOpen()).toBe(false);
  });

  it('a guest is never recorded, even with a yes', () => {
    setConsent({ opens: true });
    h.guest = true;
    expect(recordAppOpen()).toBe(false);
    expect(h.enqueue).not.toHaveBeenCalled();
  });
});
