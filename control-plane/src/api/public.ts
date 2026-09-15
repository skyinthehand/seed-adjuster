import type { Env } from "../index";
import { getPublicResult, listRunsForTarget, listRunHistory } from "../db/runsRepository";
import { jsonResponse, errorResponse } from "./http";

const DEFAULT_RUN_HISTORY_LIMIT = 30;
const MAX_RUN_HISTORY_LIMIT = 100;

// No authentication on this file's handlers (FR-012b) — hidden_value doesn't exist in this
// feature (spec.md Assumptions, 2026-08-21), so there is nothing to redact here; the browser
// already only ever submits the sanitized fields via POST /runs/{runId}/complete.

export async function handleGetPublicResult(runId: string, env: Env): Promise<Response> {
  const result = await getPublicResult(env, runId);
  if (!result) return errorResponse(404, "NOT_FOUND", "指定された実行結果が見つかりません");
  return jsonResponse(200, result);
}

export async function handleListPublicRuns(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const targetId = url.searchParams.get("targetId");
  if (!targetId) return errorResponse(400, "INVALID_REQUEST", "targetId is required");
  const runs = await listRunsForTarget(env, targetId);
  return jsonResponse(200, { runs });
}

// 003フィーチャー(実行履歴ページ): 対象・設定名を問わず全実行(進行中・成功・失敗)を横断取得する。
// 既存のhandleListPublicRuns(targetId必須・成功のみ)とは責務が異なるため別ハンドラとする(research.md R2)。
export async function handleListRunHistory(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const settingsName = url.searchParams.get("settingsName") ?? undefined;

  const limitParam = Number(url.searchParams.get("limit"));
  const limit = Number.isFinite(limitParam) && limitParam > 0
    ? Math.min(limitParam, MAX_RUN_HISTORY_LIMIT)
    : DEFAULT_RUN_HISTORY_LIMIT;

  const offsetParam = Number(url.searchParams.get("offset"));
  const offset = Number.isFinite(offsetParam) && offsetParam >= 0 ? offsetParam : 0;

  const result = await listRunHistory(env, { settingsName, limit, offset });
  return jsonResponse(200, result);
}
