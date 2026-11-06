import { describe, it, expect } from 'vitest';
import { layoutBands, revisionWindowsOn } from './calendar.js';

// v1.21 (#206) — revision bands on phones: the nearest exam takes the top lane,
// and the day sheet lists the windows a day falls in.

// A Monday-start week, 2026-11-02 .. 2026-11-08.
const row = ['02', '03', '04', '05', '06', '07', '08'].map((d) => ({ iso: `2026-11-${d}` }));
const B = (id, from, to) => ({ id, title: id, from, to, color: '#aa5577' });

describe('layoutBands', () => {
  it('puts the window whose exam comes first on the top lane', () => {
    // `far` starts earlier and runs longer, which used to win lane 0.
    const far = B('far', '2026-10-20', '2026-11-20');
    const near = B('near', '2026-11-04', '2026-11-06');
    const { segments, lanes } = layoutBands([far, near], row);
    const lane = Object.fromEntries(segments.map((s) => [s.band.id, s.lane]));
    expect(lane).toEqual({ near: 0, far: 1 });
    expect(lanes).toBe(2);
  });

  it('shares a lane when windows do not overlap, in any order', () => {
    const a = B('a', '2026-11-02', '2026-11-03');
    const b = B('b', '2026-11-05', '2026-11-06');
    const c = B('c', '2026-11-02', '2026-11-07'); // overlaps both, exam last
    const { segments, lanes } = layoutBands([c, b, a], row);
    const lane = Object.fromEntries(segments.map((s) => [s.band.id, s.lane]));
    expect(lane).toEqual({ a: 0, b: 0, c: 1 });
    expect(lanes).toBe(2);
  });

  it('never stacks two segments in the same cell of a lane', () => {
    const bands = [
      B('w1', '2026-11-01', '2026-11-09'), B('w2', '2026-11-03', '2026-11-04'),
      B('w3', '2026-11-04', '2026-11-05'), B('w4', '2026-11-06', '2026-11-07'),
      B('w5', '2026-11-02', '2026-11-02'),
    ];
    const { segments } = layoutBands(bands, row);
    const seen = new Set();
    for (const s of segments) {
      for (let c = s.startCol; c < s.startCol + s.span; c++) {
        const key = `${s.lane}:${c}`;
        expect(seen.has(key), key).toBe(false);
        seen.add(key);
      }
    }
  });

  it('marks segments that continue from or into the next row', () => {
    const { segments } = layoutBands([B('x', '2026-10-30', '2026-11-12')], row);
    expect(segments[0]).toMatchObject({ startCol: 0, span: 7, continuesLeft: true, continuesRight: true });
  });
});

describe('revisionWindowsOn', () => {
  const bands = [
    B('later', '2026-11-01', '2026-11-19'),
    B('sooner', '2026-11-04', '2026-11-09'),
    B('past', '2026-10-01', '2026-10-10'),
  ];

  it('lists the windows covering a day, nearest exam first', () => {
    expect(revisionWindowsOn(bands, '2026-11-05').map((b) => b.id)).toEqual(['sooner', 'later']);
  });

  it('includes both ends of a window and nothing outside it', () => {
    expect(revisionWindowsOn(bands, '2026-11-04').map((b) => b.id)).toEqual(['sooner', 'later']);
    expect(revisionWindowsOn(bands, '2026-11-09').map((b) => b.id)).toEqual(['sooner', 'later']);
    expect(revisionWindowsOn(bands, '2026-11-10').map((b) => b.id)).toEqual(['later']);
    expect(revisionWindowsOn(bands, '2026-11-20')).toEqual([]);
  });

  it('gives the exam date as the day after the window', () => {
    expect(revisionWindowsOn(bands, '2026-11-05')[0].examDate).toBe('2026-11-10');
  });
});
