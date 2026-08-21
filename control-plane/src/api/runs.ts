import type { Env } from "../index";
import {
  createRun,
  getRun,
  completeRun,
  failRun,
  recordWriteback,
  type CreateRunInput,
  type CompleteRunInput,
} from "../db/runsRepository";
import { jsonResponse, errorResponse } from "./http";

// contracts/api.md: POST /runs never rejects on concurrent runs for the same
// targetId — the multi-run lock was removed (spec.md Clarifications, 2026-08-21).

export async function handleCreateRun(request: Request, env: Env): Promise<Response> {
  const body = await request.json<Partial<CreateRunInput>>().catch(() => null);
  if (
    !body ||
    typeof body.targetId !== "string" ||
    (body.inputSource !== "google_sheets" && body.inputSource !== "startgg") ||
    !body.sourceReference ||
    typeof body.settingsSnapshot !== "object"
  ) {
    return errorResponse(400, "INVALID_REQUEST", "targetId/inputSource/sourceReference/settingsSnapshot are required");
  }

  // FR-012a: Startgg入力は監査ログ用スプレッドシートが未接続だと実行できない。
  if (body.inputSource === "startgg" && !body.auditSpreadsheetId) {
    return errorResponse(
      428,
      "AUDIT_SPREADSHEET_REQUIRED",
      "start.gg入力には監査ログ保存用のGoogleスプレッドシートの接続が必要です",
    );
  }

  const runId = crypto.randomUUID();
  await createRun(env, {
    runId,
    targetId: body.targetId,
    inputSource: body.inputSource,
    sourceReference: body.sourceReference,
    auditSpreadsheetId: body.auditSpreadsheetId ?? null,
    settingsSnapshot: body.settingsSnapshot as Record<string, unknown>,
    estimatedDurationSeconds: body.estimatedDurationSeconds ?? 0,
    entrantCount: body.entrantCount ?? 0,
    sizeWarning: body.sizeWarning ?? null,
  });

  return jsonResponse(202, { runId, status: "queued", sizeWarning: body.sizeWarning ?? null });
}

export async function handleGetRun(runId: string, env: Env): Promise<Response> {
  const run = await getRun(env, runId);
  if (!run) return errorResponse(404, "NOT_FOUND", "runId not found");
  return jsonResponse(200, run);
}

export async function handleCompleteRun(runId: string, request: Request, env: Env): Promise<Response> {
  const existing = await getRun(env, runId);
  if (!existing) return errorResponse(404, "NOT_FOUND", "runId not found");

  const body = await request.json<Partial<CompleteRunInput>>().catch(() => null);
  if (!body || !Array.isArray(body.adjustedEntries) || !Array.isArray(body.decisionLog)) {
    return errorResponse(400, "INVALID_REQUEST", "adjustedEntries/decisionLog are required");
  }

  await completeRun(env, runId, {
    adjustedEntries: body.adjustedEntries,
    decisionLog: body.decisionLog,
    waveConstraintViolations: body.waveConstraintViolations ?? [],
    preAdjustmentSnapshot: body.preAdjustmentSnapshot ?? null,
  });

  return jsonResponse(200, { runId, status: "succeeded" });
}

export async function handleFailRun(runId: string, request: Request, env: Env): Promise<Response> {
  const existing = await getRun(env, runId);
  if (!existing) return errorResponse(404, "NOT_FOUND", "runId not found");

  const body = await request.json<{ failureHint?: string }>().catch(() => ({}) as { failureHint?: string });
  await failRun(env, runId, body.failureHint ?? "不明なエラーが発生しました");
  return jsonResponse(200, { runId, status: "failed" });
}

export async function handleWritebackRecorded(runId: string, env: Env): Promise<Response> {
  const existing = await getRun(env, runId);
  if (!existing) return errorResponse(404, "NOT_FOUND", "runId not found");
  if (existing.status !== "succeeded" || existing.writebackApproved) {
    return errorResponse(409, "INVALID_STATE", "run is not succeeded yet, or writeback already recorded");
  }
  await recordWriteback(env, runId);
  return jsonResponse(200, { runId, writebackApproved: true });
}
