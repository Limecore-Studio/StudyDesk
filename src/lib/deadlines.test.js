import { describe, it, expect } from 'vitest';
import { studyStartDate, daysUntil, examStudyPlan } from './deadlines.js';

// v1.18.1 (StudyDesk#148): an exam's date can be cleared, and studyStartDate
// threw on it, crashing the Plan tab on every device that pulled the row.
describe('studyStartDate', () => {
  it('is null for an exam with no date, null or empty', () => {
    expect(studyStartDate({ dueDate: null, difficulty: 'hard' })).toBeNull();
    expect(studyStartDate({ dueDate: '' })).toBeNull();
    expect(daysUntil(studyStartDate({ dueDate: null }))).toBeNull();
  });

  it('still counts back from a dated exam', () => {
    expect(studyStartDate({ dueDate: '2026-10-20', difficulty: 'medium' })).toBe('2026-10-13');
  });
});

// v1.19 (#154) — Next Up's exam suggestions, by when to start studying.
describe('examStudyPlan', () => {
  const day = (n) => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
  // DIFFICULTY_DAYS: the study start is the exam day minus the difficulty's lead.
  it('orders by study start, not exam day', () => {
    const plan = examStudyPlan([
      { id: 'easy-soon', dueDate: day(6), difficulty: 'easy' },
      { id: 'brutal-later', dueDate: day(12), difficulty: 'brutal' },
    ]);
    expect(plan[0].exam.id).toBe('brutal-later');
    expect(plan[0].start <= plan[1].start).toBe(true);
  });
  it('an exam whose study start has come is a Today item, with its countdown', () => {
    const [p] = examStudyPlan([{ id: 'x', dueDate: day(9), difficulty: 'brutal' }]);
    expect(p.startIn).toBeLessThanOrEqual(0);
    expect(p.bucket).toBe('today');
    expect(p.dueIn).toBe(9);
  });
  it('a later study start sits in this week or later, three days out is always today', () => {
    const plan = examStudyPlan([{ id: 'far', dueDate: day(40), difficulty: 'easy' }, { id: 'near', dueDate: day(3), difficulty: 'easy' }]);
    expect(plan.find((p) => p.exam.id === 'far').bucket).toBe('later');
    expect(plan.find((p) => p.exam.id === 'near').bucket).toBe('today');
  });
  it('skips done, past and undated exams, and keeps the cap of three', () => {
    const many = [1, 2, 3, 4].map((n) => ({ id: `e${n}`, dueDate: day(n + 10), difficulty: 'medium' }));
    expect(examStudyPlan([...many, { id: 'd', dueDate: day(5), done: true }, { id: 'p', dueDate: day(-2) }, { id: 'u', dueDate: null }])).toHaveLength(3);
  });
});
