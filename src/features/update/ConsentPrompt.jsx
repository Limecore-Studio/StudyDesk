// v1.21.1 (limecore#87) — the one-time question for the two opt-in features:
// the app-open records (asked once signed in) and the F-Droid update check
// (asked on first launch, Android only). Both stay off until the answer is yes;
// Settings changes the answer later. See lib/consent.js.
//
// The same paper card as the F-Droid note, inline at the top of the page: a
// question, not an interruption. One question at a time, so each yes or no is
// about one thing. Loaded only while a question is pending.
import { useTranslation } from 'react-i18next';
import '../../i18n/consentStrings.js';
import { useEffect, useState } from 'react';
import { readConsent } from '../../lib/consent.js';
import { setConsent } from '../../lib/consentWrite.js';
import { setUpdateCheckEnabled } from '../../lib/fdroidUpdate.js';

// App mounts this when a question is pending; it hides itself once answered.
export default function ConsentPrompt({ askOpens, askUpdate }) {
  const { t } = useTranslation();
  const [, rerender] = useState(0);
  useEffect(() => {
    const onConsent = () => rerender((n) => n + 1);
    window.addEventListener('studydesk:consent', onConsent);
    return () => window.removeEventListener('studydesk:consent', onConsent);
  }, []);
  const consent = readConsent();
  const which = askOpens && consent.opens === undefined ? 'opens'
    : askUpdate && consent.update === undefined ? 'update' : null;
  if (!which) return null;
  const answer = (yes) => {
    if (which === 'update') setUpdateCheckEnabled(yes);
    else setConsent({ opens: yes });
  };

  return (
    <aside className="upd-note" aria-labelledby="consent-q">
      <div className="upd-note-eyebrow">{t('consent.eyebrow')}</div>
      <div className="upd-note-title" id="consent-q">{t(`consent.${which}Q`)}</div>
      <p className="consent-note">{t(`consent.${which}Note`)}</p>
      <div className="upd-note-actions">
        <button type="button" className="btn" onClick={() => answer(true)}>{t('consent.yes')}</button>
        <button type="button" className="upd-note-later" onClick={() => answer(false)}>{t('consent.no')}</button>
      </div>
    </aside>
  );
}
