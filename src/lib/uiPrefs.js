// v1.20 (StudyDesk#159) — UI size and body font, per device.
//
// index.html applies both before the first paint (its second pre-paint pass);
// this module owns every change after that. The two storage keys are the
// contract between them — change them in both places.
//
// Size is CSS zoom on the root element, because StudyDesk's stylesheets are
// px throughout and a root font-size would move almost nothing. Zoom scales
// vh and vw too, so every viewport-sized rule divides by --ui-zoom (set here
// and in index.html) to stay one screen tall.
//
// The font is Atkinson Hyperlegible or the default (DM Sans). Its stylesheet
// is only fetched when it is chosen.

export const UI_SCALES = [0.9, 1, 1.1, 1.25];
export const UI_FONTS = ['default', 'atkinson'];
const SCALE_KEY = 'studydesk.uiScale';
const FONT_KEY = 'studydesk.uiFont';
const FONT_LINK_ID = 'sd-font-atkinson';

export function preferredUiScale() {
  try {
    const v = parseFloat(localStorage.getItem(SCALE_KEY));
    return UI_SCALES.includes(v) ? v : 1;
  } catch {
    return 1;
  }
}

export function preferredUiFont() {
  try {
    return localStorage.getItem(FONT_KEY) === 'atkinson' ? 'atkinson' : 'default';
  } catch {
    return 'default';
  }
}

export function applyUiScale(scale = preferredUiScale()) {
  const el = document.documentElement;
  if (scale === 1) {
    el.style.removeProperty('zoom');
    el.style.removeProperty('--ui-zoom');
  } else {
    el.style.zoom = String(scale);
    el.style.setProperty('--ui-zoom', String(scale));
  }
}

/** Fetch Atkinson Hyperlegible's stylesheet, once. Also used by Settings so
 *  its tile can preview the font before it is chosen. */
export function loadFontSheet() {
  if (document.getElementById(FONT_LINK_ID)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/fonts/atkinson.css';
  link.id = FONT_LINK_ID;
  document.head.appendChild(link);
}

export function applyUiFont(font = preferredUiFont()) {
  const el = document.documentElement;
  if (font === 'atkinson') {
    loadFontSheet();
    el.dataset.font = 'atkinson';
  } else {
    delete el.dataset.font;
  }
}

export function setUiScale(scale) {
  const next = UI_SCALES.includes(scale) ? scale : 1;
  try {
    if (next === 1) localStorage.removeItem(SCALE_KEY);
    else localStorage.setItem(SCALE_KEY, String(next));
  } catch { /* private mode: applies for this session only */ }
  applyUiScale(next);
}

export function setUiFont(font) {
  const next = font === 'atkinson' ? 'atkinson' : 'default';
  try {
    if (next === 'default') localStorage.removeItem(FONT_KEY);
    else localStorage.setItem(FONT_KEY, next);
  } catch { /* private mode: applies for this session only */ }
  applyUiFont(next);
}
