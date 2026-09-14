import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { runGoogleSheetsAdjustment, runStartggAdjustment } from "../engine/runAdjustment";
import { resolveEffectiveSettings, type EffectiveSettings } from "../engine/settingsDefaults";
import { isGoogleConnected } from "../integrations/googleAuth";
import { isStartggConnected } from "../integrations/startgg";
import { createSpreadsheet, extractSpreadsheetId } from "../integrations/googleSheets";

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
  const [phase, setPhase] = useState<Phase>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // Set once the user submits the form; cleared on cancel or once the confirmed run starts.
  // Showing the resolved effective settings before running catches cases where the intended
  // overrides silently didn't apply (e.g. a targetId mismatch between this page and the
  // settings page) before time is spent on a run using the wrong parameters.
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingConfirmation | null>(null);

  useEffect(() => {
    const draft: RunPageDraft = {
      inputSource,
      spreadsheetId,
      worksheetName,
      phaseId,
      auditSpreadsheetId,
      autoCreateAudit,
    };
    try {
      localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft));
    } catch {
      // Best-effort only (e.g. private browsing may disable localStorage).
    }
  }, [inputSource, spreadsheetId, worksheetName, phaseId, auditSpreadsheetId, autoCreateAudit]);

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
    const targetId = inputSource === "google_sheets" ? `${spreadsheetId}:${worksheetName}` : `startgg:${phaseId}`;
    try {
      const settings = await resolveEffectiveSettings(targetId);
      setPendingConfirmation({ targetId, settings });
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    }
  };

  const executeRun = async () => {
    if (!pendingConfirmation) return;
    const { targetId, settings } = pendingConfirmation;
    setPendingConfirmation(null);
    setPhase("reading");
    try {
      let runId: string;
      if (inputSource === "google_sheets") {
        ({ runId } = await runGoogleSheetsAdjustment({ targetId, spreadsheetId, worksheetName, settings }, setPhase));
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
          { targetId, phaseId, auditSpreadsheetId: resolvedAuditSpreadsheetId, settings },
          setPhase,
        );
        runId = startggResult.runId;
        setPhase("done");
        navigate(`/writeback/${runId}`, {
          state: { phaseId: startggResult.phaseId, orderedSeedIds: startggResult.orderedSeedIds },
        });
        return;
      }
      setPhase("done");
      navigate(`/results/${runId}`);
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

        <button type="submit" disabled={isRunning}>
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
    </section>
  );
}

const SETTINGS_FIELD_LABELS: { key: keyof EffectiveSettings; label: string }[] = [
  { key: "fixed_seed_num", label: "固定するシード数(この順位まで調整せずそのまま)" },
  { key: "conditional_least_num_entrants", label: "小規模大会とみなす参加者数の閾値(これ未満の大会は対戦履歴から除外)" },
  {
    key: "apply_conditional_least_num_entrants_seed_num",
    label: "小規模大会の除外を適用する範囲(この順位までの選手同士の比較にのみ適用)",
  },
  { key: "search_breadth_multiplier", label: "対戦相手候補の探索幅倍率" },
];

/**
 * 実行前の確認モーダル。設定した対象ID向けの上書き値が正しく反映されているか(対象IDの
 * 不一致等で意図せず既定値にフォールバックしていないか)を、実行前に一目で確認できるように
 * する。あわせて処理に時間がかかる可能性がある旨も明示する。
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
          <p>この対象IDに対して、実際に使われる設定値は以下の通りです。意図した値と異なる場合は、設定ページで対象IDを確認してください。</p>
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
