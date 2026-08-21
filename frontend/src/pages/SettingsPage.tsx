import { useEffect, useState } from "react";
import { connectGoogleAccount, isGoogleConnected } from "../integrations/googleAuth";
import { saveStartggToken, isStartggConnected } from "../integrations/startgg";
import { GOOGLE_OAUTH_CLIENT_ID } from "../config";
import { getSettings, putSettings, type AdjustmentSettings } from "../services/controlPlaneClient";
import {
  WIZARD_QUESTIONS,
  DEFAULT_WIZARD_ANSWERS,
  resolveDefaults,
  type WizardAnswers,
} from "../engine/settingsDefaults";

export function SettingsPage() {
  const [googleConnected, setGoogleConnected] = useState(isGoogleConnected());
  const [startggConnected, setStartggConnected] = useState(false);
  const [startggTokenInput, setStartggTokenInput] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    isStartggConnected().then(setStartggConnected);
  }, []);

  const handleConnectGoogle = async () => {
    setError(null);
    try {
      await connectGoogleAccount(GOOGLE_OAUTH_CLIENT_ID);
      setGoogleConnected(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleSaveStartggToken = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await saveStartggToken(startggTokenInput);
      setStartggTokenInput(""); // never keep the raw value around longer than needed
      setStartggConnected(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <section>
      <h1>設定</h1>
      <section>
        <h2>Googleアカウント連携</h2>
        <p>Startgg入力を使う場合も、監査ログ保存のためこの連携が必要です。</p>
        {googleConnected ? (
          <p>連携済みです。</p>
        ) : (
          <button type="button" onClick={handleConnectGoogle}>
            Googleアカウントを連携する
          </button>
        )}
      </section>
      <section>
        <h2>start.gg連携</h2>
        <p>
          個人アクセストークンはこの端末のブラウザ内(IndexedDB)にのみ保存され、サーバーには送信されません。
        </p>
        {startggConnected ? (
          <p>連携済みです。</p>
        ) : (
          <form onSubmit={handleSaveStartggToken}>
            <label htmlFor="startggToken">start.gg個人アクセストークン</label>
            <input
              id="startggToken"
              type="password"
              value={startggTokenInput}
              onChange={(e) => setStartggTokenInput(e.target.value)}
              required
            />
            <button type="submit">保存</button>
          </form>
        )}
      </section>
      {error && <p role="alert">{error}</p>}
      <ParameterWizard onError={setError} />
    </section>
  );
}

const OVERRIDE_PARAM_NAMES = [
  "fixed_seed_num",
  "conditional_least_num_entrants",
  "apply_conditional_least_num_entrants_seed_num",
  "search_breadth_multiplier",
] as const;

function ParameterWizard({ onError }: { onError: (message: string | null) => void }) {
  const [targetId, setTargetId] = useState("");
  const [loaded, setLoaded] = useState<AdjustmentSettings | null>(null);
  const [answers, setAnswers] = useState<WizardAnswers>(DEFAULT_WIZARD_ANSWERS);
  const [overrideInputs, setOverrideInputs] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleLoad = async () => {
    if (!targetId) return;
    onError(null);
    setSaved(false);
    try {
      const settings = await getSettings(targetId);
      setLoaded(settings);
      setAnswers({
        ...DEFAULT_WIZARD_ANSWERS,
        ...(settings.wizardAnswers as Partial<WizardAnswers>),
      } as WizardAnswers);
      const inputs: Record<string, string> = {};
      for (const name of OVERRIDE_PARAM_NAMES) {
        const value = settings.overrides[name];
        if (value !== undefined) inputs[name] = String(value);
      }
      setOverrideInputs(inputs);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleSave = async () => {
    if (!targetId) return;
    onError(null);
    setSaving(true);
    setSaved(false);
    try {
      const resolvedDefaults = resolveDefaults(answers);
      const overrides: Record<string, unknown> = {};
      for (const name of OVERRIDE_PARAM_NAMES) {
        const raw = overrideInputs[name];
        if (raw !== undefined && raw !== "") overrides[name] = Number(raw);
      }
      const updated = await putSettings(targetId, {
        wizardAnswers: answers as unknown as Record<string, unknown>,
        resolvedDefaults,
        overrides,
      });
      setLoaded(updated);
      setSaved(true);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const resolvedPreview = resolveDefaults(answers);

  return (
    <section>
      <h2>シード調整パラメータの設定</h2>
      <p>
        対象(スプレッドシートIDとワークシート名、または<code>startgg:フェーズID</code>)ごとにYes/No質問へ回答すると、
        推奨既定値一式が自動的に設定されます(FR-018)。個別のパラメータを直接入力すると、その値がYes/No回答による既定値より優先されます(FR-019)。
      </p>
      <div>
        <label htmlFor="settingsTargetId">対象ID(実行ページの入力と同じ形式)</label>
        <input
          id="settingsTargetId"
          value={targetId}
          onChange={(e) => setTargetId(e.target.value)}
          placeholder="spreadsheetId:worksheetName または startgg:phaseId"
        />
        <button type="button" onClick={handleLoad} disabled={!targetId}>
          読み込む
        </button>
      </div>

      {loaded && (
        <>
          <fieldset>
            <legend>Yes/No質問</legend>
            {WIZARD_QUESTIONS.map((q) => (
              <div key={q.key}>
                <label>
                  <input
                    type="checkbox"
                    checked={answers[q.key]}
                    onChange={(e) => setAnswers((prev) => ({ ...prev, [q.key]: e.target.checked }))}
                  />
                  {q.label}
                </label>
                <p>{q.help}</p>
              </div>
            ))}
          </fieldset>

          <fieldset>
            <legend>推奨既定値(Yes/No回答から自動導出)</legend>
            <ul>
              {OVERRIDE_PARAM_NAMES.map((name) => (
                <li key={name}>
                  {name}: {resolvedPreview[name]}
                </li>
              ))}
            </ul>
          </fieldset>

          <fieldset>
            <legend>個別上書き(空欄なら上記の推奨既定値を使用)</legend>
            {OVERRIDE_PARAM_NAMES.map((name) => (
              <div key={name}>
                <label htmlFor={`override_${name}`}>{name}</label>
                <input
                  id={`override_${name}`}
                  type="number"
                  value={overrideInputs[name] ?? ""}
                  onChange={(e) => setOverrideInputs((prev) => ({ ...prev, [name]: e.target.value }))}
                />
              </div>
            ))}
          </fieldset>

          <button type="button" onClick={handleSave} disabled={saving}>
            {saving ? "保存中..." : "保存する"}
          </button>
          {saved && <p>保存しました。</p>}
        </>
      )}
    </section>
  );
}
