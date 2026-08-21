import type { Env } from "../index";

export interface AdjustmentSettingsRecord {
  wizardAnswers: Record<string, unknown>;
  resolvedDefaults: Record<string, unknown>;
  overrides: Record<string, unknown>;
}

const EMPTY_SETTINGS: AdjustmentSettingsRecord = {
  wizardAnswers: {},
  resolvedDefaults: {},
  overrides: {},
};

export async function getSettings(env: Env, targetId: string): Promise<AdjustmentSettingsRecord> {
  const row = await env.DB.prepare(
    `SELECT wizard_answers_json, resolved_defaults_json, overrides_json
     FROM adjustment_settings WHERE target_id = ?`,
  )
    .bind(targetId)
    .first<Record<string, unknown>>();
  if (!row) return EMPTY_SETTINGS;
  return {
    wizardAnswers: JSON.parse(row.wizard_answers_json as string),
    resolvedDefaults: JSON.parse(row.resolved_defaults_json as string),
    overrides: JSON.parse(row.overrides_json as string),
  };
}

export async function putSettings(
  env: Env,
  targetId: string,
  input: Pick<AdjustmentSettingsRecord, "wizardAnswers" | "overrides"> & {
    resolvedDefaults: Record<string, unknown>;
  },
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO adjustment_settings (target_id, wizard_answers_json, resolved_defaults_json, overrides_json, updated_at)
     VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
     ON CONFLICT(target_id) DO UPDATE SET
       wizard_answers_json = excluded.wizard_answers_json,
       resolved_defaults_json = excluded.resolved_defaults_json,
       overrides_json = excluded.overrides_json,
       updated_at = excluded.updated_at`,
  )
    .bind(
      targetId,
      JSON.stringify(input.wizardAnswers),
      JSON.stringify(input.resolvedDefaults),
      JSON.stringify(input.overrides),
    )
    .run();
}

/** FR-019: an explicit override always wins over the wizard-derived default. */
export function effectiveValue(
  settings: AdjustmentSettingsRecord,
  name: string,
): unknown {
  return name in settings.overrides ? settings.overrides[name] : settings.resolvedDefaults[name];
}
