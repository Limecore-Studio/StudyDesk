// v1.20 (limecore#73) — the password-rule strings, loaded with the screens
// that use them instead of at startup.
//
// en.json is part of the startup bundle, which has a budget that only goes
// down (scripts/check-bundle-size.mjs). These strings are only ever needed on
// the sign-up and set-password screens, which load on demand, so they live in
// passwordStrings.json (all ten languages) and are merged into i18next when
// one of those screens loads. Import this module for its side effect from any
// file that uses an `auth.pw*` key; keys.test.js counts these keys as present.
//
// A language's own file must be loaded before its strings are merged:
// i18n/index.js skips loading any language that already has a bundle, so
// registering Finnish early would leave the rest of the app in English. Hence
// only languages that are already loaded, plus each one as it becomes active.
import i18n from 'i18next';
import STRINGS from './passwordStrings.json';

function register(lng) {
  const strings = STRINGS[lng];
  if (!strings || !i18n.hasResourceBundle(lng, 'translation')) return;
  i18n.addResourceBundle(lng, 'translation', { auth: strings }, true, true);
}

const registerAll = () => Object.keys(STRINGS).forEach(register);
// index.js initialises i18next at startup, long before this chunk loads; the
// event only matters where it has not run (unit tests).
if (i18n.isInitialized) registerAll();
else i18n.on('initialized', registerAll);
// A switch loads the bundle first, then changes language (index.js
// applyLanguage), so the bundle exists by the time this fires.
i18n.on('languageChanged', register);
