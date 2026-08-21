import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { getRunStatus, type RunStatusResponse } from "../services/controlPlaneClient";

const POLL_INTERVAL_MS = 3000;

export function RunStatusPage() {
  const { runId } = useParams<{ runId: string }>();
  const [status, setStatus] = useState<RunStatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!runId) return;
    let cancelled = false;

    async function poll() {
      try {
        const result = await getRunStatus(runId!);
        if (cancelled) return;
        setStatus(result);
        if (result.status === "queued" || result.status === "running") {
          setTimeout(poll, POLL_INTERVAL_MS);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    }
    poll();

    return () => {
      cancelled = true;
    };
  }, [runId]);

  if (error) return <p role="alert">{error}</p>;
  if (!status) return <p>読み込み中...</p>;

  return (
    <section>
      <h1>実行状況</h1>
      <p>状態: {statusLabel(status.status)}</p>
      {status.sizeWarning && (
        <p role="alert">
          {status.sizeWarning.reason}(想定処理時間: 約{Math.ceil(status.sizeWarning.estimatedDurationSeconds / 60)}分、
          参加者数: {status.sizeWarning.entrantCount}人)
        </p>
      )}
      {status.status === "failed" && (
        <p role="alert">実行に失敗しました{status.failureHint ? `: ${status.failureHint}` : ""}</p>
      )}
      {status.status === "succeeded" && (
        <p>
          完了しました。<Link to={`/results/${status.runId}`}>結果を見る</Link>
        </p>
      )}
    </section>
  );
}

function statusLabel(status: RunStatusResponse["status"]): string {
  switch (status) {
    case "queued":
      return "待機中";
    case "running":
      return "実行中";
    case "succeeded":
      return "完了";
    case "failed":
      return "失敗";
  }
}
