import type { Env } from "../index";
import { getPublicResult, listRunsForTarget } from "../db/runsRepository";
import { jsonResponse, errorResponse } from "./http";

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
