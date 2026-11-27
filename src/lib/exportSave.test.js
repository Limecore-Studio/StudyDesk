import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// StudyDesk#319 — a real account's export saved a blank file on the phone.
describe('export save', () => {
  const java = readFileSync(new URL('../../android/app/src/main/java/com/StudyDesk/app/SaveFilePlugin.java', import.meta.url), 'utf8');
  it('streams the write and treats any Throwable as a failure', () => {
    expect(java).toMatch(/catch \(Throwable e\)/);
    expect(java).not.toMatch(/data\.getBytes\(/);
  });
  it('removes the empty file the picker created when the write fails', () => {
    expect(java).toMatch(/DocumentsContract\.deleteDocument/);
    expect(java).toMatch(/call\.reject\("Could not write the file\."\)/);
  });
  it('keeps the embedded files small enough to cross the bridge', () => {
    const js = readFileSync(new URL('./dataRights.js', import.meta.url), 'utf8');
    const mb = (name) => Number(js.match(new RegExp('export const ' + name + ' = ([0-9]+) [*] 1024 [*] 1024'))[1]);
    expect(mb('TOTAL_CAP')).toBeLessThanOrEqual(12);
    expect(mb('FILE_CAP')).toBeLessThanOrEqual(mb('TOTAL_CAP'));
  });
});
