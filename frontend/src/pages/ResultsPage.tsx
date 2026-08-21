import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import {
  getPublicResult,
  listPublicRuns,
  type PublicResult,
  type RunHistoryEntry,
} from "../services/controlPlaneClient";

// Public, unauthenticated results view (FR-012b, FR-015, FR-016). Deliberately does not
// import Pyodide/DuckDB-WASM — viewing results requires no computation (research.md #1/#9).

export function ResultsPage() {
  const { runId } = useParams<{ runId: string }>();
  const [result, setResult] = useState<PublicResult | null>(null);
  const [history, setHistory] = useState<RunHistoryEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

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
          </tr>
        </thead>
        <tbody>
          {result.adjustedEntries.map((entry) => (
            <tr key={entry.adjustedPosition}>
              <td>{entry.adjustedPosition}</td>
              <td>{entry.displayName}</td>
              <td>{entry.originalPosition}</td>
              <td>{entry.adjustedWave ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>配置理由</h2>
      <ul>
        {result.decisionLog.map((log) => (
          <li key={log.position}>
            #{log.position}: {log.decisionLogicType} — 比較した対戦相手候補:{" "}
            {log.comparedCandidates.map((c) => `${c.candidateDisplayName}(${c.matchPointValue.toFixed(2)})`).join(", ")}
          </li>
        ))}
      </ul>

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
