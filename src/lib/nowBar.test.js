import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// StudyDesk#321 — the focus block must request promotion the way Android 16
// actually reads it, or it never reaches the One UI 8 Now Bar.
describe('focus notification promotion', () => {
  const java = readFileSync(new URL('../../android/app/src/main/java/com/studydesk/app/FocusModePlugin.java', import.meta.url), 'utf8');
  const manifest = readFileSync(new URL('../../android/app/src/main/AndroidManifest.xml', import.meta.url), 'utf8');
  it('sets the real promotion extra, not a reflected method that does not exist', () => {
    expect(java).toContain('"android.requestPromotedOngoing", true');
    expect(java).not.toMatch(/getMethod\("requestPromotedOngoing"/);
  });
  it('declares POST_PROMOTED_NOTIFICATIONS', () => {
    expect(manifest).toContain('android.permission.POST_PROMOTED_NOTIFICATIONS');
  });
  it('keeps the promotable shape: ongoing and not colorized', () => {
    expect(java).toMatch(/\.setOngoing\(true\)/);
    expect(java).toMatch(/setColorized\(false\)/);
  });
});
