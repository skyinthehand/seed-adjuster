import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import {
  getPublicResult,
  listPublicRuns,
  type PublicResult,
  type RunHistoryEntry,
  type ComparedCandidateMatch,
} from "../services/controlPlaneClient";
import { fetchTournamentDirectory, type TournamentDirectory } from "../data/matchIndex";
import { MATCH_INDEX_MANIFEST_URL } from "../config";

// Public, unauthenticated results view (FR-012b, FR-015, FR-016). Deliberately does not
// import Pyodide/DuckDB-WASM — viewing results requires no computation (research.md #1/#9).

// Plain-Japanese explanations for decisionLogicType (seed_adjuster.py), shown via a "?"
// tooltip next to the adopted logic's name.
const DECISION_LOGIC_EXPLANATIONS: Record<string, string> = {
  best_left_player_based:
    "シード順で一番上の未配置選手を、対戦相手との近さに問題がないと判断してそのまま配置しました。",
  seed_position_based:
    "シード順そのままでは対戦相手と対戦履歴が近すぎたため、比較した候補の中から対戦履歴が最も薄い選手を選んで配置しました。",
};

export function ResultsPage() {
  const { runId } = useParams<{ runId: string }>();
  const [result, setResult] = useState<PublicResult | null>(null);
  const [history, setHistory] = useState<RunHistoryEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selectedPosition, setSelectedPosition] = useState<number | null>(null);

  useEffect(() => {
    if (!runId) return;
    setError(null);
    getPublicResult(runId)
      .then(async (r) => {
        setResult(r);
        const { runs } = await listPublicRuns(r.targetId);
        setHistory(runs);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [runId]);

  if (error) return <p role="alert">{error}</p>;
  if (!result) return <p>読み込み中...</p>;

  return (
    <section>
      <h1>調整結果</h1>

      {history.length > 1 && (
        <nav aria-label="過去の実行一覧">
          <h2>過去の実行一覧</h2>
          <ul>
            {history.map((run) => (
              <li key={run.runId}>
                <a href={`/results/${run.runId}`} aria-current={run.runId === runId ? "page" : undefined}>
                  {new Date(run.finishedAt).toLocaleString("ja-JP")}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      )}

      <h2>調整前後のシード比較</h2>
      <table>
        <thead>
          <tr>
            <th>調整後の順位</th>
            <th>選手</th>
            <th>元の順位</th>
            <th>Wave</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {result.adjustedEntries.map((entry) => (
            <tr key={entry.adjustedPosition}>
              <td>{entry.adjustedPosition}</td>
              <td>{entry.displayName}</td>
              <td>{entry.originalPosition}</td>
              <td>{entry.adjustedWave ?? ""}</td>
              <td>
                <button type="button" onClick={() => setSelectedPosition(entry.adjustedPosition)}>
                  詳細
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <PlacementDecisionModal
        result={result}
        selectedPosition={selectedPosition}
        onClose={() => setSelectedPosition(null)}
      />

      {result.waveConstraintViolations.length > 0 && (
        <>
          <h2 role="alert">Wave希望を満たせなかった選手</h2>
          <table>
            <thead>
              <tr>
                <th>順位</th>
                <th>選手</th>
                <th>配置されたWave</th>
                <th>希望していたWave</th>
              </tr>
            </thead>
            <tbody>
              {result.waveConstraintViolations.map((v) => (
                <tr key={v.position}>
                  <td>{v.position}</td>
                  <td>{v.playerDisplayName}</td>
                  <td>{v.wave}</td>
                  <td>{v.allowedWaves.join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {result.preAdjustmentSnapshot && (
        <>
          <h2>調整前(Startgg仮組み時点)のシード順</h2>
          <ol>
            {result.preAdjustmentSnapshot.map((e) => (
              <li key={e.originalPosition}>{e.displayName}</li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}

/**
 * 選手別の配置判断根拠(002-result-decision-detail, FR-001〜FR-002)。<dialog>を使い、新規npm
 * 依存を追加しない(research.md R2)。閉じるボタン等の操作要素を含む固定領域(header)と、
 * 内容を表示するスクロール可能な領域(content)を最初から分けておく — User Story 2で大会名が
 * 非同期に差し替わっても、操作要素の位置がずれないようにするため(FR-008、research.md R3)。
 */
function PlacementDecisionModal({
  result,
  selectedPosition,
  onClose,
}: {
  result: PublicResult;
  selectedPosition: number | null;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (selectedPosition !== null) {
      if (!dialog.open) dialog.showModal();
    } else if (dialog.open) {
      dialog.close();
    }
  }, [selectedPosition]);

  // Fetched lazily, only once the detail view is first opened — never on page load
  // (research.md R1, R4, SC-004).
  const [directory, setDirectory] = useState<TournamentDirectory | null>(null);
  const [directoryStatus, setDirectoryStatus] = useState<"idle" | "loading" | "loaded" | "failed">("idle");
  const directoryFetchStarted = useRef(false);

  useEffect(() => {
    if (selectedPosition === null || directoryFetchStarted.current) return;
    directoryFetchStarted.current = true;
    setDirectoryStatus("loading");
    fetchTournamentDirectory(MATCH_INDEX_MANIFEST_URL)
      .then((dir) => {
        setDirectory(dir);
        setDirectoryStatus("loaded");
      })
      .catch(() => setDirectoryStatus("failed"));
  }, [selectedPosition]);

  const entry = result.adjustedEntries.find((e) => e.adjustedPosition === selectedPosition) ?? null;
  const log = result.decisionLog.find((l) => l.position === selectedPosition) ?? null;
  const waveViolation = result.waveConstraintViolations.find((v) => v.position === selectedPosition) ?? null;

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      style={{ padding: 0, border: "1px solid #ccc", maxWidth: "90vw", width: "32rem", maxHeight: "85vh" }}
    >
      {entry && (
        <div style={{ display: "flex", flexDirection: "column", maxHeight: "85vh" }}>
          <header
            style={{
              flex: "0 0 auto",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "0.75rem 1rem",
              borderBottom: "1px solid #ccc",
            }}
          >
            <h2 style={{ margin: 0 }}>{entry.displayName} の配置判断根拠</h2>
            <button type="button" onClick={() => dialogRef.current?.close()}>
              閉じる
            </button>
          </header>
          <div style={{ flex: "1 1 auto", overflowY: "auto", padding: "1rem" }}>
            <p>元の順位: {entry.originalPosition}</p>
            <p>調整後の順位: {entry.adjustedPosition}</p>
            {waveViolation && (
              <p role="alert">
                希望Wave(「{waveViolation.allowedWaves.join(", ")}」)を満たせず、通常の判定ロジックは無視されました(配置されたWave:{" "}
                {waveViolation.wave})。
              </p>
            )}
            {log ? (
              <>
                <p>
                  想定対戦相手: <strong>{log.projectedOpponentDisplayName}</strong>
                </p>
                <p>
                  採用された判定ロジック: {log.decisionLogicType}{" "}
                  <span
                    title={
                      DECISION_LOGIC_EXPLANATIONS[log.decisionLogicType] ??
                      "このロジックの説明は登録されていません。"
                    }
                    style={{
                      display: "inline-block",
                      cursor: "help",
                      border: "1px solid currentColor",
                      borderRadius: "50%",
                      width: "1.2em",
                      height: "1.2em",
                      textAlign: "center",
                      lineHeight: "1.2em",
                      fontSize: "0.8em",
                    }}
                  >
                    ?
                  </span>
                </p>
                <h3>比較した対戦相手候補(元のシード値が高い順)</h3>
                {log.comparedCandidates.length === 0 ? (
                  <p>比較対象の対戦相手候補はありませんでした。</p>
                ) : (
                  <ul>
                    {log.comparedCandidates.map((c, i) => (
                      <li key={i}>
                        {c.candidateDisplayName}(元のシード値: {c.originalSeedPosition}、近さの指標値: {c.matchPointValue.toFixed(2)})
                        <MatchList matches={c.matches} directory={directory} directoryStatus={directoryStatus} />
                      </li>
                    ))}
                  </ul>
                )}
              </>
            ) : (
              <p>判断根拠の記録がありません。</p>
            )}
          </div>
        </div>
      )}
    </dialog>
  );
}

/**
 * 対戦相手候補ごとの実際の対戦実績(FR-003, FR-004)。0件なら「対戦履歴なし」を明示する
 * (spec.md Clarifications)。大会名は`tournamentDirectory`の取得状況に応じて「読み込み中」→
 * 実際の名前(または取得失敗時は「大会名不明」)に差し替わる。この差し替えはリスト項目の
 * 内側だけで起こり、親のPlacementDecisionModalの固定領域(閉じるボタン)には影響しない(FR-008)。
 */
function MatchList({
  matches,
  directory,
  directoryStatus,
}: {
  matches: ComparedCandidateMatch[];
  directory: TournamentDirectory | null;
  directoryStatus: "idle" | "loading" | "loaded" | "failed";
}) {
  if (matches.length === 0) {
    return <p>対戦履歴なし</p>;
  }
  return (
    <ul>
      {matches.map((m, i) => (
        <li key={i}>
          {tournamentNameLabel(m.tournamentId, directory, directoryStatus)} — {m.date}
          {m.count > 1 ? `(${m.count}試合)` : ""}
        </li>
      ))}
    </ul>
  );
}

function tournamentNameLabel(
  tournamentId: number,
  directory: TournamentDirectory | null,
  directoryStatus: "idle" | "loading" | "loaded" | "failed",
): string {
  if (directoryStatus === "loading" || directoryStatus === "idle") return "読み込み中...";
  if (directoryStatus === "failed") return "大会名不明";
  return directory?.[String(tournamentId)] ?? "大会名不明";
}
