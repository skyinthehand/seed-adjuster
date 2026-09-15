import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { runGoogleSheetsAdjustment, runStartggAdjustment } from "../engine/runAdjustment";
import { resolveEffectiveSettings, type EffectiveSettings } from "../engine/settingsDefaults";
import { isGoogleConnected } from "../integrations/googleAuth";
import { isStartggConnected } from "../integrations/startgg";
import { createSpreadsheet, extractSpreadsheetId } from "../integrations/googleSheets";
import { buildGoogleSheetsTargetId, buildStartggTargetId } from "../engine/targetId";
import { listSettingsNames } from "../services/controlPlaneClient";

type Phase = "idle" | "reading" | "computing" | "writing" | "done" | "error";
type InputSource = "google_sheets" | "startgg";

// Persists the form fields (not `phase`/`errorMessage`, which are run-in-progress state) across
// navigating away and back — e.g. to the settings page — since RunPage unmounts on route change.
const DRAFT_STORAGE_KEY = "runPageDraft";

interface RunPageDraft {
  inputSource: InputSource;
  spreadsheetId: string;
  worksheetName: string;
  phaseId: string;
  auditSpreadsheetId: string;
  autoCreateAudit: boolean;
  settingsName: string;
}

/** Absolute, shareable URL for the (auth-free) results page — built manually rather than
 * read from window.location, since HashRouter hasn't navigated there yet at the point this
 * is needed (still on "/" while the run is finishing). */
function buildResultsUrl(runId: string): string {
  return `${window.location.origin}${window.location.pathname}#/results/${runId}`;
}

function loadDraft(): RunPageDraft | null {
  try {
    const raw = localStorage.getItem(DRAFT_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as RunPageDraft) : null;
  } catch {
    return null;
  }
}

interface PendingConfirmation {
  targetId: string;
  settingsName: string;
  settings: EffectiveSettings;
}

export function RunPage() {
  const navigate = useNavigate();
  const [inputSource, setInputSource] = useState<InputSource>(() => loadDraft()?.inputSource ?? "google_sheets");
  const [spreadsheetId, setSpreadsheetId] = useState(() => loadDraft()?.spreadsheetId ?? "");
  const [worksheetName, setWorksheetName] = useState(() => loadDraft()?.worksheetName ?? "");
  const [phaseId, setPhaseId] = useState(() => loadDraft()?.phaseId ?? "");
  const [auditSpreadsheetId, setAuditSpreadsheetId] = useState(() => loadDraft()?.auditSpreadsheetId ?? "");
  const [autoCreateAudit, setAutoCreateAudit] = useState(() => loadDraft()?.autoCreateAudit ?? false);
  // 設定ページで登録した「設定名」(対象IDとは独立)。一覧から必ず選ばせる(自由入力・空欄は
  // 許容しない)ことで、名前の打ち間違いや未登録での実行が起きないようにする(2026-09-16)。
  // 以前は対象IDから設定を自動導出しており、対象IDの組み立て方が設定ページと実行ページで
  // 食い違うと上書き設定が黙って無視される事故が起きたため、まず自由入力の設定名へ変更した
  // (2026-09-15)。しかし自由入力+空欄可のままでは同種の事故(打ち間違い・未設定)が
  // 再発しうるため、登録済みの名前から選択必須にした。
  const [settingsName, setSettingsName] = useState(() => loadDraft()?.settingsName ?? "");
  const [settingsNames, setSettingsNames] = useState<string[] | null>(null);
  const [settingsNamesError, setSettingsNamesError] = useState<string | null>(null);

  useEffect(() => {
    listSettingsNames()
      .then((r) => setSettingsNames(r.names))
      .catch((err) => setSettingsNamesError(err instanceof Error ? err.message : String(err)));
  }, []);
  const [phase, setPhase] = useState<Phase>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // Set once the user submits the form; cleared on cancel or once the confirmed run starts.
  // Showing the resolved effective settings before running catches cases where the intended
  // overrides silently didn't apply (e.g. a targetId mismatch between this page and the
  // settings page) before time is spent on a run using the wrong parameters.
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingConfirmation | null>(null);
  // Set once a run finishes successfully, before navigating away — prompts the user to save
  // the results URL first, since there is currently no way to browse past results without
  // already having this link (FR-016's history list only works once you're already on a
  // results page for the same target).
  const [completedRun, setCompletedRun] = useState<{ resultsUrl: string; proceed: () => void } | null>(null);

  useEffect(() => {
    const draft: RunPageDraft = {
      inputSource,
      spreadsheetId,
      worksheetName,
      phaseId,
      auditSpreadsheetId,
      autoCreateAudit,
      settingsName,
    };
    try {
      localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft));
    } catch {
      // Best-effort only (e.g. private browsing may disable localStorage).
    }
  }, [inputSource, spreadsheetId, worksheetName, phaseId, auditSpreadsheetId, autoCreateAudit, settingsName]);

  const isRunning = phase === "reading" || phase === "computing" || phase === "writing";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isGoogleConnected()) {
      setErrorMessage("先に設定ページでGoogleアカウントを連携してください。");
      return;
    }
    if (inputSource === "startgg" && !(await isStartggConnected())) {
      setErrorMessage("先に設定ページでstart.ggアカウントを連携してください。");
      return;
    }
    setErrorMessage(null);
    const targetId =
      inputSource === "google_sheets"
        ? buildGoogleSheetsTargetId(spreadsheetId, worksheetName)
        : buildStartggTargetId(phaseId);
    try {
      const settings = await resolveEffectiveSettings(settingsName);
      setPendingConfirmation({ targetId, settingsName, settings });
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    }
  };

  const executeRun = async () => {
    if (!pendingConfirmation) return;
    const { targetId, settingsName: confirmedSettingsName, settings } = pendingConfirmation;
    setPendingConfirmation(null);
    setPhase("reading");
    try {
      let runId: string;
      if (inputSource === "google_sheets") {
        ({ runId } = await runGoogleSheetsAdjustment(
          { targetId, settingsName: confirmedSettingsName, spreadsheetId, worksheetName, settings },
          setPhase,
        ));
      } else {
        // FR-012a: Startgg入力は監査ログ用スプレッドシートが必須。未入力なら自動作成する。
        let resolvedAuditSpreadsheetId = auditSpreadsheetId;
        if (!resolvedAuditSpreadsheetId && autoCreateAudit) {
          resolvedAuditSpreadsheetId = await createSpreadsheet(`シード調整監査ログ - ${phaseId}`);
          setAuditSpreadsheetId(resolvedAuditSpreadsheetId);
        }
        if (!resolvedAuditSpreadsheetId) {
          setErrorMessage(
            "監査ログ保存用のGoogleスプレッドシートを指定するか、自動作成を選択してください。",
          );
          setPhase("idle");
          return;
        }
        const startggResult = await runStartggAdjustment(
          {
            targetId,
            settingsName: confirmedSettingsName,
            phaseId,
            auditSpreadsheetId: resolvedAuditSpreadsheetId,
            settings,
          },
          setPhase,
        );
        runId = startggResult.runId;
        setPhase("done");
        setCompletedRun({
          resultsUrl: buildResultsUrl(runId),
          proceed: () =>
            navigate(`/writeback/${runId}`, {
              state: { phaseId: startggResult.phaseId, orderedSeedIds: startggResult.orderedSeedIds },
            }),
        });
        return;
      }
      setPhase("done");
      setCompletedRun({ resultsUrl: buildResultsUrl(runId), proceed: () => navigate(`/results/${runId}`) });
    } catch (err) {
      setPhase("error");
      setErrorMessage(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <section>
      <h1>シード自動調整の実行</h1>
      <form onSubmit={handleSubmit}>
        <fieldset disabled={isRunning}>
          <legend>入力元</legend>
          <label>
            <input
              type="radio"
              name="inputSource"
              checked={inputSource === "google_sheets"}
              onChange={() => setInputSource("google_sheets")}
            />
            Googleスプレッドシート
          </label>
          <label>
            <input
              type="radio"
              name="inputSource"
              checked={inputSource === "startgg"}
              onChange={() => setInputSource("startgg")}
            />
            start.gg(仮組み済みシード)
          </label>
        </fieldset>

        {inputSource === "google_sheets" ? (
          <div>
            <div>
              <label htmlFor="spreadsheetId">スプレッドシートID(もしくはスプレッドシートURL)</label>
              <input
                id="spreadsheetId"
                value={spreadsheetId}
                onChange={(e) => setSpreadsheetId(extractSpreadsheetId(e.target.value))}
                required
                disabled={isRunning}
              />
            </div>
            <div>
              <label htmlFor="worksheetName">ワークシート名</label>
              <input
                id="worksheetName"
                value={worksheetName}
                onChange={(e) => setWorksheetName(e.target.value)}
                required
                disabled={isRunning}
              />
            </div>
          </div>
        ) : (
          <div>
            <div>
              <label htmlFor="phaseId">start.gg フェーズID</label>
              <input id="phaseId" value={phaseId} onChange={(e) => setPhaseId(e.target.value)} required disabled={isRunning} />
            </div>
            <div>
              <label htmlFor="auditSpreadsheetId">監査ログ保存用スプレッドシートID(もしくはスプレッドシートURL、任意)</label>
              <input
                id="auditSpreadsheetId"
                value={auditSpreadsheetId}
                onChange={(e) => setAuditSpreadsheetId(extractSpreadsheetId(e.target.value))}
                disabled={isRunning || autoCreateAudit}
              />
            </div>
            <label>
              <input
                type="checkbox"
                checked={autoCreateAudit}
                onChange={(e) => setAutoCreateAudit(e.target.checked)}
                disabled={isRunning}
              />
              指定しない場合は専用スプレッドシートを自動作成する
            </label>
          </div>
        )}

        <div>
          <label htmlFor="settingsName">使用する設定名</label>
          {settingsNamesError && <p role="alert">設定名一覧の取得に失敗しました: {settingsNamesError}</p>}
          {settingsNames && settingsNames.length === 0 ? (
            <p role="alert">登録済みの設定がありません。先に設定ページでパラメータを登録してください。</p>
          ) : (
            <select
              id="settingsName"
              value={settingsName}
              onChange={(e) => setSettingsName(e.target.value)}
              required
              disabled={isRunning || !settingsNames}
            >
              <option value="" disabled hidden>
                {settingsNames ? "選択してください" : "読み込み中..."}
              </option>
              {settingsNames?.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          )}
        </div>

        <button type="submit" disabled={isRunning || !settingsNames || settingsNames.length === 0}>
          {isRunning ? "実行中..." : "シード自動調整を実行"}
        </button>
      </form>
      {phase === "reading" && <p>シード表を読み込んでいます...</p>}
      {phase === "computing" && <p>調整を計算しています(規模によっては時間がかかります。タブを閉じないでください)...</p>}
      {phase === "writing" && <p>結果を書き込んでいます...</p>}
      {errorMessage && <p role="alert">{errorMessage}</p>}

      <RunConfirmationModal
        pending={pendingConfirmation}
        onCancel={() => setPendingConfirmation(null)}
        onConfirm={executeRun}
      />
      <RunCompletedModal
        completed={completedRun}
        onProceed={() => {
          completedRun?.proceed();
          setCompletedRun(null);
        }}
      />
    </section>
  );
}

const SETTINGS_FIELD_LABELS: { key: keyof EffectiveSettings; label: string }[] = [
  { key: "fixed_seed_num", label: "固定するシード数(この順位まで調整せずそのまま)" },
  { key: "conditional_least_num_entrants", label: "小規模大会とみなす参加者数の閾値(これ以下の大会は対戦履歴から除外)" },
  {
    key: "apply_conditional_least_num_entrants_seed_num",
    label: "小規模大会の除外を適用する範囲(この順位までの選手同士の比較にのみ適用)",
  },
  { key: "search_breadth_multiplier", label: "対戦相手候補の探索幅倍率" },
];

/**
 * 実行前の確認モーダル。指定した設定名に対して実際に使われる設定値を、実行前に一目で
 * 確認できるようにする(設定名の入力ミス等で意図せず既定値になっていないか)。あわせて
 * 処理に時間がかかる可能性がある旨も明示する。
 */
function RunConfirmationModal({
  pending,
  onCancel,
  onConfirm,
}: {
  pending: PendingConfirmation | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (pending) {
      if (!dialog.open) dialog.showModal();
    } else if (dialog.open) {
      dialog.close();
    }
  }, [pending]);

  return (
    <dialog ref={dialogRef} onClose={onCancel} style={{ padding: 0, border: "1px solid #ccc", maxWidth: "90vw", width: "32rem" }}>
      {pending && (
        <div style={{ padding: "1rem" }}>
          <h2 style={{ marginTop: 0 }}>この設定で実行しますか?</h2>
          <p>
            対象ID: <code>{pending.targetId}</code>
          </p>
          <p>
            使用する設定名: <code>{pending.settingsName}</code>
          </p>
          <p>実際に使われる設定値は以下の通りです。意図した値と異なる場合は、設定名が正しいか確認してください。</p>
          <ul>
            {SETTINGS_FIELD_LABELS.map(({ key, label }) => (
              <li key={key}>
                {label}: <strong>{String(pending.settings[key])}</strong>
              </li>
            ))}
            {pending.settings.wavePatternWorksheetName && (
              <li>Waveパターンワークシート: {pending.settings.wavePatternWorksheetName}</li>
            )}
            {pending.settings.playerWaveWorksheetName && (
              <li>選手希望Waveワークシート: {pending.settings.playerWaveWorksheetName}</li>
            )}
          </ul>
          <p role="alert">
            大会の規模によっては、計算に時間がかかる場合があります(最大60分程度を想定)。実行中はこのタブを閉じないでください。
          </p>
          <button type="button" onClick={onConfirm}>
            この設定で実行する
          </button>{" "}
          <button type="button" onClick={onCancel}>
            キャンセル
          </button>
        </div>
      )}
    </dialog>
  );
}

/**
 * 実行完了直後に表示するモーダル。結果表示ページ(認証不要)のURLを保存するよう促す。
 * 現状、このURLを控えていないと後から結果を見つける手段がないため(結果ページの
 * 「過去の実行一覧」も、既にその対象の結果ページを一度開いていないと使えない)。
 */
function RunCompletedModal({
  completed,
  onProceed,
}: {
  completed: { resultsUrl: string; proceed: () => void } | null;
  onProceed: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle");

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (completed) {
      setCopyStatus("idle");
      if (!dialog.open) dialog.showModal();
    } else if (dialog.open) {
      dialog.close();
    }
  }, [completed]);

  const handleCopy = async () => {
    if (!completed) return;
    try {
      await navigator.clipboard.writeText(completed.resultsUrl);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("failed");
    }
  };

  return (
    <dialog
      ref={dialogRef}
      onClose={onProceed}
      style={{ padding: 0, border: "1px solid #ccc", maxWidth: "90vw", width: "32rem" }}
    >
      {completed && (
        <div style={{ padding: "1rem" }}>
          <h2 style={{ marginTop: 0 }}>調整が完了しました</h2>
          <p role="alert">
            結果ページのURLを保存してください。このURLを控えていないと、後から結果を見つける手段がありません。
          </p>
          <input
            type="text"
            readOnly
            value={completed.resultsUrl}
            onClick={(e) => e.currentTarget.select()}
            style={{ width: "100%", boxSizing: "border-box" }}
          />
          <p>
            <button type="button" onClick={handleCopy}>
              URLをコピーする
            </button>{" "}
            {copyStatus === "copied" && "コピーしました。"}
            {copyStatus === "failed" && "コピーに失敗しました。上の欄を選択して手動でコピーしてください。"}
          </p>
          <button type="button" onClick={onProceed}>
            次へ進む
          </button>
        </div>
      )}
    </dialog>
  );
}
