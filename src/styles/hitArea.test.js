import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// StudyDesk#270 follow-up. The invisible 48 dp hit box on small controls must
// not grow sideways: ✎ and × sit side by side on every assignment, and a box
// wider than × covered half of ✎, so a tap meant to edit deleted. It grows
// vertically only; the lone top-bar avatar is the one exception.
const css = readFileSync(new URL('./forms.css', import.meta.url), 'utf8');

describe('small-control hit areas (StudyDesk#270)', () => {
  it('row controls grow vertically only', () => {
    const rule = css.match(/\.btn-sm::after,\.btn-danger-text::after,\.timer-pill::after\{([^}]*)\}/);
    expect(rule, 'rule present').toBeTruthy();
    expect(rule[1]).toMatch(/width:100%;/);
    expect(rule[1]).toMatch(/height:max\(100%,48px\)/);
  });
  it('no other ::after widens .btn-sm or .btn-danger-text', () => {
    const widened = [...css.matchAll(/([^{}]*)\{[^}]*width:max\([^)]*48px\)[^}]*\}/g)].map((m) => m[1]);
    expect(widened.filter((sel) => /btn-sm|btn-danger-text/.test(sel))).toEqual([]);
  });
});
