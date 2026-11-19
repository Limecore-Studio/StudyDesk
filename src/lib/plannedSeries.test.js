import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

// StudyDesk#238. `upsertPlannedSession` writes `series_id = seriesId || null`,
// so any producer of an `upsert_planned` item that leaves seriesId out takes
// the block out of its repeating series on the server. The producers are
// spread over components that cannot be rendered here (no jsdom), so this
// checks the source: every `upsert_planned` object literal names seriesId, and
// every pushPlan call does too.

const SRC = join(process.cwd(), 'src');

function files(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...files(p));
    else if (/\.(js|jsx)$/.test(name) && !/\.test\.js$/.test(name)) out.push(p);
  }
  return out;
}

/** The balanced `{...}` or `(...)` starting at `open` in `src`. */
function balanced(src, open) {
  const close = { '{': '}', '(': ')' }[src[open]];
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === src[open]) depth += 1;
    else if (src[i] === close) { depth -= 1; if (depth === 0) return src.slice(open, i + 1); }
  }
  return src.slice(open);
}

describe('every upsert_planned producer keeps the series (StudyDesk#238)', () => {
  const sources = files(SRC).map((f) => ({ f, src: readFileSync(f, 'utf8') }));

  it('object-literal payloads name seriesId', () => {
    let found = 0;
    for (const { f, src } of sources) {
      const re = /['"]upsert_planned['"]\s*,\s*(?:payload:\s*)?\{/g;
      let m;
      while ((m = re.exec(src))) {
        found += 1;
        const body = balanced(src, m.index + m[0].length - 1);
        expect(body, `${f} @${m.index}`).toMatch(/\bseriesId\b/);
      }
    }
    // App.jsx, CalendarView (drag + pushPlan), planRun.js, reconcile.js.
    expect(found).toBeGreaterThanOrEqual(5);
  });

  it('every pushPlan call passes seriesId or a stored plan that has it', () => {
    const { src } = sources.find(({ f }) => f.endsWith('CalendarView.jsx'));
    const re = /\bpushPlan\(\{/g;
    let m;
    let calls = 0;
    while ((m = re.exec(src))) {
      calls += 1;
      const args = balanced(src, m.index + m[0].length - 1);
      // `...plan` spreads the stored block (it carries seriesId); a `...form`
      // from the editor does not, so it has to be named.
      if (/\.\.\.form\b/.test(args)) expect(args).toMatch(/\bseriesId\b/);
      else expect(args).toMatch(/\.\.\.plan\b|\bseriesId\b/);
    }
    expect(calls).toBeGreaterThanOrEqual(3);
  });
});
