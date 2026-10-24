// v1.19 (#186) — every date, time and date-time field in the app goes through
// this, so none of them depends on Android's native picker opening.
//
// It renders the same native <input> as before: on a phone where the picker
// works, nothing changes. When a second tap reaches the field with no value
// change since the first (see pickerFallback.js for why that means the native
// picker never opened), an in-app sheet opens instead, and from then on this
// device goes straight to the sheet for that kind of field.
//
// `onChange` is called with `{ target: { value } }` from the sheet, so the
// existing `e => setX(e.target.value)` handlers work unchanged.

import { lazy, Suspense, useRef, useState } from 'react';
import { isRepeatTap, markNativePickerBroken, nativePickerBroken } from './pickerFallback.js';

// The sheet itself loads on first use; see DateInputSheet.jsx.
const PickerSheet = lazy(() => import('./DateInputSheet.jsx'));

export default function DateInput({ type = 'date', value, onChange, min, max, step, disabled, onClick, ...rest }) {
  const [open, setOpen] = useState(false);
  const lastTap = useRef(null);

  const handleClick = (e) => {
    onClick?.(e);
    if (disabled) return;
    const now = Date.now();
    if (nativePickerBroken(type)) {
      // Known dead on this device: skip the native attempt entirely.
      e.preventDefault();
      setOpen(true);
      return;
    }
    if (isRepeatTap(lastTap.current, now)) {
      e.preventDefault();
      markNativePickerBroken(type);
      lastTap.current = null;
      setOpen(true);
      return;
    }
    lastTap.current = { at: now, changed: false };
  };

  const handleChange = (e) => {
    if (lastTap.current) lastTap.current.changed = true;
    onChange?.(e);
  };

  return <>
    <input
      {...rest}
      type={type}
      value={value}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      onClick={handleClick}
      onChange={handleChange}
    />
    {open && <Suspense fallback={null}><PickerSheet
      type={type}
      value={value || ''}
      min={min}
      max={max}
      step={step}
      onCancel={() => setOpen(false)}
      onSet={(v) => { setOpen(false); onChange?.({ target: { value: v }, currentTarget: { value: v } }); }}
    /></Suspense>}
  </>;
}
