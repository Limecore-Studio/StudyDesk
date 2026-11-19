// StudyDesk#260 — "StudyDesk syncs to your computer too", once per account.
//
// The same inline margin note as the F-Droid update (cards.css .upd-note):
// it sits above the day's work rather than over it, and one tap puts it away
// for good. Following either link counts as seen too.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { WEB_APP_URL, DESKTOP_DOWNLOAD_URL, shouldShowComputerNote, markComputerNoteSeen } from '../../lib/computerApps.js';

export default function ComputerAppsNote({ user, hasData }) {
  const { t } = useTranslation();
  const [show, setShow] = useState(() => shouldShowComputerNote(user, { hasData }));
  if (!show) return null;
  const done = () => { markComputerNoteSeen(user.id); setShow(false); };
  return (
    <aside className="upd-note" aria-label={t('computer.title')}>
      <div className="upd-note-eyebrow">{t('computer.eyebrow')}</div>
      <div className="upd-note-title">{t('computer.title')}</div>
      <p className="upd-note-body">{t('computer.body')}</p>
      <div className="upd-note-actions">
        <a className="btn" href={WEB_APP_URL} target="_blank" rel="noopener noreferrer" onClick={done}>
          {t('computer.web')}
        </a>
        <a className="btn-outline" href={DESKTOP_DOWNLOAD_URL} target="_blank" rel="noopener noreferrer" onClick={done}>
          {t('computer.windows')}
        </a>
        <button type="button" className="upd-note-later" onClick={done}>
          {t('computer.dismiss')}
        </button>
      </div>
    </aside>
  );
}
