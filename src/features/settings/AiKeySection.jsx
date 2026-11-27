// v1.22 (limecore#122, Design H) — the AI debrief on the user's own Gemini key.
//
// The key (masked, with set and clear), the model name, a Test that makes one
// tiny request, and what happens to the data. The switch stays locked off
// until a key is set, and clearing the key turns it off: no key, no request.
// Styles are SettingsView's (sv2-*), so this renders only inside it.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { clearAiKey, DEFAULT_AI_MODEL, getAiKey, getAiModel, setAiKey, setAiModel } from '../../lib/aiKey.js';
import { generate } from '../../lib/aiProvider.js';
import { enterSubmit } from '../../lib/imeSubmit.js';

/** "••••1a2b": enough to recognise which key it is, not enough to use it. */
function maskKey(key) {
  const k = String(key || '');
  return k.length > 8 ? `••••${k.slice(-4)}` : '••••';
}

export default function AiKeySection({ enabled, dispatch }) {
  const { t } = useTranslation();
  const [key, setKey] = useState(null); // null until read, then '' or the key
  const [model, setModel] = useState(DEFAULT_AI_MODEL);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState(null); // 'ok' or an AI error code

  useEffect(() => {
    let live = true;
    void getAiKey().then((k) => { if (live) setKey(k || ''); });
    void getAiModel().then((m) => { if (live) setModel(m); });
    return () => { live = false; };
  }, []);

  const setEnabled = (on) => dispatch({ type: 'SET_AI_ENABLED', on });
  const locked = !key;

  const saveKey = async () => {
    const v = draft.trim();
    if (!v) return;
    await setAiKey(v);
    setKey(v);
    setEditing(false);
    setDraft('');
    setResult(null);
  };

  const removeKey = async () => {
    await clearAiKey();
    setKey('');
    setResult(null);
    setEnabled(false);
  };

  const test = async () => {
    setTesting(true);
    setResult(null);
    const res = await generate({ prompt: 'Reply with the single word: ok', maxTokens: 16, temperature: 0, model });
    setResult(res.ok ? 'ok' : res.error);
    setTesting(false);
  };

  return (
    <>
      {/* AI debrief opt-in. Off by default — flipping it on is the consent,
          and the note you type is exactly what gets sent. */}
      <div className="sv2-row">
        <span className="sv2-row-label">{t('settings.aiDebrief')}</span>
        <span className="sv2-row-value">
          <span className="sv2-mode">
            <button className={!enabled ? 'active' : ''} onClick={() => setEnabled(false)}>
              {t('settings.aiOff')}
            </button>
            <button
              className={enabled ? 'active' : ''}
              disabled={locked}
              aria-disabled={locked}
              onClick={() => { if (!locked) setEnabled(true); }}
            >
              {t('settings.aiOn')}
            </button>
          </span>
        </span>
      </div>
      {key === '' && <div className="sv2-note">{t('ai.needKey')}</div>}

      <div className="sv2-row">
        <span className="sv2-row-label">{t('ai.keyLabel')}</span>
        <span className="sv2-row-value" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--muted)' }}>
            {key ? maskKey(key) : t('ai.notSet')}
          </span>
          <button type="button" className="sv2-preset" onClick={() => setEditing((e) => !e)}>
            {key ? t('common.edit') : t('ai.set')}
          </button>
          {key && (
            <button type="button" className="sv2-preset" onClick={() => void removeKey()}>
              {t('ai.clear')}
            </button>
          )}
        </span>
      </div>
      {editing && (
        <div className="sv2-row">
          <label className="sv2-scale-field" style={{ flex: '1 1 200px' }}>
            <span>{t('ai.keyLabel')}</span>
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              autoCapitalize="off"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              {...enterSubmit(() => void saveKey())}
            />
          </label>
          <button type="button" className="btn-outline" disabled={!draft.trim()} onClick={() => void saveKey()}>
            {t('common.save')}
          </button>
        </div>
      )}
      <div className="sv2-note">{t('ai.keyHelp')}</div>

      <div className="sv2-row">
        <label className="sv2-scale-field" style={{ flex: '1 1 200px' }}>
          <span>{t('ai.model')}</span>
          <input
            type="text"
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            onBlur={() => void setAiModel(model)}
          />
        </label>
        <button type="button" className="btn-outline" disabled={!key || testing} onClick={() => void test()}>
          {testing ? t('ai.testing') : t('ai.test')}
        </button>
      </div>
      <div className="sv2-note">{t('ai.modelHint', { model: DEFAULT_AI_MODEL })}</div>
      {result && (
        <div className="sv2-note" role="status">
          {result === 'ok' ? t('ai.testOk') : t(`ai.err.${result}`)}
        </div>
      )}

      <div className="sv2-note">
        {enabled ? t('settings.aiDebriefOnNote') : t('settings.aiDebriefOffNote')}
      </div>
      {/* Consent has to be informed where it is given, so this sits on the
          switch and not only in the privacy policy. */}
      <div className="sv2-note">{t('ai.terms')}</div>
    </>
  );
}
