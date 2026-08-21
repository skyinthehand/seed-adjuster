import type { Env } from "../index";
import { getSettings, putSettings, type AdjustmentSettingsRecord } from "../db/settingsRepository";
import { jsonResponse, errorResponse } from "./http";

export async function handleGetSettings(targetId: string, env: Env): Promise<Response> {
  const settings = await getSettings(env, targetId);
  return jsonResponse(200, settings);
}

export async function handlePutSettings(targetId: string, request: Request, env: Env): Promise<Response> {
  const body = await request
    .json<Partial<Pick<AdjustmentSettingsRecord, "wizardAnswers" | "overrides"> & { resolvedDefaults: Record<string, unknown> }>>()
    .catch(() => null);
  if (!body || typeof body.wizardAnswers !== "object" || typeof body.overrides !== "object") {
    return errorResponse(400, "INVALID_REQUEST", "wizardAnswers/overrides are required");
  }
  // FR-018: resolvedDefaults is derived from wizardAnswers client-side and passed through
  // as-is; the server only persists it, it does not re-derive it.
  const resolvedDefaults =
    typeof body.resolvedDefaults === "object" && body.resolvedDefaults !== null ? body.resolvedDefaults : {};

  await putSettings(env, targetId, {
    wizardAnswers: body.wizardAnswers as Record<string, unknown>,
    resolvedDefaults,
    overrides: body.overrides as Record<string, unknown>,
  });

  const updated = await getSettings(env, targetId);
  return jsonResponse(200, updated);
}
