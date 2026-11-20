import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// StudyDesk#288 — the pill renders on every screen from startup, so its rules
// must load with it, not with the lazy Timer screen's timer.css.
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

describe('timer pill CSS (StudyDesk#288)', () => {
  it('the pill rules are in timerPill.css, imported by TimerPill.jsx', () => {
    expect(read('./timerPill.css')).toMatch(/\.timer-pill\{/);
    expect(read('../features/timer/TimerPill.jsx')).toMatch(/import '\.\.\/\.\.\/styles\/timerPill\.css';/);
  });
  it('timer.css no longer carries them', () => {
    expect(read('./timer.css')).not.toMatch(/\.timer-pill[{-]/);
  });
});
