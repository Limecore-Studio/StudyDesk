// v1.20 (StudyDesk#156) — progress counters on the Study view: pages,
// chapters or hours counted with +/−, per book or course, against an optional
// target. Loaded on demand (with its store), so the Study view and the
// startup bundle carry none of it until it renders.
//
// Design: the page's own vocabulary. A ruled section label with the add
// button on its rule, then one card per counter in the Next Up row style: the
// name and course on the left, the count in mono, a hairline of ink under it
// showing the way to the target, and − / + as small square keys. The form is
// the quick-add box the page already uses.

import { useEffect, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { enterSubmit } from '../../lib/imeSubmit.js';
import { preferredDayStart, todayStudyDayKey } from '../../lib/studyDay.js';
import { counterValue, counterProgress, liveCounters, stepFor, PERIODS } from '../../lib/counters.js';
import { getCounters, subscribeCounters, saveCounter, removeCounter, bump, refreshCounters } from '../../lib/counterStore.js';
import '../../styles/counters.css';

const UNIT_PRESETS = ['pages', 'chapters', 'hours'];
const fmt = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, '').replace(/\.$/, ''));

// Pull once per app run when the panel first shows; hints and full pulls
// keep it current after that (App.jsx).
let pulledThisRun = false;

function CounterForm({ initial, courses, onDone }) {
  const { t } = useTranslation();
  const [name, setName] = useState(initial?.name || '');
  const [unit, setUnit] = useState(initial?.unit || t('ctr.unit_pages'));
  const [period, setPeriod] = useState(initial?.period || 'total');
  const [target, setTarget] = useState(initial?.target != null ? String(initial.target) : '');
  const [subjectId, setSubjectId] = useState(initial?.subjectId || '');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const targetNum = Number(String(target).replace(',', '.'));
  const valid = name.trim() && unit.trim() && (!target.trim() || (targetNum > 0 && targetNum <= 100000));
  const save = async () => {
    if (!valid) return;
    await saveCounter({
      id: initial?.id,
      name: name.trim().slice(0, 80),
      unit: unit.trim().slice(0, 24),
      period,
      target: target.trim() ? targetNum : null,
      subjectId: subjectId || null,
    });
    onDone();
  };

  return <div className="quick-add-box ctr-form">
    <input type="text" placeholder={t('ctr.namePh')} aria-label={t('ctr.name')} value={name}
      onChange={(e) => setName(e.target.value)} {...enterSubmit(save)} autoFocus/>
    <div className="ctr-form-row">
      <span className="ctr-form-label">{t('ctr.unit')}</span>
      <div className="ctr-chips">
        {UNIT_PRESETS.map((u) => {
          const label = t(`ctr.unit_${u}`);
          return <button key={u} type="button" className={unit === label ? 'btn btn-sm' : 'btn-outline btn-sm'}
            aria-pressed={unit === label} onClick={() => setUnit(label)}>{label}</button>;
        })}
        <input type="text" className="ctr-unit-input" aria-label={t('ctr.unitCustom')} maxLength={24}
          value={UNIT_PRESETS.some((u) => t(`ctr.unit_${u}`) === unit) ? '' : unit}
          placeholder={t('ctr.unitCustom')} onChange={(e) => setUnit(e.target.value)}/>
      </div>
    </div>
    <div className="ctr-form-row">
      <span className="ctr-form-label">{t('ctr.period')}</span>
      <div className="ctr-chips" role="radiogroup" aria-label={t('ctr.period')}>
        {PERIODS.map((p) => <button key={p} type="button" role="radio" aria-checked={period === p}
          className={period === p ? 'btn btn-sm' : 'btn-outline btn-sm'} onClick={() => setPeriod(p)}>{t(`ctr.period_${p}`)}</button>)}
      </div>
    </div>
    <div className="ctr-form-row ctr-form-row--split">
      <input type="text" inputMode="decimal" placeholder={t('ctr.targetPh')} aria-label={t('ctr.target')}
        value={target} onChange={(e) => setTarget(e.target.value)}/>
      {courses.length > 0 && <select value={subjectId} aria-label={t('ctr.course')} onChange={(e) => setSubjectId(e.target.value)}>
        <option value="">{t('ctr.noCourse')}</option>
        {courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>}
    </div>
    <div className="ctr-form-actions">
      <button type="button" className="btn btn-sm" onClick={save} disabled={!valid}>{t('ctr.save')}</button>
      <button type="button" className="btn-outline btn-sm" onClick={onDone}>{t('ctr.cancel')}</button>
      {initial && (confirmDelete
        ? <button type="button" className="ctr-delete is-confirm" onClick={async () => { await removeCounter(initial.id); onDone(); }}>
            {t('ctr.deleteConfirm', { name: initial.name })}
          </button>
        : <button type="button" className="ctr-delete" onClick={() => setConfirmDelete(true)}>{t('ctr.delete')}</button>)}
    </div>
  </div>;
}

export default function CountersPanel({ state }) {
  const { t } = useTranslation();
  const data = useSyncExternalStore(subscribeCounters, getCounters);
  const [editing, setEditing] = useState(null); // null | 'new' | counter id
  useEffect(() => {
    if (pulledThisRun) return;
    pulledThisRun = true;
    void refreshCounters();
  }, []);

  const today = todayStudyDayKey(preferredDayStart());
  const counters = liveCounters(data.counters);
  const courses = Object.values(state.courses || {}).filter((c) => !c.deletedAt && !c.archivedAt);
  const periodNote = { total: t('ctr.soFar'), day: t('ctr.today'), week: t('ctr.thisWeek') };

  return <section className="ctr" aria-label={t('ctr.title')}>
    <div className="section-label">
      {t('ctr.title')}
      {editing !== 'new' && <button type="button" className="btn-outline btn-sm" onClick={() => setEditing('new')}>{t('ctr.add')}</button>}
    </div>
    {editing === 'new' && <CounterForm courses={courses} onDone={() => setEditing(null)}/>}
    {counters.length === 0 && editing !== 'new' && <p className="ctr-empty">{t('ctr.empty')}</p>}
    {counters.map((c) => {
      if (editing === c.id) return <CounterForm key={c.id} initial={c} courses={courses} onDone={() => setEditing(null)}/>;
      const value = counterValue(c, data.days, today);
      const progress = counterProgress(c, value);
      const course = c.subjectId ? state.courses?.[c.subjectId] : null;
      const step = stepFor(c);
      const done = progress === 1;
      return <div key={c.id} className={'ctr-row' + (done ? ' is-done' : '')}>
        <button type="button" className="ctr-name" onClick={() => setEditing(c.id)} title={t('ctr.edit')}>
          {course && <span className="ctr-dot" style={{ background: course.color || 'var(--border2)' }} aria-hidden="true"/>}
          <span className="ctr-name-text">{c.name}</span>
          <span className="ctr-period">{periodNote[c.period]}</span>
        </button>
        <div className="ctr-count" aria-live="polite">
          <span className="ctr-value">{fmt(value)}</span>
          <span className="ctr-unit">{c.target ? `/ ${fmt(c.target)} ${c.unit}` : c.unit}</span>
        </div>
        <div className="ctr-keys">
          <button type="button" className="ctr-key" aria-label={t('ctr.minus', { step: fmt(step), unit: c.unit })}
            onClick={() => void bump(c.id, today, -step)}>−</button>
          <button type="button" className="ctr-key ctr-key--plus" aria-label={t('ctr.plus', { step: fmt(step), unit: c.unit })}
            onClick={() => void bump(c.id, today, step)}>+</button>
        </div>
        {progress != null && <div className="ctr-rule" aria-hidden="true"><span style={{ width: `${progress * 100}%` }}/></div>}
      </div>;
    })}
  </section>;
}
