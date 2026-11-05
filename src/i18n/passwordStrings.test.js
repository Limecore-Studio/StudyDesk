import { describe, it, expect } from 'vitest';
import i18n from 'i18next';

// limecore#73 — the on-demand strings must reach a loaded language without
// creating a bundle for one that is not loaded yet (index.js would then skip
// loading it and leave the app in English).
describe('passwordStrings registration', () => {
  it('merges into loaded languages only, and into a language as it becomes active', async () => {
    await i18n.init({ resources: { en: { translation: { auth: { keep: 'x' } } } }, lng: 'en', fallbackLng: 'en' });
    await import('./passwordStrings.js');
    expect(i18n.t('auth.pwRuleLower')).toBe('lowercase');
    expect(i18n.t('auth.keep')).toBe('x');
    expect(i18n.hasResourceBundle('fi', 'translation')).toBe(false);

    i18n.addResourceBundle('fi', 'translation', { auth: { keep: 'y' } });
    await i18n.changeLanguage('fi');
    expect(i18n.t('auth.pwRuleLower')).toBe('pieni kirjain');
    expect(i18n.t('auth.keep')).toBe('y');
  });
});
