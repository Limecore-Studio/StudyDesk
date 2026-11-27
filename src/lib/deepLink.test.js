import { describe, it, expect } from 'vitest';
import { parseRoute } from './deepLink.js';

// limecore#127 — the router's deep links (launcher shortcuts, NCC#131).
const ID = '3f1c2b8e-1d2a-4c5b-9e8f-0a1b2c3d4e5f';

describe('parseRoute', () => {
  it('names each route', () => {
    expect(parseRoute('com.studydesk.app://open/today')).toEqual({ view: 'today' });
    expect(parseRoute('com.studydesk.app://open/plan')).toEqual({ view: 'plan', addAssignment: false });
    expect(parseRoute('com.studydesk.app://open/plan?add=assignment')).toEqual({ view: 'plan', addAssignment: true });
    expect(parseRoute('com.studydesk.app://open/timer')).toEqual({ view: 'timer', startFocus: false });
    expect(parseRoute('com.studydesk.app://open/timer?start=focus')).toEqual({ view: 'timer', startFocus: true });
    expect(parseRoute(`com.studydesk.app://open/course/${ID}`)).toEqual({ view: 'course', courseId: ID });
  });

  it('a course link without a valid id falls back to Plan', () => {
    expect(parseRoute('com.studydesk.app://open/course/')).toEqual({ view: 'plan', addAssignment: false });
    expect(parseRoute('com.studydesk.app://open/course/<script>')).toEqual({ view: 'plan', addAssignment: false });
  });

  it('ignores anything that is not one of ours, including the login callback', () => {
    expect(parseRoute('com.studydesk.app://login-callback?code=abc')).toBeNull();
    expect(parseRoute('https://studydesk.limecore.dev/open/today')).toBeNull();
    expect(parseRoute('com.studydesk.app://open/settings')).toBeNull();
    expect(parseRoute(undefined)).toBeNull();
  });

  it('a malformed escape returns null instead of throwing', () => {
    expect(() => parseRoute('com.studydesk.app://open/course/%E0%A4%A')).not.toThrow();
    expect(parseRoute('com.studydesk.app://open/course/%E0%A4%A')).toBeNull();
    expect(parseRoute('com.studydesk.app://open/%')).toBeNull();
  });
});
