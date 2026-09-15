import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { listRunHistory, listSettingsNames, type RunHistorySummary } from "../services/controlPlaneClient";

const PAGE_SIZE = 30;

export function HistoryPage() {
  const [settingsNames, setSettingsNames] = useState<string[] | null>(null);
  const [settingsNameFilter, setSettingsNameFilter] = useState("");
  const [runs, setRuns] = useState<RunHistorySummary[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listSettingsNames()
      .then((res) => setSettingsNames(res.names))
      .catch(() => setSettingsNames([]));
  }, []);

  useEffect(() => {
    load(settingsNameFilter);
  }, [settingsNameFilter]);

  async function load(settingsName: string) {
    setLoading(true);
    setError(null);
    try {
      const result = await listRunHistory({
        settingsName: settingsName || undefined,
        limit: PAGE_SIZE,
        offset: 0,
      });
      setRuns(result.runs);
      setHasMore(result.hasMore);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function loadMore() {
    if (!runs) return;
    try {
      const result = await listRunHistory({
        settingsName: settingsNameFilter || undefined,
        limit: PAGE_SIZE,
        offset: runs.length,
      });
      setRuns([...runs, ...result.runs]);
      setHasMore(result.hasMore);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <section>
      <h1>実行履歴</h1>

      <label htmlFor="settingsNameFilter">設定名で絞り込み</label>
      <select
        id="settingsNameFilter"
        value={settingsNameFilter}
        onChange={(e) => setSettingsNameFilter(e.target.value)}
        disabled={!settingsNames}
      >
        <option value="">(絞り込みなし)</option>
        {settingsNames?.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>

      {error && (
        <p role="alert">
          実行履歴の取得に失敗しました: {error}{" "}
          <button onClick={() => load(settingsNameFilter)}>再試行</button>
        </p>
      )}

      {loading && !runs && <p>読み込み中...</p>}

      {runs && runs.length === 0 && !error && <p>まだ実行履歴がありません。</p>}

      {runs && runs.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>設定名</th>
              <th>入力方式</th>
              <th>実行日時</th>
              <th>ステータス</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <HistoryRow key={run.runId} run={run} />
            ))}
          </tbody>
        </table>
      )}

      {hasMore && (
        <p>
          <button onClick={loadMore}>さらに読み込む</button>
        </p>
      )}
    </section>
  );
}

function HistoryRow({ run }: { run: RunHistorySummary }) {
  const settingsNameLabel = run.settingsName ?? "設定名不明";
  const inputSourceLabel = formatInputSource(run.inputSource);
  const createdAtLabel = formatDateTime(run.createdAt);

  return (
    <tr>
      <td>{settingsNameLabel}</td>
      <td>{inputSourceLabel}</td>
      <td>{createdAtLabel}</td>
      <td>
        <StatusCell run={run} />
      </td>
    </tr>
  );
}

function StatusCell({ run }: { run: RunHistorySummary }) {
  const label = formatRunStatus(run.status);
  if (run.status === "succeeded") {
    return <Link to={`/results/${run.runId}`}>{label}</Link>;
  }
  if (run.status === "failed") {
    return (
      <span style={{ color: "#b00020", fontWeight: "bold" }}>
        {label}(この実行は失敗しました)
      </span>
    );
  }
  // queued / running
  return <span>{label}(まだ結果はありません)</span>;
}

function formatRunStatus(status: RunHistorySummary["status"]): string {
  switch (status) {
    case "queued":
    case "running":
      return "実行中";
    case "succeeded":
      return "成功";
    case "failed":
      return "失敗";
  }
}

function formatInputSource(inputSource: RunHistorySummary["inputSource"]): string {
  return inputSource === "google_sheets" ? "Googleスプレッドシート" : "start.gg";
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("ja-JP");
}
