import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { runGoogleSheetsAdjustment, runStartggAdjustment } from "../engine/runAdjustment";
import { resolveEffectiveSettings } from "../engine/settingsDefaults";
import { isGoogleConnected } from "../integrations/googleAuth";
import { isStartggConnected } from "../integrations/startgg";
import { createSpreadsheet } from "../integrations/googleSheets";

type Phase = "idle" | "reading" | "computing" | "writing" | "done" | "error";
type InputSource = "google_sheets" | "startgg";

export function RunPage() {
  const navigate = useNavigate();
  const [inputSource, setInputSource] = useState<InputSource>("google_sheets");
  const [spreadsheetId, setSpreadsheetId] = useState("");
  const [worksheetName, setWorksheetName] = useState("");
  const [phaseId, setPhaseId] = useState("");
  const [auditSpreadsheetId, setAuditSpreadsheetId] = useState("");
  const [autoCreateAudit, setAutoCreateAudit] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

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
    setPhase("reading");
    try {
      let runId: string;
      if (inputSource === "google_sheets") {
        const targetId = `${spreadsheetId}:${worksheetName}`;
        ({ runId } = await runGoogleSheetsAdjustment(
          {
            targetId,
            spreadsheetId,
            worksheetName,
            settings: await resolveEffectiveSettings(targetId),
          },
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
        const startggTargetId = `startgg:${phaseId}`;
        const startggResult = await runStartggAdjustment(
          {
            targetId: startggTargetId,
            phaseId,
            auditSpreadsheetId: resolvedAuditSpreadsheetId,
            settings: await resolveEffectiveSettings(startggTargetId),
          },
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
              <label htmlFor="spreadsheetId">スプレッドシートID</label>
              <input
                id="spreadsheetId"
                value={spreadsheetId}
                onChange={(e) => setSpreadsheetId(e.target.value)}
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
              <label htmlFor="auditSpreadsheetId">監査ログ保存用スプレッドシートID(任意)</label>
              <input
                id="auditSpreadsheetId"
                value={auditSpreadsheetId}
                onChange={(e) => setAuditSpreadsheetId(e.target.value)}
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
    </section>
  );
}
