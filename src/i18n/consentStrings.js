// v1.21.1 (limecore#87) — the opt-in question and its Settings switch, loaded
// with the screens that use them instead of at startup (en.json is in the
// startup bundle, which is at its budget). Same mechanism as
// passwordStrings.js; import this module for its side effect from any file
// that uses a `consent.*` key. keys.test.js counts these keys as present.
import i18n from 'i18next';
import STRINGS from './consentStrings.json';

function register(lng) {
  const strings = STRINGS[lng];
  if (!strings || !i18n.hasResourceBundle(lng, 'translation')) return;
  i18n.addResourceBundle(lng, 'translation', { consent: strings }, true, true);
}

const registerAll = () => Object.keys(STRINGS).forEach(register);
if (i18n.isInitialized) registerAll();
else i18n.on('initialized', registerAll);
i18n.on('languageChanged', register);
