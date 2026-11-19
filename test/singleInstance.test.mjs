import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// StudyDesk#242. main.cjs needs Electron to run, so this checks its source:
// the lock is taken before the app is ready, a second launch quits, and the
// running one shows its main window when relaunched.
const src = readFileSync(new URL('../electron/main.cjs', import.meta.url), 'utf8');

describe('desktop single-instance lock (StudyDesk#242)', () => {
  it('takes the lock before app.whenReady and quits the second launch', () => {
    const lock = src.indexOf('app.requestSingleInstanceLock()');
    expect(lock).toBeGreaterThan(-1);
    expect(lock).toBeLessThan(src.indexOf('app.whenReady().then('));
    expect(src).toMatch(/if \(!gotSingleInstanceLock\) \{\s*log\([^)]*\);\s*app\.quit\(\);/);
  });

  it('a second launch shows the running instance\'s main window', () => {
    expect(src).toMatch(/app\.on\('second-instance',[\s\S]{0,200}openMainWindow\(\)/);
  });

  it('the quitting launch creates no window, tray or auth listener', () => {
    const ready = src.slice(src.indexOf('app.whenReady().then('));
    const guard = ready.indexOf('if (!gotSingleInstanceLock) return;');
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(ready.indexOf('startAuthLoopback()'));
  });
});
