import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// StudyDesk#316 — the widget snapshot is pushed again when the app returns to
// the foreground, so a widget placed after the last data change gets filled.
describe('useWidgets', () => {
  const src = readFileSync(new URL('./useWidgets.js', import.meta.url), 'utf8');
  it('re-pushes on visibilitychange to visible', () => {
    expect(src).toMatch(/addEventListener\("visibilitychange", onVisible\)/);
    expect(src).toMatch(/visibilityState === "visible"\) bump\(\)/);
    expect(src).toMatch(/removeEventListener\("visibilitychange", onVisible\)/);
  });
  it('the push effect depends on the tick it bumps', () => {
    expect(src).toMatch(/\[state\.assignments, state\.exams, state\.courses, t, widgetPaletteTick\]/);
  });
});
