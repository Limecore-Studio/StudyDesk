// v1.20 (#208) — what applyTheme asks of the native side. The device check is
// the real proof (see the PR); this pins the contract: the bars get the app's
// style BEFORE the night-mode switch (whose config change makes SystemBars
// re-apply its stored style), and web/Electron make no native call at all.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls = [];
let native = true;
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => native, getPlatform: () => (native ? 'android' : 'web') },
  SystemBarsStyle: { Dark: 'DARK', Light: 'LIGHT' },
  SystemBars: { setStyle: async (o) => { calls.push(['SystemBars.setStyle', o]); } },
  registerPlugin: () => ({ setNightMode: async (o) => { calls.push(['Appearance.setNightMode', o]); } }),
}));
vi.mock('@capacitor/status-bar', () => ({
  StatusBar: { setStyle: async () => {}, setBackgroundColor: async () => {} },
  Style: { Dark: 'DARK', Light: 'LIGHT' },
}));
// The real module loads the Supabase client, whose Realtime half throws on
// import under Node 20 (no native WebSocket), which is what CI runs.
vi.mock('./entitlement', () => ({ isEntitled: () => false }));

const flush = () => new Promise((r) => setTimeout(r, 0));

// The unit suite is Node-only by design (vitest.config.js): just enough of a
// page for theme.js. `--bg` is what the plugin is handed for the nav strip.
let bg = '#000000';
const root = { dataset: {}, style: { setProperty() {}, removeProperty() {} } };
vi.stubGlobal('document', { documentElement: root, querySelector: () => null, addEventListener() {} });
vi.stubGlobal('window', { addEventListener() {}, dispatchEvent() {} });
vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: (k) => (k === '--bg' ? bg : '') }));
vi.stubGlobal('localStorage', { getItem: () => null, setItem() {}, removeItem() {} });
vi.stubGlobal('Event', class { constructor(type) { this.type = type; } });

// theme.js reaches native code through a dynamic import, which settles in its
// own time under a loaded test run: wait for the calls, not for a fixed tick.
const callsSettle = (n) => vi.waitFor(() => { if (calls.length < n) throw new Error(`${calls.length} of ${n} calls`); });

// The module makes one launch call when first imported; take it out of the way.
const { applyTheme } = await import('./theme.js');
await callsSettle(2);

describe('native appearance (#208)', () => {
  beforeEach(() => {
    calls.length = 0;
    bg = '#000000';
    native = true;
  });

  it('sets both bars, then the night mode with the ground colour', async () => {
    applyTheme('free', 'black');
    await callsSettle(2);
    expect(calls).toEqual([
      ['SystemBars.setStyle', { style: 'DARK' }],
      ['Appearance.setNightMode', { dark: true, color: '#000000' }],
    ]);
  });

  it('a light look asks for light bars and day mode', async () => {
    bg = '#f5f2ed';
    applyTheme('free', 'light');
    await callsSettle(2);
    expect(calls).toEqual([
      ['SystemBars.setStyle', { style: 'LIGHT' }],
      ['Appearance.setNightMode', { dark: false, color: '#f5f2ed' }],
    ]);
  });

  it('makes no native call on web or Electron', async () => {
    native = false;
    applyTheme('free', 'black');
    // The import still resolves; it then stops at the platform check.
    for (let i = 0; i < 20; i++) await flush();
    expect(calls).toEqual([]);
  });
});
