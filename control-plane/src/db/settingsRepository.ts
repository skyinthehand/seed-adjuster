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

// The `target_id` SQL column name predates the 2026-09-15 policy change (settings are now
// keyed by a free-form settingsName the user chooses, independent from AdjustmentRun's
// targetId — see data-model.md AdjustmentSettings). Kept as-is rather than migrating the
// live D1 column; the TypeScript-level parameter name reflects the current meaning.
export async function getSettings(env: Env, settingsName: string): Promise<AdjustmentSettingsRecord> {
  const row = await env.DB.prepare(
    `SELECT wizard_answers_json, resolved_defaults_json, overrides_json
     FROM adjustment_settings WHERE target_id = ?`,
  )
    .bind(settingsName)
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
  settingsName: string,
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
      settingsName,
      JSON.stringify(input.wizardAnswers),
      JSON.stringify(input.resolvedDefaults),
      JSON.stringify(input.overrides),
    )
    .run();
}

/**
 * All registered settings names, for the run page's "使用する設定名" selector — the run
 * page must not allow leaving this unset, so it needs a real list to choose from rather than
 * accepting arbitrary free text (2026-09-15 policy change).
 */
export async function listSettingsNames(env: Env): Promise<string[]> {
  const { results } = await env.DB.prepare(`SELECT target_id FROM adjustment_settings ORDER BY target_id`).all<{
    target_id: string;
  }>();
  return results.map((row) => row.target_id);
}

/** FR-019: an explicit override always wins over the wizard-derived default. */
export function effectiveValue(
  settings: AdjustmentSettingsRecord,
  name: string,
): unknown {
  return name in settings.overrides ? settings.overrides[name] : settings.resolvedDefaults[name];
}
