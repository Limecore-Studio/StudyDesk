import { describe, it, expect, vi, beforeEach } from 'vitest';
import { hold, release, replayHeld, heldIds } from './autoSaveHold.js';
import { findUnsynced } from './reconcile.js';

// v1.21.1 (StudyDesk#253, #254) — an automatic save in its 5 s Undo window.

function storage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => void m.set(k, String(v)),
    removeItem: (k) => void m.delete(k),
  };
}

const session = (id, minutes = 25) => ({ id, subjectId: null, startedAt: '2026-11-16T08:00:00.000Z', durationMinutes: minutes });
const plan = (id) => ({ id, subjectId: null, startsAt: '2026-11-16T08:00:00.000Z', durationMinutes: 25 });
const kinds = (state) => findUnsynced(state, { sessions: [], plannedSessions: [] }).map((i) => `${i.kind}:${i.payload.id}`);

beforeEach(() => {
  vi.stubGlobal('localStorage', storage());
  release();
});

describe('reconcile skips a held save (StudyDesk#253)', () => {
  it('a new session and its plan are not pushed while held, and are once released', () => {
    const state = { courses: {}, studySessions: [session('run-1'), session('older')], plannedSessions: [plan('p1')] };
    hold('run-1', 'p1', 'user-a', []);
    expect(kinds(state)).toEqual(['log_session:older']);
    // Undo then removes it locally; nothing was ever sent, so nothing comes back.
    release();
    expect(kinds(state)).toEqual(['log_session:run-1', 'log_session:older', 'upsert_planned:p1']);
  });
});

describe('a held save survives the app dying (StudyDesk#254)', () => {
  const ops = [['update_session', { id: 's1', durationMinutes: 50 }], ['upsert_planned', { id: 'p1', fulfilledBy: 's1' }]];

  it('the ops of a run that died are queued on the next sign-in, once', () => {
    hold('s1', 'p1', 'user-a', ops);
    heldIds.clear();                       // the process died: memory is gone
    const enqueue = vi.fn();
    replayHeld('user-a', enqueue);
    expect(enqueue.mock.calls).toEqual(ops);
    replayHeld('user-a', enqueue);
    expect(enqueue).toHaveBeenCalledTimes(2);
  });

  it('a save that was pushed or undone leaves nothing to replay', () => {
    hold('s1', 'p1', 'user-a', ops);
    release();
    const enqueue = vi.fn();
    replayHeld('user-a', enqueue);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("another account never gets the ops, and a guest's save is never stored", () => {
    hold('s1', 'p1', 'user-a', ops);
    const enqueue = vi.fn();
    replayHeld('user-b', enqueue);
    expect(enqueue).not.toHaveBeenCalled();
    replayHeld('user-a', enqueue);         // the record is gone either way
    expect(enqueue).not.toHaveBeenCalled();
    hold('s1', null, undefined, ops);
    replayHeld('user-a', enqueue);
    expect(enqueue).not.toHaveBeenCalled();
  });
});
