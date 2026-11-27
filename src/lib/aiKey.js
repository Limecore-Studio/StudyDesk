// v1.22 (limecore#122, Design H) — where the user's own AI key lives.
//
// Kept apart from aiProvider.js on purpose: accountWipe imports this, and it
// sits in the startup bundle, while the request code loads only with the
// debrief sheet and Settings.
//
// The key is stored on this device in Preferences (SharedPreferences on
// Android, which data_extraction_rules.xml keeps out of backup and device
// transfer; localStorage on web and desktop). It is never synced, never sent
// anywhere but Google, and not in "Export my data" (dataRights.js lists what
// it exports by name). It belongs to whoever is using the app: sign-out,
// account deletion and a different account signing in clear it
// (accountWipe.js), so one person's key and consent never carry to the next.
import { Preferences } from '@capacitor/preferences';

/** Editable in Settings: when Google retires a model, a user on an old
 *  version can type the new name instead of waiting for an update. The 2.5
 *  models no longer serve new Google projects (limecore#60), and a key made
 *  today is a new project, so the default is a 3.x model. */
export const DEFAULT_AI_MODEL = 'gemini-3.5-flash-lite';

export const AI_KEY_PREF = 'apikey_gemini';
export const AI_MODEL_PREF = 'ai.model';

async function readPref(key) {
  try {
    return (await Preferences.get({ key })).value ?? null;
  } catch {
    try { return localStorage.getItem(key); } catch { return null; }
  }
}

async function writePref(key, value) {
  try {
    if (value == null) await Preferences.remove({ key });
    else await Preferences.set({ key, value });
  } catch {
    try {
      if (value == null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch { /* no storage */ }
  }
}

export const getAiKey = () => readPref(AI_KEY_PREF);
export const setAiKey = (key) => writePref(AI_KEY_PREF, String(key || '').trim() || null);
export const clearAiKey = () => writePref(AI_KEY_PREF, null);

export async function getAiModel() {
  return (await readPref(AI_MODEL_PREF))?.trim() || DEFAULT_AI_MODEL;
}
export const setAiModel = (model) => writePref(AI_MODEL_PREF, String(model || '').trim() || null);

/** The key and the model name both go: the next person starts from nothing. */
export async function clearAiSettings() {
  await writePref(AI_KEY_PREF, null);
  await writePref(AI_MODEL_PREF, null);
}
