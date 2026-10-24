import { describe, expect, it } from 'vitest';
import { courseForItem, sourceCourse, sourceCourses, toAssignments } from './feedImport.js';

// Shaped like the generator writes them (instructure/canvas-lms,
// app/models/calendar_event.rb): the course in the URL's include_contexts and
// its course_code in brackets at the end of SUMMARY.
const canvas = (uid, title, courseId, code) => ({
  uid,
  title: code ? `${title} [${code}]` : title,
  dueDate: '2026-11-02',
  url: `https://school.example/calendar?include_contexts=course_${courseId}&month=11&year=2026#assignment_${uid}`,
});

describe('source course of a feed item (#187)', () => {
  it('reads the course id from the URL and the code from the title', () => {
    expect(sourceCourse(canvas('1', 'Essay 2', 4411, 'ENG-101'))).toEqual({ key: 'course_4411', label: 'ENG-101' });
  });
  it('a feed that only brackets a code still groups by it', () => {
    expect(sourceCourse({ title: 'Lab report [CHEM 2]', url: null })).toEqual({ key: 'code:CHEM 2', label: 'CHEM 2' });
  });
  it('an item with neither is not mappable', () => {
    expect(sourceCourse({ title: 'Holiday', url: 'https://x.example/e/1' })).toBeNull();
  });
  it('lists the source courses with counts', () => {
    const items = [canvas('1', 'A', 1, 'MATH'), canvas('2', 'B', 1, 'MATH'), canvas('3', 'C', 2, 'BIO'), { uid: '4', title: 'Other' }];
    expect(sourceCourses(items)).toEqual([
      { key: 'course_2', label: 'BIO', count: 1 },
      { key: 'course_1', label: 'MATH', count: 2 },
    ]);
  });
});

describe('which StudyDesk course an item goes to', () => {
  const feed = { courseId: 'default', courseMap: { course_1: 'math', course_9: 'gone' } };
  const exists = (id) => id !== 'gone';
  it('its source course mapping', () => {
    expect(courseForItem(canvas('1', 'A', 1, 'MATH'), feed, exists)).toBe('math');
  });
  it('the feed default when unmapped, unmappable, or mapped to a deleted course', () => {
    expect(courseForItem(canvas('2', 'B', 2, 'BIO'), feed, exists)).toBe('default');
    expect(courseForItem({ uid: '3', title: 'x' }, feed, exists)).toBe('default');
    expect(courseForItem(canvas('4', 'C', 9, 'OLD'), feed, exists)).toBe('default');
  });
  it('toAssignments files each item through the resolver; ids do not change', async () => {
    const items = [canvas('1', 'A', 1, 'MATH'), canvas('2', 'B', 2, 'BIO')];
    const mapped = await toAssignments(items, (it) => courseForItem(it, feed, exists));
    const plain = await toAssignments(items, 'default');
    expect(mapped.map((r) => r.courseId)).toEqual(['math', 'default']);
    expect(mapped.map((r) => r.id)).toEqual(plain.map((r) => r.id));
  });
});
