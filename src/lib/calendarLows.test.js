import { describe, it, expect, vi } from 'vitest';

// v1.22 (StudyDesk#246) — the ICS export of repeating commitments, and the
// Next Up digest.

vi.mock('@capacitor/local-notifications', () => ({ LocalNotifications: {} }));
const { buildIcs } = await import('./ics.js');
const { buildReminders, DIGEST_OVERDUE_DAYS } = await import('./planNotifications.js');

const football = { id: 'c1', title: 'Football', weekday: 4, startsOn: '2026-12-15', startTime: '18:00:00', endTime: '19:30:00', intervalWeeks: 2 };

describe('ICS export of a commitment', () => {
  it('starts on the first real occurrence and carries the interval', () => {
    const { text } = buildIcs({ commitments: [football] }, { now: new Date(2026, 11, 1) });
    // Tue 15th → the first Thursday is the 17th.
    expect(text).toContain('DTSTART:20261217T180000');
    expect(text).not.toContain('DTSTART:20261215');
    expect(text).toMatch(/RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=TH/);
  });
  it('a weekly one has no INTERVAL', () => {
    const { text } = buildIcs({ commitments: [{ ...football, intervalWeeks: 1 }] }, { now: new Date(2026, 11, 1) });
    expect(text).toMatch(/RRULE:FREQ=WEEKLY;BYDAY=TH/);
  });
});

describe('Next Up digest', () => {
  const t = (k) => k;
  const now = new Date(2026, 10, 27, 8, 0).getTime();
  const pad = (n) => String(n).padStart(2, '0');
  const dayOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const digests = (asgs) => buildReminders([], asgs, {}, [], {}, t, now)
    .filter((n) => n.title === 'notif.digestTitle')
    .map((n) => ({ day: dayOf(new Date(n.schedule.at)), body: n.body }));

  it('names what is next, not a months-old overdue import', () => {
    const d = digests([
      { id: 'old', title: 'September essay', dueDate: '2026-09-10' },
      { id: 'next', title: 'Lab report', dueDate: '2026-11-30' },
    ]);
    expect(d[0].body).toBe('Lab report');
  });

  it("each day names that day's next item, and a passed one drops out", () => {
    const d = digests([
      { id: 'a', title: 'Soon', dueDate: '2026-11-28' },
      { id: 'b', title: 'Later', dueDate: '2026-12-20' },
    ]);
    const on = (day) => d.find((n) => n.day === day)?.body;
    expect(on('2026-11-27')).toBe('Soon');
    // Overdue keeps leading for a few days, then the next item takes over.
    expect(on(`2026-12-${pad(1 + DIGEST_OVERDUE_DAYS)}`)).toBe('Later');
  });
});
