// v1.19 (#186) — the in-app date/time sheet, in its own chunk.
//
// DateInput renders on every form with a date in it, at launch included, but
// this sheet only ever opens on a phone whose native picker does not. Kept out
// of the startup bundle and loaded the first time it is needed.

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { formatLocale, toLocalISO } from './dates.js';
import {
  formatTime, minuteOptions, monthGrid, parseTime, splitLocal, weekStartFor, withinBounds,
} from './pickerFallback.js';

export default function PickerSheet({ type, value, min, max, step, onCancel, onSet }) {
  const { t } = useTranslation();
  const locale = formatLocale();
  const hasDate = type !== 'time';
  const hasTime = type !== 'date';

  const initial = type === 'datetime-local' ? splitLocal(value) : { date: type === 'date' ? value : '', time: type === 'time' ? value : '' };
  const [date, setDate] = useState(initial.date);
  const t0 = parseTime(initial.time);
  const [hour, setHour] = useState(t0.h);
  const [minute, setMinute] = useState(t0.m);

  const today = toLocalISO(new Date());
  const anchor = (initial.date || today).split('-').map(Number);
  const [view, setView] = useState({ y: anchor[0], m: anchor[1] - 1 });

  // Bounds per part. For datetime-local only the date half is enforced here;
  // the form's own validation still sees the full value on save.
  const dateMin = hasDate ? splitLocal(min).date || (type === 'date' ? min : '') : '';
  const dateMax = hasDate ? splitLocal(max).date || (type === 'date' ? max : '') : '';

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const weekStart = weekStartFor(locale);
  const cells = useMemo(() => monthGrid(view.y, view.m, weekStart), [view.y, view.m, weekStart]);
  const weekdays = useMemo(() => {
    const f = new Intl.DateTimeFormat(locale, { weekday: 'narrow' });
    // 2026-02-01 is a Sunday; walk from the locale's first day.
    return Array.from({ length: 7 }, (_, i) => f.format(new Date(2026, 1, 1 + ((weekStart + i) % 7))));
  }, [locale, weekStart]);
  const monthLabel = new Date(view.y, view.m, 1).toLocaleDateString(locale, { month: 'long', year: 'numeric' });
  const shiftMonth = (n) => setView(({ y, m }) => {
    const d = new Date(y, m + n, 1);
    return { y: d.getFullYear(), m: d.getMonth() };
  });

  const minutes = minuteOptions(step, minute);
  const timeValue = hour !== null && minute !== null ? formatTime(hour, minute) : '';
  const out = type === 'date' ? date : type === 'time' ? timeValue : (date && timeValue ? `${date}T${timeValue}` : '');
  const canSet = !!out && withinBounds(out, min, max);

  // Picking an hour with no minute yet should not leave Set disabled for no
  // visible reason: the first hour tap also settles the minute on :00.
  const pickHour = (h) => { setHour(h); if (minute === null) setMinute(0); };

  return createPortal(
    <div className="modal-overlay dtp-overlay" role="dialog" aria-modal="true" aria-label={hasDate ? t('dtp.date') : t('dtp.time')} onClick={onCancel}>
      <div className="modal dtp" onClick={(e) => e.stopPropagation()}>
        {hasDate && <div className="dtp-section">
          <div className="dtp-month">
            <button type="button" className="dtp-nav" onClick={() => shiftMonth(-1)} aria-label={t('dtp.prevMonth')}>‹</button>
            <div className="dtp-month-label">{monthLabel}</div>
            <button type="button" className="dtp-nav" onClick={() => shiftMonth(1)} aria-label={t('dtp.nextMonth')}>›</button>
          </div>
          <div className="dtp-grid dtp-weekdays" aria-hidden="true">{weekdays.map((w, i) => <span key={i}>{w}</span>)}</div>
          <div className="dtp-grid">
            {cells.map((c) => {
              const off = !withinBounds(c.iso, dateMin, dateMax);
              return <button
                type="button"
                key={c.iso}
                className={'dtp-day' + (c.inMonth ? '' : ' out') + (c.iso === today ? ' today' : '') + (c.iso === date ? ' sel' : '')}
                disabled={off}
                aria-pressed={c.iso === date}
                aria-label={new Date(`${c.iso}T00:00`).toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' })}
                onClick={() => {
                  setDate(c.iso);
                  if (!c.inMonth) setView({ y: Number(c.iso.slice(0, 4)), m: Number(c.iso.slice(5, 7)) - 1 });
                }}
              >{c.day}</button>;
            })}
          </div>
        </div>}

        {hasTime && <div className="dtp-section">
          <div className="input-label">{t('dtp.hour')}</div>
          <div className="dtp-chips">
            {Array.from({ length: 24 }, (_, h) => (
              <button type="button" key={h} className={'dtp-chip' + (h === hour ? ' sel' : '')} aria-pressed={h === hour} onClick={() => pickHour(h)}>{String(h).padStart(2, '0')}</button>
            ))}
          </div>
          <div className="input-label">{t('dtp.minute')}</div>
          <div className="dtp-chips">
            {minutes.map((m) => (
              <button type="button" key={m} className={'dtp-chip' + (m === minute ? ' sel' : '')} aria-pressed={m === minute} onClick={() => setMinute(m)}>:{String(m).padStart(2, '0')}</button>
            ))}
          </div>
        </div>}

        <div className="dtp-readout" aria-live="polite">{out ? readout(type, date, timeValue, locale) : '—'}</div>

        <div className="dtp-actions">
          <button type="button" className="btn-outline" onClick={() => onSet('')}>{t('dtp.clear')}</button>
          <span className="dtp-spacer" />
          <button type="button" className="btn-outline" onClick={onCancel}>{t('common.cancel')}</button>
          <button type="button" className="btn" disabled={!canSet} onClick={() => onSet(out)}>{t('dtp.set')}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function readout(type, date, time, locale) {
  const d = date ? new Date(`${date}T00:00`).toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : '';
  if (type === 'date') return d;
  if (type === 'time') return time;
  return `${d} · ${time}`;
}
