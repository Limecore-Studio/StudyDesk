// v1.18.2 — keeps the grade scale in step with user_preferences.grade_scale,
// so NCC shows the GPA on the scale StudyDesk uses. See lib/gradeScaleCloud.js.
import { useEffect, useRef } from "react";
import { onLocalScaleChange, onScaleRefused, syncGradeScaleOnSignIn } from "../lib/gradeScaleCloud.js";

export function useGradeScaleSync(state, dispatch, userId, showFlash, t) {
  // StudyDesk#233: a save the server refuses is shown once, not only logged.
  useEffect(() => onScaleRefused(() => showFlash(t("gv.scaleUnsaved"))), [showFlash, t]);

  const latest = useRef({ mode: state.gradeMode, custom: state.customScale });
  useEffect(() => {
    latest.current = { mode: state.gradeMode, custom: state.customScale };
  });

  // Once per account (and once for "no account").
  useEffect(() => {
    let cancelled = false;
    void syncGradeScaleOnSignIn(userId ?? null, latest.current, (mode, custom) => {
      if (cancelled) return;
      if (mode === "custom" && custom) dispatch({ type: "SET_CUSTOM_SCALE", scale: custom });
      dispatch({ type: "SET_GRADE_MODE", mode });
    });
    return () => { cancelled = true; };
  }, [userId, dispatch]);

  // Every change after that.
  useEffect(() => {
    onLocalScaleChange(state.gradeMode, state.customScale, userId ?? null);
  }, [state.gradeMode, state.customScale, userId]);
}
