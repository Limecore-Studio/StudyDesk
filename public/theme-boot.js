// Pre-paint passes, run before the stylesheet paints. Moved out of an inline
// <script> in index.html in v1.22 (limecore#99) so the web build's
// Content-Security-Policy can be script-src 'self' (vercel.json). Still a
// classic, synchronous script in the same place in <head>, so it still runs
// before first paint.
/* ── Pre-paint theme/mode pass (v1.13) ──────────────────────────────
   Runs BEFORE the stylesheet paints so a dark-mode user never sees a
   frame of cream. That flash is not cosmetic: on an AMOLED phone at
   night a full-brightness cream page for one frame is genuinely
   unpleasant, and it is the single most common complaint about apps
   that resolve their theme in React instead of here.

   Deliberately duplicated logic rather than an import: this must be
   synchronous and inline, and a module import is neither. The two
   storage keys are the contract between this block and
   src/lib/theme.js — change them in both places. theme.js owns every
   change after this point and is otherwise the only writer.

   The entitlement check is a CACHE READ ONLY (see readCachedEntitlement
   in src/lib/entitlement.js). It cannot hit the network here, so a
   supporter whose cache has expired gets cream for one paint and their
   theme back a moment later when syncTheme() runs. That is the correct
   trade: a paid theme is cosmetic, and blocking first paint on a
   network round trip to check a cosmetic perk is not.

   Wrapped in try/catch in full: a private-mode browser that throws on
   localStorage access must still render the app, in cream, rather than
   a blank page. */
(function () {
  try {
    var THEMES = ['stacks', 'slate'];
    var MODES = ['dark', 'black'];
    var el = document.documentElement;

    var theme = localStorage.getItem('studydesk.theme');
    if (THEMES.indexOf(theme) === -1) theme = 'free';

    // A paid theme only applies while the cached entitlement window is
    // open. Mirrors isEntitled(): a lifetime grant outranks the clock.
    if (theme !== 'free') {
      var ok = false;
      try {
        var rec = JSON.parse(localStorage.getItem('studydesk.entitlement') || 'null');
        if (rec && typeof rec === 'object') {
          if (rec.lifetime === true) ok = true;
          else if (rec.expiresAt) {
            var exp = Date.parse(rec.expiresAt);
            ok = !isNaN(exp) && exp > Date.now();
          }
        }
      } catch { ok = false; }
      if (!ok) theme = 'free';
    }

    if (theme !== 'free') el.dataset.theme = theme;

    // Mode is free and applies to the free theme only — a paid theme
    // carries its own lighting. Same rule as activeMode() in theme.js.
    if (theme === 'free') {
      var mode = localStorage.getItem('studydesk.mode');
      if (MODES.indexOf(mode) !== -1) el.dataset.mode = mode;
    }
  } catch {
    /* storage unavailable — free light theme, which is the default */
  }
})();
/* ── Pre-paint UI size (v1.20, StudyDesk#159) ──────────────────────
   Same reason as the pass above: applied before the first paint, so
   the page never jumps from one size to another. The key is
   a contract with src/lib/uiPrefs.js, which owns every later change.
   Size is CSS zoom on the root (the stylesheets are px throughout);
   --ui-zoom lets every viewport-sized rule divide it back out, because
   zoom scales vh and vw too. */
(function () {
  try {
    var el = document.documentElement;
    var scale = parseFloat(localStorage.getItem('studydesk.uiScale'));
    if ([0.9, 1.1, 1.25].indexOf(scale) !== -1) {
      el.style.zoom = String(scale);
      el.style.setProperty('--ui-zoom', String(scale));
    }
  } catch {
    /* storage unavailable — default size */
  }
})();
