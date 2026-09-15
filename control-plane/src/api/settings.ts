import type { Env } from "../index";
import { getSettings, putSettings, listSettingsNames, type AdjustmentSettingsRecord } from "../db/settingsRepository";
import { jsonResponse, errorResponse } from "./http";

export async function handleListSettings(env: Env): Promise<Response> {
  const names = await listSettingsNames(env);
  return jsonResponse(200, { names });
}

// `settingsName` is a free-form name the user chooses on the settings page — independent
// from AdjustmentRun's targetId (2026-09-15 policy change, see data-model.md AdjustmentSettings).
export async function handleGetSettings(settingsName: string, env: Env): Promise<Response> {
  const settings = await getSettings(env, settingsName);
  return jsonResponse(200, settings);
}

export async function handlePutSettings(settingsName: string, request: Request, env: Env): Promise<Response> {
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

  await putSettings(env, settingsName, {
    wizardAnswers: body.wizardAnswers as Record<string, unknown>,
    resolvedDefaults,
    overrides: body.overrides as Record<string, unknown>,
  });

  const updated = await getSettings(env, settingsName);
  return jsonResponse(200, updated);
}
