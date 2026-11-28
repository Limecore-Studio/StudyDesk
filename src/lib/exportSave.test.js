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

// StudyDesk#319, confirmed on the S24: TransactionTooLargeException with
// capacitorLastPluginCallOptions at 2 MB. The data must never ride the call
// that waits on the picker.
describe('export pick-then-write', () => {
  const js = readFileSync(new URL('./dataRights.js', import.meta.url), 'utf8');
  const java = readFileSync(new URL('../../android/app/src/main/java/com/StudyDesk/app/SaveFilePlugin.java', import.meta.url), 'utf8');
  it('the picker call carries only the name', () => {
    expect(js).toMatch(/SaveFile\.pick\(\{ name, mimeType: 'application\/json' \}\)/);
    expect(js).not.toMatch(/SaveFile\.save\(\{ name, data/);
  });
  it('the data goes in a separate write call to the picked uri', () => {
    expect(js).toMatch(/SaveFile\.write\(\{ uri, data: json \}\)/);
    expect(java).toMatch(/public void pick\(PluginCall call\)/);
    expect(java).toMatch(/public void write\(PluginCall call\)/);
  });
});
