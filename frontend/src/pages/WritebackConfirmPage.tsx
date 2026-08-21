import { useEffect, useState } from "react";
import { useParams, useLocation, Link } from "react-router-dom";
import { getPublicResult, recordWriteback, type PublicResult } from "../services/controlPlaneClient";
import { writebackSeeding } from "../integrations/startgg";

interface LocationState {
  phaseId: string;
  orderedSeedIds: string[];
}

type WritebackStatus = "idle" | "writing" | "done" | "error";

// FR-011: adjusted order is shown for review, and start.gg is only touched after the
// organizer explicitly approves — never automatically.
export function WritebackConfirmPage() {
  const { runId } = useParams<{ runId: string }>();
  const location = useLocation();
  const state = location.state as LocationState | null;
  const [result, setResult] = useState<PublicResult | null>(null);
  const [status, setStatus] = useState<WritebackStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!runId) return;
    getPublicResult(runId)
      .then(setResult)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [runId]);

  const handleApprove = async () => {
    if (!runId || !state) return;
    setStatus("writing");
    setError(null);
    try {
      await writebackSeeding(state.phaseId, state.orderedSeedIds);
      await recordWriteback(runId);
      setStatus("done");
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  if (error && !result) return <p role="alert">{error}</p>;
  if (!result) return <p>読み込み中...</p>;

  if (!state) {
    return (
      <p role="alert">
        書き戻しに必要な情報が見つかりません(ページの再読み込みで失われた可能性があります)。お手数ですが
        <Link to="/">実行ページ</Link>から再実行してください。結果自体は<Link to={`/results/${runId}`}>こちら</Link>
        で確認できます。
      </p>
    );
  }

  return (
    <section>
      <h1>start.ggへの反映確認</h1>
      <p>以下の並び順・理由を確認し、問題がなければ承認してください。承認するまでstart.gg側のシードは変更されません。</p>

      <table>
        <thead>
          <tr>
            <th>調整後の順位</th>
            <th>選手</th>
            <th>元の順位</th>
          </tr>
        </thead>
        <tbody>
          {result.adjustedEntries.map((entry) => (
            <tr key={entry.adjustedPosition}>
              <td>{entry.adjustedPosition}</td>
              <td>{entry.displayName}</td>
              <td>{entry.originalPosition}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {status === "done" ? (
        <p>start.gg側のシード設定を更新しました。</p>
      ) : (
        <button type="button" onClick={handleApprove} disabled={status === "writing"}>
          {status === "writing" ? "反映中..." : "承認してstart.ggへ反映する"}
        </button>
      )}
      {error && <p role="alert">{error}</p>}
      <p>
        <Link to={`/results/${runId}`}>詳しい結果表示ページを見る</Link>
      </p>
    </section>
  );
}
