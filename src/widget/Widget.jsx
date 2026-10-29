// The desktop glance widget's one screen.
//
// Design intent: a torn slip off the desk pad, not a shrunken app window. At
// 320×200 with no chrome there is room for exactly one statement and a short
// list, so the composition is deliberately top-heavy — the next thing due gets
// serif display type and the whole upper band, then a hairline rule, then the
// rest of today in quiet mono. If you only ever read the top line, the widget
// has done its job.
//
// Read-only by design. Every affordance that would change data lives in the
// main window; this thing is a dial, not a control.
//
// v1.20 (#189) — a dial you can follow back to its source: clicking the timer
// opens the main window at the timer, clicking the deadline or the plan opens
// it at the plan. And while a focus block is on the clock on any of the
// user's devices (Focus Sync, #202), a strip under the bar shows it.

import { useTranslation } from 'react-i18next';
import { minutesToTime } from '../lib/timetable.js';
import { fmtToday } from '../lib/dates.js';
import { formatClock } from '../lib/timerSnapshot.js';
import { nextDue, todayPlan, visiblePlan, minutesOfDay } from './glance.js';
import { useGlance } from './useGlance.js';
import { useFocusMirror } from './useFocusMirror.js';
import '../styles/base.css';
import '../styles/widget.css';

function closeWidget() {
  // Exposed by electron/widget-preload.cjs. Optional-chained so the widget
  // still renders in a plain browser tab during development, where there is no
  // window to close.
  window.studydeskWidget?.close();
}

/** Props that make a section open the main window at `view`, or nothing
 *  outside the desktop shell (a dev tab has no main window to open). */
function opens(view, label) {
  const open = window.studydeskWidget?.open;
  if (!open) return {};
  return {
    role: 'button',
    tabIndex: 0,
    'aria-label': label,
    onClick: () => open(view),
    onKeyDown: (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(view); }
    },
  };
}

function TimerStrip({ timer, secs }) {
  const { t } = useTranslation();
  const isBreak = timer.mode !== 'stopwatch' && timer.phase !== 'focus';
  const label = timer.mode === 'stopwatch' ? t('av.tm.pill.stopwatch')
    : isBreak ? t('av.tm.pill.break') : t('av.tm.pill.focus');
  return (
    <section
      className={`wg-timer${timer.running ? '' : ' is-paused'}${isBreak ? ' is-break' : ''}`}
      {...opens('timer', timer.task ? t('av.tm.pill.openWith', { task: timer.task }) : t('av.tm.pill.open'))}
    >
      <span className="wg-timer-dot" aria-hidden="true" />
      <span className="wg-timer-label">{timer.running ? label : `${label} · ${t('timer.focusChipPaused')}`}</span>
      <span className="wg-timer-clock">{formatClock(secs)}</span>
      {timer.task ? <span className="wg-timer-task" title={timer.task}>{timer.task}</span> : null}
    </section>
  );
}

/** Urgency copy, reusing the assignment view's existing ten-locale strings
 *  rather than minting widget-only ones that would drift from them. */
function urgencyLabel(t, daysAway) {
  if (daysAway === null || daysAway === undefined) return null;
  if (daysAway < 0) return t('av.urgency.overdue', { n: Math.abs(daysAway) });
  if (daysAway === 0) return t('av.urgency.dueToday');
  if (daysAway === 1) return t('av.urgency.dueTomorrow');
  return t('av.urgency.daysLeft', { n: daysAway });
}

function PlanRow({ item, past, index }) {
  const { t } = useTranslation();
  const label = item.kind === 'lesson' ? t('tt.lesson') : t('cal.planned');
  return (
    <li
      className={`wg-row${past ? ' is-past' : ''}${item.done ? ' is-done' : ''}`}
      // Staggered only on first paint — see widget.css. Inline because the
      // delay is per-row data, not a style rule.
      style={{ '--row-index': index }}
    >
      <span className="wg-row-time">{minutesToTime(item.startMin)}</span>
      <span
        className={`wg-row-tick wg-row-tick--${item.kind}`}
        style={item.color ? { '--tick': item.color } : undefined}
        aria-hidden="true"
      />
      <span className="wg-row-body">
        <span className="wg-row-title">{item.title || label}</span>
        {item.room ? <span className="wg-row-room">{item.room}</span> : null}
      </span>
    </li>
  );
}

export default function Widget() {
  const { t } = useTranslation();
  const { status, state, todayIso, now } = useGlance();
  const { timer, secs } = useFocusMirror();

  const due = status === 'ready' && state ? nextDue(state, todayIso) : null;
  const plan = status === 'ready' && state ? todayPlan(state, todayIso) : [];
  const { items, overflow, spent } = visiblePlan(plan, minutesOfDay(now));

  return (
    <div className="wg">
      {/* The only drag region. Frameless windows have no title bar, so without
          this the widget could be shown but never moved off wherever it opened. */}
      <header className="wg-bar">
        <span className="wg-bar-date">{fmtToday(now)}</span>
        <button
          type="button"
          className="wg-bar-close"
          onClick={closeWidget}
          aria-label={t('common.close', 'Close')}
        >
          ×
        </button>
      </header>

      {timer && <TimerStrip timer={timer} secs={secs} />}

      <section className="wg-lead" {...opens('plan', t('widget.openPlan'))}>
        {status === 'loading' && <p className="wg-quiet">…</p>}

        {status === 'signedOut' && (
          <p className="wg-quiet">{t('settings.signedOutLocal')}</p>
        )}

        {status === 'error' && (
          <p className="wg-quiet">—</p>
        )}

        {status === 'ready' && !due && (
          <p className="wg-quiet">{t('av.pl.nothingDue')}</p>
        )}

        {status === 'ready' && due && (
          <>
            <p className="wg-label">{t('av.pl.next')}</p>
            <h1 className="wg-title" title={due.title}>{due.title}</h1>
            <p className="wg-meta">
              {due.courseName && (
                <>
                  <span
                    className="wg-dot"
                    style={due.color ? { '--tick': due.color } : undefined}
                    aria-hidden="true"
                  />
                  <span className="wg-course">{due.courseName}</span>
                </>
              )}
              <span className={`wg-urgency${due.daysAway < 0 ? ' is-overdue' : ''}`}>
                {/* v1.14 Item 5 — the time only when it is today or tomorrow.
                    "09:00" is what you act on this morning; on something nine
                    days out it is noise in a line with room for one fact. */}
                {urgencyLabel(t, due.daysAway)}
                {due.dueTime && due.daysAway >= 0 && due.daysAway <= 1 ? ` · ${due.dueTime}` : ''}
              </span>
            </p>
          </>
        )}
      </section>

      <hr className="wg-rule" />

      <section className="wg-plan" {...opens('plan', t('widget.openPlan'))}>
        <p className="wg-label wg-label--plan">
          {t('sv.todayHead')}
          {overflow > 0 && <span className="wg-more">+{overflow}</span>}
        </p>
        {items.length === 0 ? (
          <p className="wg-quiet wg-quiet--plan">{t('widget.noPlanToday')}</p>
        ) : (
          <ul className={`wg-rows${spent ? ' is-spent' : ''}`}>
            {items.map((item, i) => (
              <PlanRow
                key={`${item.kind}:${item.id}`}
                item={item}
                index={i}
                past={item.endMin <= minutesOfDay(now)}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
