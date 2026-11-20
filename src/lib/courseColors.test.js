import { describe, it, expect } from 'vitest';
import { COURSE_COLORS, COURSE_COLOR_NAMES } from './courseColors.js';
import en from '../i18n/locales/en.json';

// StudyDesk#271 — every preset swatch has a spoken name, not a hex code.
describe('course colour names', () => {
  it('one name per preset, each with an English string', () => {
    expect(COURSE_COLOR_NAMES).toHaveLength(COURSE_COLORS.length);
    for (const n of COURSE_COLOR_NAMES) expect(en.course.colorName[n], n).toBeTruthy();
    expect(en.course.colorSwatch).toContain('{{name}}');
  });
});
