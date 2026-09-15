import { useEffect, useState } from "react";
import { connectGoogleAccount, isGoogleConnected, preloadGoogleIdentityServices } from "../integrations/googleAuth";
import { saveStartggToken, isStartggConnected } from "../integrations/startgg";
import { GOOGLE_OAUTH_CLIENT_ID } from "../config";
import { getSettings, putSettings, type AdjustmentSettings } from "../services/controlPlaneClient";
import { DEFAULT_WIZARD_ANSWERS, resolveDefaults, type WizardAnswers } from "../engine/settingsDefaults";

export function SettingsPage() {
  const [googleConnected, setGoogleConnected] = useState(isGoogleConnected());
  const [startggConnected, setStartggConnected] = useState(false);
  const [startggTokenInput, setStartggTokenInput] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    preloadGoogleIdentityServices();
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

// FR-006: Wave希望の設定は数値ではなくワークシート名(文字列)なので、上の数値パラメータとは
// 別に保持する(保存時にNumber()変換しない)。
const WAVE_OVERRIDE_PARAM_NAMES = ["wavePatternWorksheetName", "playerWaveWorksheetName"] as const;
const WAVE_OVERRIDE_LABELS: Record<(typeof WAVE_OVERRIDE_PARAM_NAMES)[number], { label: string; help: string }> = {
  wavePatternWorksheetName: {
    label: "Waveパターン設定用ワークシート名",
    help: "同じスプレッドシート内の別シート名。列: pattern(1始まりの周期番号)、wave(そのWave名)。省略可(Wave制約を使わない場合は空欄)。",
  },
  playerWaveWorksheetName: {
    label: "選手ごとの希望Wave設定用ワークシート名",
    help: "同じスプレッドシート内の別シート名。列: discriminator(メインシートのdiscriminator列と一致させる識別子)、wave(希望Wave名。同じdiscriminatorで複数行可)。メインシートにdiscriminator列が必要。省略可。",
  },
};

function ParameterWizard({ onError }: { onError: (message: string | null) => void }) {
  // 設定は「対象(スプレッドシート等)の識別子」から切り離した、利用者が自由に名前を付ける
  // 「設定名」で登録する(2026-09-15、方針変更)。以前は実行ページが組み立てる対象IDと
  // 完全一致する文字列を要求しており、食い違うと保存した上書き設定が見つからず既定値へ
  // フォールバックする事故が起きていた。設定名は実行ページ側で明示的に指定するだけでよく、
  // 1つの設定を複数の対象で使い回すこともできる。
  const [settingsName, setSettingsName] = useState("");
  const [loaded, setLoaded] = useState<AdjustmentSettings | null>(null);
  const [answers, setAnswers] = useState<WizardAnswers>(DEFAULT_WIZARD_ANSWERS);
  const [overrideInputs, setOverrideInputs] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleLoad = async () => {
    if (!settingsName) return;
    onError(null);
    setSaved(false);
    try {
      const settings = await getSettings(settingsName);
      setLoaded(settings);
      setAnswers({
        ...DEFAULT_WIZARD_ANSWERS,
        ...(settings.wizardAnswers as Partial<WizardAnswers>),
      } as WizardAnswers);
      const inputs: Record<string, string> = {};
      for (const name of [...OVERRIDE_PARAM_NAMES, ...WAVE_OVERRIDE_PARAM_NAMES]) {
        const value = settings.overrides[name];
        if (value !== undefined) inputs[name] = String(value);
      }
      setOverrideInputs(inputs);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleSave = async () => {
    if (!settingsName) return;
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
      for (const name of WAVE_OVERRIDE_PARAM_NAMES) {
        const raw = overrideInputs[name];
        if (raw !== undefined && raw !== "") overrides[name] = raw;
      }
      const updated = await putSettings(settingsName, {
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
        任意の名前(設定名)ごとに、以下の質問への回答からパラメータ一式を登録できます(FR-018)。個別のパラメータを直接入力すると、その値がここでの回答による既定値より優先されます(FR-019)。
        実行ページで同じ設定名を指定すると、その設定が使われます。1つの設定名を複数の対象(スプレッドシート・大会)で使い回すこともできます。
      </p>
      <div>
        <label htmlFor="settingsName">設定名(自由入力)</label>
        <input
          id="settingsName"
          value={settingsName}
          onChange={(e) => setSettingsName(e.target.value)}
          placeholder="例: デフォルト設定"
        />
        <button type="button" onClick={handleLoad} disabled={!settingsName}>
          読み込む
        </button>
      </div>

      {loaded && (
        <>
          <fieldset>
            <legend>基本パラメータ</legend>

            <div>
              <label htmlFor="q1_fixedSeedNum">① シード何位までは調整せず固定としますか？</label>
              <input
                id="q1_fixedSeedNum"
                type="number"
                value={answers.fixedSeedNum}
                onChange={(e) => setAnswers((prev) => ({ ...prev, fixedSeedNum: Number(e.target.value) }))}
              />
            </div>

            <fieldset>
              <legend>② 上位シード(もしくは全員)で小規模な大会での対戦経験は考慮外としますか？</legend>
              <label>
                <input
                  type="radio"
                  name="smallTournamentExclusion"
                  checked={answers.smallTournamentExclusion === "none"}
                  onChange={() => setAnswers((prev) => ({ ...prev, smallTournamentExclusion: "none" }))}
                />
                考慮外にしない
              </label>
              <label>
                <input
                  type="radio"
                  name="smallTournamentExclusion"
                  checked={answers.smallTournamentExclusion === "all"}
                  onChange={() => setAnswers((prev) => ({ ...prev, smallTournamentExclusion: "all" }))}
                />
                全員考慮外にする
              </label>
              <label>
                <input
                  type="radio"
                  name="smallTournamentExclusion"
                  checked={answers.smallTournamentExclusion === "topSeedsOnly"}
                  onChange={() => setAnswers((prev) => ({ ...prev, smallTournamentExclusion: "topSeedsOnly" }))}
                />
                上位シードは考慮外とする
              </label>
            </fieldset>

            {answers.smallTournamentExclusion !== "none" && (
              <div>
                <label htmlFor="q3_smallTournamentMaxEntrants">
                  ③ 参加者何人までの大会を小規模な大会としますか？
                </label>
                <input
                  id="q3_smallTournamentMaxEntrants"
                  type="number"
                  value={answers.smallTournamentMaxEntrants}
                  onChange={(e) =>
                    setAnswers((prev) => ({ ...prev, smallTournamentMaxEntrants: Number(e.target.value) }))
                  }
                />
              </div>
            )}

            {answers.smallTournamentExclusion === "topSeedsOnly" && (
              <div>
                <label htmlFor="q4_smallTournamentTopSeedLimit">
                  ④ シード何位までは小規模な大会での対戦経験を考慮外にしますか？
                </label>
                <input
                  id="q4_smallTournamentTopSeedLimit"
                  type="number"
                  value={answers.smallTournamentTopSeedLimit}
                  onChange={(e) =>
                    setAnswers((prev) => ({ ...prev, smallTournamentTopSeedLimit: Number(e.target.value) }))
                  }
                />
              </div>
            )}

            <div>
              <label htmlFor="q5_searchBreadthMultiplier">⑤ 対戦相手候補の探索を何倍広めに行いますか？</label>
              <input
                id="q5_searchBreadthMultiplier"
                type="number"
                value={answers.searchBreadthMultiplier}
                onChange={(e) =>
                  setAnswers((prev) => ({ ...prev, searchBreadthMultiplier: Number(e.target.value) }))
                }
              />
              <p>大きくすると元のシード値からのズレが大きくなりすぎる場合があります。</p>
            </div>
          </fieldset>

          <fieldset>
            <legend>推奨既定値(①〜⑤の回答から算出)</legend>
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

          <fieldset>
            <legend>希望Wave設定(任意、Googleスプレッドシート入力のみ対応)</legend>
            {WAVE_OVERRIDE_PARAM_NAMES.map((name) => (
              <div key={name}>
                <label htmlFor={`override_${name}`}>{WAVE_OVERRIDE_LABELS[name].label}</label>
                <input
                  id={`override_${name}`}
                  value={overrideInputs[name] ?? ""}
                  onChange={(e) => setOverrideInputs((prev) => ({ ...prev, [name]: e.target.value }))}
                />
                <p>{WAVE_OVERRIDE_LABELS[name].help}</p>
              </div>
            ))}

            <details>
              <summary>設定例を見る</summary>
              <p>
                同じスプレッドシート内に、以下のような3つのシートを用意する例です(シート名は自由に決めて、上の2つの入力欄にその名前を指定します)。
              </p>

              <p>
                <strong>①メインシート</strong>(実行ページで指定するシート。<code>discriminator</code>列が必要):
              </p>
              <table border={1} cellPadding={4}>
                <thead>
                  <tr>
                    <th>user_id</th>
                    <th>player_name</th>
                    <th>discriminator</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>111</td>
                    <td>あいうえお</td>
                    <td>p1</td>
                  </tr>
                  <tr>
                    <td>222</td>
                    <td>かきくけこ</td>
                    <td>p2</td>
                  </tr>
                  <tr>
                    <td>333</td>
                    <td>さしすせそ</td>
                    <td>p3</td>
                  </tr>
                </tbody>
              </table>

              <p>
                <strong>②Waveパターン設定用ワークシート</strong>(例: シート名「WavePattern」。シードの位置が上から
                <code>pattern</code>の番号順に繰り返しWaveへ割り当てられます):
              </p>
              <table border={1} cellPadding={4}>
                <thead>
                  <tr>
                    <th>pattern</th>
                    <th>wave</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>1</td>
                    <td>AM</td>
                  </tr>
                  <tr>
                    <td>2</td>
                    <td>PM</td>
                  </tr>
                </tbody>
              </table>
              <p>→ 1番目・3番目・5番目…のシード位置がAM、2番目・4番目・6番目…がPMのWaveになります。</p>

              <p>
                <strong>③選手ごとの希望Wave設定用ワークシート</strong>(例: シート名「PlayerWave」。同じ
                <code>discriminator</code>を複数行書くと、そのいずれかのWaveでよいという意味になります):
              </p>
              <table border={1} cellPadding={4}>
                <thead>
                  <tr>
                    <th>discriminator</th>
                    <th>wave</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>p1</td>
                    <td>AM</td>
                  </tr>
                  <tr>
                    <td>p2</td>
                    <td>PM</td>
                  </tr>
                </tbody>
              </table>
              <p>
                → p1はAMのみ希望、p2はPMのみ希望。<code>discriminator</code>がこのシートに1行もない選手(例:
                p3)は希望なし(どのWaveでもよい)扱いになります。
              </p>
            </details>
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
