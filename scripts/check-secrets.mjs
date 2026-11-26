#!/usr/bin/env node
// Pre-commit secret detector. Scans staged content for likely secrets and
// aborts the commit if any are found.
//
// Run manually:    node scripts/check-secrets.mjs
// Run via hook:    git config core.hooksPath .githooks   (one-time setup)
//
// Patterns:
//   1. High-confidence provider patterns (AWS, Stripe, GitHub, OpenAI, Anthropic)
//   2. Heuristic: any 24+ char alphanumeric string assigned to a name that
//      contains KEY / TOKEN / SECRET / PASSWORD / API
//
// Mainstream secret scanners (gitleaks, trufflehog) work exactly this way —
// they don't store literal known-leaked-strings, because that would either
// require re-leaking the bad value into the scanner itself or maintaining a
// hashed denylist. Provider patterns + heuristic catch ~all real cases.
//
// Suppression: end a line with `// pragma: allowlist secret` (or
// `# pragma: allowlist secret` in shell/yaml/etc.) to skip that one line.
// Use sparingly — every suppression is a foot-gun.
//
// Whitelist: src/lib/supabase.js is exempt because the Supabase publishable
// key (sb_publishable_… or eyJ… anon JWT) is public-by-design and lives in
// client code intentionally — that's how Supabase's RLS architecture works.

import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

// ── Patterns ──────────────────────────────────────────────────────────────

const PROVIDER_PATTERNS = [
  { name: 'AWS access key', re: /AKIA[0-9A-Z]{16}/g },
  { name: 'AWS session token', re: /ASIA[0-9A-Z]{16}/g },
  { name: 'Stripe live secret', re: /sk_live_[0-9a-zA-Z]{20,}/g },
  { name: 'Stripe live publishable', re: /pk_live_[0-9a-zA-Z]{20,}/g },
  { name: 'Stripe restricted', re: /rk_live_[0-9a-zA-Z]{20,}/g },
  { name: 'GitHub PAT', re: /ghp_[A-Za-z0-9]{30,}/g },
  { name: 'GitHub OAuth', re: /gho_[A-Za-z0-9]{30,}/g },
  { name: 'GitHub server', re: /ghs_[A-Za-z0-9]{30,}/g },
  { name: 'GitHub refresh', re: /ghr_[A-Za-z0-9]{30,}/g },
  { name: 'OpenAI key', re: /sk-(?:proj-)?[A-Za-z0-9_-]{40,}/g },
  { name: 'Anthropic key', re: /sk-ant-(?:api03-)?[A-Za-z0-9_-]{40,}/g },
  { name: 'Slack token', re: /xox[abprs]-[A-Za-z0-9-]{10,}/g },
  // GitLab tokens. The fdroiddata MRs are on GitLab, so a PAT pasted into a
  // note or a script is a live risk for this repo specifically.
  { name: 'GitLab PAT', re: /glpat-[A-Za-z0-9_.-]{20,}/g },
  { name: 'GitLab deploy/runner token', re: /gl(?:dt|rt|cbt|ptt)-[A-Za-z0-9_.-]{20,}/g },
  { name: 'Google API key', re: /AIza[0-9A-Za-z_-]{35}/g },
  // v1.22 (limecore#109): Supabase's new-style secret key. Full access,
  // bypasses RLS, never belongs in a repo.
  { name: 'Supabase secret key', re: /sb_secret_[A-Za-z0-9_-]{20,}/g },
];

// v1.22 (limecore#109) — JWTs. The old rule wanted a 200+ character header,
// and a real Supabase JWT header ({"alg":"HS256","typ":"JWT"}) is 36, so it
// could never match a service_role key. Now any JWT-shaped string is decoded
// and flagged unless its payload says role "anon" (the publishable key, which
// ships in every client on purpose). Undecodable counts as suspicious.
const JWT_RE = /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g;

export function jwtRole(token) {
  try {
    const part = token.split('.')[1];
    const json = Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    const role = JSON.parse(json).role;
    return typeof role === 'string' ? role : null;
  } catch {
    return null;
  }
}

// Generic "looks like an API key assigned to a key-shaped variable" detector.
// Matches: `FINNHUB_KEY = "..."`, `apiToken: "..."`, `password='...'`, etc.
// Requires the value to be 24+ chars of base62/base64 to keep false-positive
// rate low — UUIDs, version strings, and most legitimate identifiers don't
// match.
const HEURISTIC_RE =
  /(?<name>(?:[A-Z_]*(?:API|KEY|TOKEN|SECRET|PASSWORD|PASSWD|PWD|CREDENTIAL)[A-Z_]*|(?:apiKey|apiToken|authToken|accessToken|refreshToken|password|secret|credential)))\s*[:=]\s*['"](?<val>[A-Za-z0-9_+/=-]{24,})['"]/g;

// ── File-level exemptions ─────────────────────────────────────────────────

// Files where matches are tolerated because the values are public-by-design
// (e.g. Supabase publishable key, which is meant to ship in client bundles).
const FILE_ALLOWLIST = [
  // StudyDesk is plain JSX by design, so this is .js where the sibling apps
  // carry .ts. Both spellings are listed so the script stays a drop-in copy
  // across the three repos.
  'src/lib/supabase.js',
  'src/lib/supabase.ts',
];

// Suppress detection on lines that explicitly opt out. Mirrors the
// detect-secrets convention. End your line with one of these comments.
const SUPPRESS_RE = /(?:\/\/|#|--)\s*pragma:\s*allowlist\s+secret/;

// ── Staged diff ───────────────────────────────────────────────────────────

/** True when invoked as `check-secrets --all` (CI): scan every tracked file
 *  rather than the staged set. Without this the script is a no-op outside a
 *  commit — there is nothing staged in CI, so it would pass vacuously. */
const SCAN_ALL = process.argv.includes('--all');

function getStagedFiles() {
  try {
    const out = execSync(
      SCAN_ALL
        ? 'git ls-files'
        : 'git diff --cached --name-only --diff-filter=ACMR',
      { encoding: 'utf8' },
    );
    return out
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
  } catch (e) {
    console.error('check-secrets: could not list staged files:', e.message);
    process.exit(0); // don't block commits if git itself is broken
  }
}

function getStagedContent(file) {
  try {
    if (SCAN_ALL) return readFileSync(file, 'utf8');
    return execSync(`git show :"${file.replaceAll('"', '\\"')}"`, {
      encoding: 'utf8',
      maxBuffer: 50 * 1024 * 1024,
    });
  } catch {
    // Binary file or other non-text — skip.
    return null;
  }
}

// Skip files that aren't worth scanning (binaries, generated bundles, lock
// files which often contain incidental hex). Keep this conservative — a
// false negative here is a missed leak.
export function shouldScan(file) {
  if (FILE_ALLOWLIST.includes(file)) return false;
  // v1.22 (limecore#109): android/ is scanned (the Java plugins, the gradle
  // files, resources); only its build outputs are skipped.
  if (/^android\/(?:app\/)?build\//.test(file) || file.startsWith('android/.gradle/')) return false;
  if (file.startsWith('ios/')) return false;
  if (file.startsWith('dist/') || file.startsWith('build/')) return false;
  if (file.startsWith('node_modules/')) return false;
  if (/\.(png|jpg|jpeg|gif|webp|ico|svg|woff2?|ttf|otf|eot|pdf|zip|gz|tgz|7z|rar|mp3|mp4|mov|webm|avi|wasm|jar|aar|apk|keystore|jks)$/i.test(file)) {
    return false;
  }
  if (file === 'package-lock.json' || file === 'pnpm-lock.yaml' || file === 'yarn.lock') {
    return false;
  }
  return true;
}

// ── Scan one file ─────────────────────────────────────────────────────────

function scanFile(file) {
  const content = getStagedContent(file);
  if (!content) return [];
  return findSecrets(content, file);
}

/** Every finding in one file's text. Exported for the tests. */
export function findSecrets(content, file = '<text>') {
  const findings = [];
  const lines = content.split('\n');

  lines.forEach((line, idx) => {
    if (SUPPRESS_RE.test(line)) return;

    // 1. Provider patterns
    for (const { name, re } of PROVIDER_PATTERNS) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(line)) !== null) {
        findings.push({
          file,
          line: idx + 1,
          kind: name,
          excerpt: line.trim().slice(0, 120),
        });
      }
    }

    // 1b. JWTs whose role is not "anon".
    JWT_RE.lastIndex = 0;
    let j;
    while ((j = JWT_RE.exec(line)) !== null) {
      const role = jwtRole(j[0]);
      if (role === 'anon') continue;
      findings.push({
        file,
        line: idx + 1,
        kind: `JWT with role ${role ?? 'unknown'} (only the anon key may be committed)`,
        excerpt: line.trim().slice(0, 120),
      });
    }

    // 2. Heuristic key-shaped assignments. Skip if the value is an obvious
    // placeholder or common-looking version/url/uuid.
    HEURISTIC_RE.lastIndex = 0;
    let h;
    while ((h = HEURISTIC_RE.exec(line)) !== null) {
      const val = h.groups?.val ?? '';
      if (isObviousPlaceholder(val)) continue;
      findings.push({
        file,
        line: idx + 1,
        kind: `heuristic (${h.groups?.name})`,
        excerpt: line.trim().slice(0, 120),
      });
    }
  });

  return findings;
}

function isObviousPlaceholder(val) {
  const lower = val.toLowerCase();
  const placeholders = [
    'your-key-here',
    'replace-me',
    'changeme',
    'xxxxxxxxxxxx',
    'example',
    'placeholder',
    'todo',
    'fixme',
    'sample',
  ];
  if (placeholders.some((p) => lower.includes(p))) return true;
  // UUIDs are 36 chars with dashes in specific spots — never a secret.
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val)) return true;
  // Version strings like `1.2.3-beta.4` — too short anyway, but be explicit.
  if (/^\d+\.\d+\.\d+/.test(val)) return true;
  // Lowercase kebab-case identifiers — `limelog-body-metrics-prefs`, and every
  // other localStorage / Preferences key in these apps. They trip the heuristic
  // purely because the constant holding them is named *_KEY. A real credential
  // is high-entropy: base64 secrets carry mixed case, hex secrets carry no
  // hyphens, and UUIDs are already excluded above. An all-lowercase slug of
  // dictionary-ish words is a name, not a value.
  if (/^[a-z0-9]+(?:-[a-z0-9]+)+$/.test(val)) return true;
  // Same for snake_case and dotted identifiers (`wt_exercise_prs`,
  // `com.limecore.nexus.something`).
  if (/^[a-z0-9]+(?:[_.][a-z0-9]+)+$/.test(val)) return true;
  return false;
}

// ── Entry ─────────────────────────────────────────────────────────────────

// Run only as a script; the tests import the functions above.
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) main();

function main() {
const files = getStagedFiles().filter(shouldScan);
const findings = files.flatMap(scanFile);

if (findings.length === 0) {
  process.exit(0);
}

console.error('');
console.error(`🚨 check-secrets: possible secret(s) detected in ${SCAN_ALL ? 'tracked files' : 'staged changes'}`);
console.error('───────────────────────────────────────────────────────────────');
for (const f of findings) {
  console.error(`  ${f.file}:${f.line}  [${f.kind}]`);
  console.error(`    ${f.excerpt}`);
}
console.error('───────────────────────────────────────────────────────────────');
console.error('If this is a false positive, append this comment to the line:');
console.error('    // pragma: allowlist secret');
console.error('');
console.error('If it is a real secret, unstage the file and move the value to');
console.error('Capacitor Preferences / Supabase / an env var that is .gitignored.');
console.error('');
process.exit(1);
}
