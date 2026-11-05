// v1.20 (limecore#71) — the one-time card that offers error reports.
//
// App.jsx renders this for a signed-in, onboarded, non-guest user and nothing
// else; it is loaded on demand because the startup bundle has no room. It
// counts the launch and decides for itself (lib/reportPrompt.js), and shows
// the card a few seconds in, so it never lands on top of the first screen.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { answerReportPrompt, noteSignedInLaunch, shouldAskForReports } from '../../lib/reportPrompt.js';

const SHOW_AFTER_MS = 4000;

const css = `
.rp-card{position:fixed;inset-inline-end:24px;bottom:24px;z-index:210;width:min(380px,calc(calc(100vw / var(--ui-zoom, 1)) - 32px));
  background:var(--surface);border:1px solid var(--border2);border-radius:6px;box-shadow:var(--shadow);padding:16px 18px 14px;animation:fadeup 0.2s ease;}
.rp-title{font-family:var(--font-display);font-size:17px;color:var(--text);margin:0 0 6px;}
.rp-body{font-size:13px;line-height:1.5;color:var(--muted);margin:0 0 14px;}
.rp-actions{display:flex;gap:8px;justify-content:flex-end;}
@media (max-width:768px){.rp-card{inset-inline:16px;bottom:calc(76px + env(safe-area-inset-bottom, 0px));width:auto;}}
`;

export default function ReportPromptCard() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    noteSignedInLaunch();
    if (!shouldAskForReports()) return undefined;
    const id = setTimeout(() => setOpen(true), SHOW_AFTER_MS);
    return () => clearTimeout(id);
  }, []);

  if (!open) return null;
  const answer = (yes) => { answerReportPrompt(yes); setOpen(false); };
  return (
    <div className="rp-card" role="dialog" aria-labelledby="rp-title">
      <style>{css}</style>
      <h2 id="rp-title" className="rp-title">{t('reportPrompt.title')}</h2>
      <p className="rp-body">{t('reportPrompt.body')}</p>
      <div className="rp-actions">
        <button className="btn-outline" onClick={() => answer(false)}>{t('reportPrompt.notNow')}</button>
        <button className="btn" onClick={() => answer(true)}>{t('reportPrompt.yes')}</button>
      </div>
    </div>
  );
}
