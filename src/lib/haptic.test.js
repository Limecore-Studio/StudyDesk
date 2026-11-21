import { describe, it, expect, vi, beforeEach } from 'vitest';

// limecore#130 — the haptic helper: native only, one cached import, and each
// call awaitable so tests are not flaky on the lazy load.
const H = vi.hoisted(() => ({ native: true, calls: [], imports: 0 }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => H.native } }));
vi.mock('@capacitor/haptics', () => {
  H.imports += 1;
  return {
    Haptics: {
      impact: async (o) => H.calls.push(['impact', o.style]),
      notification: async (o) => H.calls.push(['notification', o.type]),
    },
    ImpactStyle: { Light: 'LIGHT' },
    NotificationType: { Success: 'SUCCESS', Warning: 'WARNING' },
  };
});

const { haptic } = await import('./haptic.js');

beforeEach(() => { H.calls.length = 0; H.native = true; });

describe('haptic', () => {
  it('light, success and warning map to the plugin, and the plugin loads once', async () => {
    await haptic.light();
    await haptic.success();
    await haptic.warning();
    expect(H.calls).toEqual([['impact', 'LIGHT'], ['notification', 'SUCCESS'], ['notification', 'WARNING']]);
    expect(H.imports).toBe(1);
  });

  it('does nothing off native (web, desktop)', async () => {
    H.native = false;
    await haptic.light();
    expect(H.calls).toEqual([]);
  });
});
