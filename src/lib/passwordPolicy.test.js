import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { checkPassword, meetsPasswordRule, weakPasswordReasons, PASSWORD_MIN_LENGTH } from './passwordPolicy.js';
import { translateAuthError } from './authErrors.js';

// v1.20 (limecore#73)

const t = (key, opts) => `<${key}${opts?.n ? `:${opts.n}` : ''}>`;
const failing = (pw) => checkPassword(pw).filter((r) => !r.ok).map((r) => r.id);

describe('password rule', () => {
  it('matches the server: 10 characters', () => {
    expect(PASSWORD_MIN_LENGTH).toBe(10);
  });

  it('ticks each item for a sample of passwords', () => {
    expect(failing('')).toEqual(['length', 'lower', 'upper', 'digit', 'symbol']);
    expect(failing('password')).toEqual(['length', 'upper', 'digit', 'symbol']);
    expect(failing('Password12')).toEqual(['symbol']);
    expect(failing('Pa1!')).toEqual(['length']);
    expect(failing('Password1!')).toEqual([]);
    expect(meetsPasswordRule('Password1!')).toBe(true);
  });

  it("counts only the server's symbols", () => {
    expect(failing('Passwörd12')).toEqual(['symbol']);
    expect(failing('Password 12')).toEqual(['symbol']);
    expect(failing('Password1\\')).toEqual([]);
  });

  it('no new-password field keeps the old minimum of 6', () => {
    for (const f of ['../features/auth/AuthGate.jsx', '../features/auth/SetPasswordScreen.jsx']) {
      const src = readFileSync(new URL(f, import.meta.url), 'utf8');
      expect(src).not.toMatch(/minLength=\{6\}|MIN_LENGTH = 6/);
    }
  });
});

describe('weak_password from the server', () => {
  it('reads the reasons supabase-js passes', () => {
    expect(weakPasswordReasons({ reasons: ['length', 'characters'] })).toEqual(['length', 'characters']);
  });

  it("falls back to GoTrue's message", () => {
    expect(weakPasswordReasons({ message: 'Password should be at least 10 characters.' })).toEqual(['length']);
    expect(weakPasswordReasons({ message: 'Password should contain at least one character of each: abc, ABC, 012, !@#.' }))
      .toEqual(['characters']);
    expect(weakPasswordReasons({ message: 'Password is known to be weak and easy to guess, please choose a different one.' }))
      .toEqual(['pwned']);
  });

  it('maps every reason to its message', () => {
    const err = (reasons) => ({ code: 'weak_password', reasons, message: 'x' });
    expect(translateAuthError(err(['length']), t)).toBe('<auth.pwReasonLength:10>');
    expect(translateAuthError(err(['characters']), t)).toBe('<auth.pwReasonCharacters:10>');
    expect(translateAuthError(err(['pwned']), t)).toBe('<auth.pwReasonPwned:10>');
    expect(translateAuthError(err(['length', 'characters']), t)).toBe('<auth.pwReasonLength:10> <auth.pwReasonCharacters:10>');
  });

  it('states the whole rule when the server gives no reason', () => {
    expect(translateAuthError({ code: 'weak_password', reasons: [], message: '' }, t)).toBe('<auth.pwReasonLength:10> <auth.pwReasonCharacters:10>');
  });

  it('leaves same_password alone', () => {
    const e = { code: 'same_password', message: 'New password should be different from the old password.' };
    expect(translateAuthError(e, t)).toBe(e.message);
  });
});

describe('password strings (loaded on demand)', () => {
  const all = JSON.parse(readFileSync(new URL('../i18n/passwordStrings.json', import.meta.url), 'utf8'));
  it('every app language has every key, with the length placeholder kept', () => {
    const keys = Object.keys(all.en).sort();
    expect(Object.keys(all).sort()).toEqual(['ar', 'de', 'en', 'es', 'fi', 'fr', 'hi', 'id', 'pt', 'zh']);
    for (const [lng, strings] of Object.entries(all)) {
      expect([lng, Object.keys(strings).sort()]).toEqual([lng, keys]);
      expect([lng, strings.pwRuleLength]).toEqual([lng, expect.stringContaining('{{n}}')]);
      expect([lng, strings.pwReasonLength]).toEqual([lng, expect.stringContaining('{{n}}')]);
    }
  });
});
