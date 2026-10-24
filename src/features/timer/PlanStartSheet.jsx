// v1.19 (#185) — the moment a scheduled study block starts.
//
// Shown when a block's start time arrives with the app open, when its
// reminder is tapped, or from a block's Start button. It is the one place a
// block turns into a timer run, so everything that starts a block goes
// through here and the run always carries the block's id.
//
//   Start focus — the timer, in focus mode, with the block's subject and
//                 length, linked to the block (one block, one session).
//   Snooze 5 min — this sheet again in five minutes. Local only: the plan
//                 itself does not change.
//   Skip        — the block is dismissed, exactly like the calendar's Skip.

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { fmtTime } from '../../lib/dates.js';

export default function PlanStartSheet({ plan, course, onStart, onSnooze, onSkip, onClose }) {
  const { t } = useTranslation();

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const colour = course?.color || 'var(--text)';
  const title = plan.title || course?.name || t('notif.planFallback');
  // Read once when the sheet opens: "now" vs "at 14:30" is about the moment
  // it appeared, and a render must not consult the clock.
  const [started] = useState(() => new Date(plan.startsAt).getTime() <= Date.now());

  return createPortal(
    <div className="pss" role="dialog" aria-modal="true" aria-labelledby="pss-title" style={{ '--pss-colour': colour }}>
      <button type="button" className="pss-close" onClick={onClose} aria-label={t('pr.notNow')} title={t('pr.notNow')}>
        <X size={18} strokeWidth={1.75} />
      </button>
      <div className="pss-body">
        <div className="pss-band" aria-hidden="true" />
        <div className="pss-kicker">
          {started ? t('pr.startsNow') : t('pr.scheduledFor', { time: fmtTime(plan.startsAt) })}
        </div>
        <h2 id="pss-title" className="pss-title">{title}</h2>
        <div className="pss-meta">
          {course && <span className="asgn-course" style={{ background: course.color + '18', color: course.color }}>{course.name}</span>}
          <span className="pss-duration">{t('pr.minutes', { n: plan.durationMinutes })}</span>
        </div>
        {plan.notes && <p className="pss-notes">{plan.notes}</p>}
        <div className="pss-actions">
          <button type="button" className="btn pss-start" onClick={onStart} autoFocus>{t('pr.startFocus')}</button>
          <div className="pss-secondary">
            <button type="button" className="btn-outline" onClick={onSnooze}>{t('pr.snooze')}</button>
            <button type="button" className="btn-outline" onClick={onSkip}>{t('pr.skip')}</button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
