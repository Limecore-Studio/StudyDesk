import { useTranslation } from 'react-i18next';
import { checkPassword, PASSWORD_MIN_LENGTH } from '../../lib/passwordPolicy.js';
import '../../i18n/passwordStrings.js'; // the auth.pw* strings (loaded on demand)

// v1.20 (limecore#73) — the password rule, shown before the server refuses it.
// Each item ticks as you type. `flagMissing` is set once a submit has failed on
// the rule, so the items still open are named in the danger colour instead of
// waiting quietly in grey; the submit button itself is never disabled (see
// SetPasswordScreen's header). Styles are in authCss (AuthGate.jsx).
const LABELS = {
  length: 'auth.pwRuleLength',
  lower: 'auth.pwRuleLower',
  upper: 'auth.pwRuleUpper',
  digit: 'auth.pwRuleDigit',
  symbol: 'auth.pwRuleSymbol',
};

export default function PasswordChecklist({ password, flagMissing = false, id }) {
  const { t } = useTranslation();
  return (
    <ul className="pw-rules" id={id} aria-label={t('auth.pwRulesLabel')}>
      {checkPassword(password).map(({ id: rule, ok }) => (
        <li key={rule} className={ok ? 'is-ok' : flagMissing ? 'is-missing' : ''}>
          <span className="pw-rules-mark" aria-hidden="true">{ok ? '✓' : '·'}</span>
          {t(LABELS[rule], { n: PASSWORD_MIN_LENGTH })}
          {ok && <span className="pw-rules-vh">{` — ${t('auth.pwRuleMet')}`}</span>}
        </li>
      ))}
    </ul>
  );
}
