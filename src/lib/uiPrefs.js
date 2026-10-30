// v1.20 (StudyDesk#159) — UI size, per device.
//
// index.html applies it before the first paint (its second pre-paint pass);
// this module owns every change after that. The storage key is the contract
// between them — change it in both places.
//
// Size is CSS zoom on the root element, because StudyDesk's stylesheets are
// px throughout and a root font-size would move almost nothing. Zoom scales
// vh and vw too, so every viewport-sized rule divides by --ui-zoom (set here
// and in index.html) to stay one screen tall.

export const UI_SCALES = [0.9, 1, 1.1, 1.25];
const SCALE_KEY = 'studydesk.uiScale';

export function preferredUiScale() {
  try {
    const v = parseFloat(localStorage.getItem(SCALE_KEY));
    return UI_SCALES.includes(v) ? v : 1;
  } catch {
    return 1;
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

export function setUiScale(scale) {
  const next = UI_SCALES.includes(scale) ? scale : 1;
  try {
    if (next === 1) localStorage.removeItem(SCALE_KEY);
    else localStorage.setItem(SCALE_KEY, String(next));
  } catch { /* private mode: applies for this session only */ }
  applyUiScale(next);
}
