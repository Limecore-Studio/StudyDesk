import { describe, it, expect } from 'vitest';
import { findSecrets, jwtRole, shouldScan } from '../scripts/check-secrets.mjs';

// v1.22 (limecore#109) — the scanner catches a service_role JWT and an
// sb_secret_ key, and scans android/. Tokens are built at run time, so this
// file holds no secret-shaped literal of its own.

const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (payload) => `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url(payload)}.${'s'.repeat(43)}`;

describe('check-secrets', () => {
  it('flags a Supabase service_role JWT (a real-sized 36-char header)', () => {
    const token = jwt({ iss: 'supabase', ref: 'abcdefghijklmnopqrst', role: 'service_role', iat: 1, exp: 2 });
    expect(jwtRole(token)).toBe('service_role');
    const found = findSecrets(`const k = "${token}";`);
    expect(found).toHaveLength(1);
    expect(found[0].kind).toMatch(/service_role/);
  });

  it('lets the anon (publishable) key through', () => {
    const token = jwt({ iss: 'supabase', ref: 'abcdefghijklmnopqrst', role: 'anon', iat: 1, exp: 2 });
    expect(findSecrets(`const k = "${token}";`)).toEqual([]);
  });

  it('flags an sb_secret_ key', () => {
    const key = 'sb_' + 'secret_' + 'A1b2C3d4E5f6G7h8I9j0K1l2';
    expect(findSecrets(`x ${key}`).map((f) => f.kind)).toContain('Supabase secret key');
  });

  it('scans android/ sources but not its build outputs or binaries', () => {
    expect(shouldScan('android/app/src/main/java/com/studydesk/app/MainActivity.java')).toBe(true);
    expect(shouldScan('android/app/build.gradle')).toBe(true);
    expect(shouldScan('android/app/build/intermediates/x.txt')).toBe(false);
    expect(shouldScan('android/build/x.txt')).toBe(false);
    expect(shouldScan('android/app/release.keystore')).toBe(false);
  });
});
