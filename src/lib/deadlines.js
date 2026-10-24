// Deadline arithmetic shared by the plan views and the reminder scheduler.
import { parseLocalDate, addDays } from "./dates.js";
import { DIFFICULTY_DAYS } from "./examDifficulty.js";

// Local midnight for "today", computed PER CALL — never frozen at module load.
// A Capacitor WebView backgrounded overnight and resumed without a cold restart
// would otherwise still think it's yesterday, mis-bucketing an assignment due
// "today" into "later" and staling every due-date urgency calc.
function todayMidnight(){ const d = new Date(); d.setHours(0,0,0,0); return d; }
export function daysUntil(s){ if(!s) return null; return Math.round((parseLocalDate(s)-todayMidnight())/86400000); }
export function urgencyColor(d){ if(d===null) return "#aaa"; if(d<0) return "#c0392b"; if(d<=2) return "#c0392b"; if(d<=7) return "#d4860a"; return "#2e7d52"; }
export function urgencyLabel(d, t){ if(d===null||!t) return ""; if(d<0) return t('av.urgency.overdue',{n:Math.abs(d)}); if(d===0) return t('av.urgency.dueToday'); if(d===1) return t('av.urgency.dueTomorrow'); return t('av.urgency.daysLeft',{n:d}); }
// v1.18.1 (StudyDesk#148): an exam's date may be cleared (exams.due_date is
// nullable), and addDays(null) threw, taking the Plan tab down on every device
// that pulled the row. No date, no study start.
export function studyStartDate(e){ if(!e?.dueDate) return null; return addDays(e.dueDate,-DIFFICULTY_DAYS[e.difficulty||"medium"]); }

// v1.19 (#154, quick win) — which exams Next Up suggests, and when to start
// studying for each. Every exam already has a study start derived from its
// difficulty; it only drove a reminder. Next Up showed the exam day alone, so
// with exams close together nothing said which one to start first. Ordered
// by study start (then exam day), capped like before. An exam is a Today item
// once its study start has come, or when it is three days out (as before).
export function examStudyPlan(exams, limit = 3){
  return (exams||[])
    .filter(e=>!e.done&&!e.deletedAt&&e.dueDate&&daysUntil(e.dueDate)>-1)
    .map(e=>{ const start=studyStartDate(e); const startIn=daysUntil(start); const dueIn=daysUntil(e.dueDate);
      const bucket=(startIn<=0||dueIn<=3)?"today":startIn<=7?"this_week":"later";
      return { exam:e, start, startIn, dueIn, bucket }; })
    .sort((a,b)=>(a.start<b.start?-1:a.start>b.start?1:0)||(a.exam.dueDate<b.exam.dueDate?-1:a.exam.dueDate>b.exam.dueDate?1:0))
    .slice(0,limit);
}
