// v1.19 (#87, #98) — the Done list. Opened from Next Up and from a course's
// detail page; see lib/doneList.js for what it holds and why.

import { useTranslation } from 'react-i18next';
import { addDays, fmtDateFull, toLocalISO } from '../../lib/dates.js';
import { doneItems, groupByDay, toggleFor } from '../../lib/doneList.js';

export default function DoneList({ state, dispatch, courseId = null, onClose, showFlash }) {
  const { t } = useTranslation();
  const groups = groupByDay(doneItems(state, { courseId }));
  const today = toLocalISO(new Date());
  const yesterday = addDays(today, -1);
  const dayLabel = (iso) => (!iso ? t('done.earlier') : iso === today ? t('done.today') : iso === yesterday ? t('done.yesterday') : fmtDateFull(iso));

  const untick = (item) => {
    dispatch(toggleFor(item));
    showFlash?.(t('done.restored'));
  };

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="done-title" onClick={onClose}>
      <div className="modal done-list" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title" id="done-title">{t('done.title')}</div>
        {groups.length === 0 && <div className="done-empty">{t('done.empty')}</div>}
        {groups.map(([day, items]) => (
          <div key={day || 'earlier'} className="done-day">
            <div className="bucket-header">{dayLabel(day)}</div>
            {items.map((it) => {
              const c = it.courseId ? state.courses?.[it.courseId] : null;
              return (
                <div key={`${it.kind}:${it.id}`} className="action-item done">
                  <button
                    type="button"
                    className="asgn-check checked"
                    onClick={() => untick(it)}
                    aria-label={t('done.untick', { title: it.title })}
                    title={t('done.untick', { title: it.title })}
                  />
                  <div className="action-text done">{it.title}</div>
                  {c && <span className="asgn-course" style={{ background: c.color + '18', color: c.color }}>{c.name}</span>}
                  <span className="done-kind">{t(`done.kind.${it.kind}`)}</span>
                </div>
              );
            })}
          </div>
        ))}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
          <button className="btn-outline" onClick={onClose}>{t('common.close')}</button>
        </div>
      </div>
    </div>
  );
}
