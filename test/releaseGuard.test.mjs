import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// v1.22 (limecore#108) — runs release-guard.yml's own github-script body
// against fake tags and Releases, so the desktop-trio check is shown to fire.

const yml = readFileSync(new URL('../.github/workflows/release-guard.yml', import.meta.url), 'utf8');
const lines = yml.split('\n');
const start = lines.findIndex((l) => /^\s+script: \|\s*$/.test(l)) + 1;
const indent = lines[start].match(/^\s*/)[0].length;
const body = [];
for (let i = start; i < lines.length && (lines[i].trim() === '' || lines[i].match(/^\s*/)[0].length >= indent); i++) body.push(lines[i].slice(indent));
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
const guard = new AsyncFunction('github', 'context', 'core', 'process', body.join('\n'));

const DAY = 86400000;
async function run(releases, tags = releases.map((r) => ({ name: r.tag_name, commit: { sha: r.tag_name } }))) {
  const out = { errors: [], failed: null };
  const github = {
    paginate: async (fn) => (fn === 'tags' ? tags : releases),
    rest: {
      repos: {
        listTags: 'tags', listReleases: 'releases',
        getCommit: async () => ({ data: { commit: { committer: { date: new Date(Date.now() - 10 * DAY).toISOString() } } } }),
      },
    },
  };
  const core = { startGroup() {}, endGroup() {}, info() {}, error: (m) => out.errors.push(m), setFailed: (m) => { out.failed = m; } };
  await guard(github, { repo: { owner: 'o', repo: 'r' } }, core, { env: { GRACE_HOURS: '24' } });
  return out;
}
const rel = (tag, assets, ageDays = 5) => ({
  tag_name: tag, draft: false, prerelease: false, html_url: 'u',
  published_at: new Date(Date.now() - ageDays * DAY).toISOString(),
  assets: assets.map((name) => ({ name })),
});
const trio = (v) => ['latest.yml', `StudyDesk-Desktop-Setup-${v}.exe`, `StudyDesk-Desktop-Setup-${v}.exe.blockmap`];

describe('release guard: desktop trio on the newest Release', () => {
  it('fires when the newest Release has the APK but no desktop files', async () => {
    const out = await run([rel('v9.1.0', ['StudyDesk-9.1.0.apk']), rel('v9.0.0', ['StudyDesk-9.0.0.apk', ...trio('9.0.0')], 20)]);
    expect(out.failed).toBeTruthy();
    expect(out.errors.join('\n')).toMatch(/v9\.1\.0: the newest Release lacks latest\.yml, StudyDesk-Desktop-Setup-9\.1\.0\.exe/);
  });
  it('passes when the newest Release carries all three', async () => {
    const out = await run([rel('v9.1.0', ['StudyDesk-9.1.0.apk', ...trio('9.1.0')])]);
    expect(out.failed).toBeNull();
  });
  it('waits out the grace period', async () => {
    const out = await run([rel('v9.1.0', ['StudyDesk-9.1.0.apk'], 0.5)]);
    expect(out.failed).toBeNull();
  });
});
