// v1.18.2 — keeps the grade scale in step with user_preferences.grade_scale,
// so NCC shows the GPA on the scale StudyDesk uses. See lib/gradeScaleCloud.js.
import { useEffect, useRef } from "react";

// v1.22 (limecore#126): the cloud half loads on demand; nothing here is on
// first paint. All three effects go through one cached import promise, so their
// calls still reach the module in the order the effects ran.
let cloudLoad = null;
function loadCloud() {
  cloudLoad ??= import("../lib/gradeScaleCloud.js").catch((e) => { cloudLoad = null; throw e; });
  return cloudLoad;
}
const warnLoad = (e) => console.warn("[studydesk] grade-scale sync failed to load:", e);

export function useGradeScaleSync(state, dispatch, userId, showFlash, t) {
  // StudyDesk#233: a save the server refuses is shown once, not only logged.
  useEffect(() => {
    loadCloud().then((m) => m.onScaleRefused(() => showFlash(t("gv.scaleUnsaved"))), warnLoad);
  }, [showFlash, t]);

  const latest = useRef({ mode: state.gradeMode, custom: state.customScale });
  useEffect(() => {
    latest.current = { mode: state.gradeMode, custom: state.customScale };
  });

  // Once per account (and once for "no account").
  useEffect(() => {
    let cancelled = false;
    const local = latest.current;
    loadCloud().then((m) => {
      void m.syncGradeScaleOnSignIn(userId ?? null, local, (mode, custom) => {
        if (cancelled) return;
        if (mode === "custom" && custom) dispatch({ type: "SET_CUSTOM_SCALE", scale: custom });
        dispatch({ type: "SET_GRADE_MODE", mode });
      });
    }, warnLoad);
    return () => { cancelled = true; };
  }, [userId, dispatch]);

  // Every change after that.
  useEffect(() => {
    const gradeMode = state.gradeMode, customScale = state.customScale;
    loadCloud().then((m) => m.onLocalScaleChange(gradeMode, customScale, userId ?? null), warnLoad);
  }, [state.gradeMode, state.customScale, userId]);
}
