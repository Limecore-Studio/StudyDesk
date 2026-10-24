// The add-exam modal, out of CourseModals.jsx since v1.19 (#158) so App can
// load it on demand: its repeat (planRepeat.js and the timetable helpers that
// works out the term's end) would otherwise sit in the startup bundle, which
// has no room for it under the 725 KiB budget. Markup as before, plus Repeat.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DIFFICULTY_DAYS, DIFFICULTY_COLORS } from '../../lib/examDifficulty.js';
import { addDays, fmtDateFull } from '../../lib/dates.js';
import DateInput from '../../lib/DateInput.jsx';
import { REPEAT_WEEK_CHOICES, MAX_OCCURRENCES, repeatHorizon, occurrenceDates } from '../../lib/planRepeat.js';

export default function AddExamModal({ courses, activeCourse, terms, onAdd, onClose }) {
  const { t } = useTranslation();
  const [title,setTitle]=useState(""); const [courseId,setCourse]=useState(activeCourse||(courses[0]?.id??"")); const [dueDate,setDueDate]=useState(""); const [difficulty,setDiff]=useState("medium"); const [notes,setNotes]=useState("");
  // v1.19 (#158) — recurring exams (a weekly mock test). Materialised like a
  // repeating study plan (planRepeat.js): one ordinary exam per date, each
  // with its own topics, score and difficulty. The end date defaults to the
  // end of the term the first exam is in, and the count shows before saving.
  const [repeatWeeks,setRepeatWeeks]=useState(0); const [until,setUntil]=useState("");
  const untilEff = until && until >= dueDate ? until : (dueDate ? repeatHorizon(dueDate, terms) : "");
  const dates = !dueDate ? [] : repeatWeeks ? occurrenceDates(dueDate, repeatWeeks, untilEff) : [dueDate];
  const submit=()=>{ if(!title.trim()||!courseId||!dueDate) return; onAdd({title:title.trim(),courseId,dueDate,difficulty,notes,dates}); };
  return <div className="modal-overlay" role="dialog" aria-modal="true" aria-label={t('av.md.addExam')} onClick={onClose}><div className="modal" onClick={e=>e.stopPropagation()}>
    <div className="modal-title">{t('av.md.addExam')}</div>
    <div className="input-group"><div className="input-label">{t('av.md.examSubject')}</div><input type="text" placeholder={t('av.md.examTitlePh')} value={title} onChange={e=>setTitle(e.target.value)} autoFocus/></div>
    <div className="modal-grid">
      <div className="input-group"><div className="input-label">{t('av.md.course')}</div><select value={courseId} onChange={e=>setCourse(e.target.value)}>{courses.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
      <div className="input-group"><div className="input-label">{t('av.md.examDate')}</div><DateInput type="date" value={dueDate} onChange={e=>setDueDate(e.target.value)}/></div>
    </div>
    <div className="modal-grid">
      <div className="input-group"><div className="input-label">{t('cal.planRepeat')}</div><select value={String(repeatWeeks)} onChange={e=>setRepeatWeeks(Number(e.target.value))}>
        <option value="0">{t('cal.planRepeatNone')}</option>
        {REPEAT_WEEK_CHOICES.map(n=><option key={n} value={n}>{n===1?t('cm.everyWeek'):t('cm.everyNWeeks',{count:n})}</option>)}
      </select></div>
      <div className="input-group"><div className="input-label">{t('av.md.repeatUntil')}</div><DateInput type="date" value={repeatWeeks?untilEff:""} min={dueDate||undefined} disabled={!repeatWeeks||!dueDate} onChange={e=>setUntil(e.target.value)}/></div>
    </div>
    {repeatWeeks>0&&dueDate&&<div style={{fontFamily:"var(--font-mono)",fontSize:11,color:"var(--muted)",marginBottom:12}}>
      {t('av.md.examRepeatSummary',{count:dates.length,until:fmtDateFull(dates[dates.length-1])})}{dates.length>=MAX_OCCURRENCES?` ${t('cal.planRepeatCapped',{max:MAX_OCCURRENCES})}`:""}
    </div>}
    <div className="input-group"><div className="input-label">{t('av.md.difficultyLabel')}</div>
      <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
        {["easy","medium","hard","brutal"].map(d=>(
          <span key={d} className="difficulty-pill" style={{background:difficulty===d?DIFFICULTY_COLORS[d]+"18":"transparent",color:difficulty===d?DIFFICULTY_COLORS[d]:"var(--muted2)",borderColor:difficulty===d?DIFFICULTY_COLORS[d]:"var(--border2)",padding:"6px 14px",fontSize:12}} onClick={()=>setDiff(d)}>
            {t(`av.difficulty.${d}`)} <span style={{opacity:0.6,fontSize:10}}>({DIFFICULTY_DAYS[d]}d)</span>
          </span>
        ))}
      </div>
    </div>
    {dueDate&&<div style={{fontFamily:"var(--font-mono)",fontSize:11,color:"var(--muted)",marginBottom:12,padding:"8px 12px",background:"var(--surface2)",borderRadius:4}}>
      📚 {t('av.ec.studyStart')} <strong>{fmtDateFull(addDays(dueDate,-DIFFICULTY_DAYS[difficulty]))}</strong>
    </div>}
    <div className="input-group"><div className="input-label">{t('av.md.notesOpt')}</div><textarea placeholder={t('av.md.examNotesPh')} value={notes} onChange={e=>setNotes(e.target.value)} style={{minHeight:60}}/></div>
    <div style={{display:"flex",gap:8,marginTop:4}}><button className="btn" onClick={submit}>{t('av.md.addExam')}</button><button className="btn-outline" onClick={onClose}>{t('common.cancel')}</button></div>
  </div></div>;
}
