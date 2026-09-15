// FR-018: derive recommended AdjustmentSettings defaults from a small set of direct
// questions, for organizers who don't want to tune the underlying parameters by name.

import { getSettings } from "../services/controlPlaneClient";

export type SmallTournamentExclusion = "none" | "all" | "topSeedsOnly";

export interface WizardAnswers {
  /** ①シード何位までは調整せず固定とするか */
  fixedSeedNum: number;
  /** ②小規模大会での対戦経験を、誰について考慮外とするか */
  smallTournamentExclusion: SmallTournamentExclusion;
  /** ③(②が"none"以外のときのみ意味を持つ)何人participant以下を小規模大会とするか(2026-09-15: 境界値ちょうどの大会も除外対象に含めるよう修正) */
  smallTournamentMaxEntrants: number;
  /** ④(②が"topSeedsOnly"のときのみ意味を持つ)シード何位まで対象とするか */
  smallTournamentTopSeedLimit: number;
  /** ⑤対戦相手候補の探索幅の倍率 */
  searchBreadthMultiplier: number;
}

export const DEFAULT_WIZARD_ANSWERS: WizardAnswers = {
  fixedSeedNum: 4,
  smallTournamentExclusion: "all",
  smallTournamentMaxEntrants: 16,
  smallTournamentTopSeedLimit: 8,
  searchBreadthMultiplier: 1,
};

/** Recommended parameter values for the underlying algorithm, keyed by name (research.md #9 / spec.md Assumptions). */
export interface ResolvedDefaults {
  fixed_seed_num: number;
  conditional_least_num_entrants: number;
  apply_conditional_least_num_entrants_seed_num: number;
  search_breadth_multiplier: number;
  [key: string]: number;
}

/** T054: shape consumed by runAdjustment.ts's `settings` input (structurally compatible with
 * its AdjustmentSettingsEffective, which carries its own index signature). */
export interface EffectiveSettings {
  ref_date: string;
  fixed_seed_num: number;
  conditional_least_num_entrants: number;
  apply_conditional_least_num_entrants_seed_num: number;
  search_breadth_multiplier: number;
  // FR-006: worksheet names (in the same spreadsheet) holding the desired-Wave settings —
  // ported from seed_adjuster.ipynb's WAVE_PATTERN_WORKSHEET_NAME/PLAYER_WAVE_WORKSHEET_NAME
  // Colab secrets. No wizard-derived default; unset means "no Wave constraints" (as before).
  wavePatternWorksheetName?: string;
  playerWaveWorksheetName?: string;
  [key: string]: unknown;
}

/**
 * FR-019: fetch the named settings profile (wizard-derived defaults + overrides) and
 * resolve them into the concrete values a run actually uses, override taking priority.
 * `settingsName` is a free-form name the user chooses on the settings page, independent
 * from the run's targetId (2026-09-15 policy change — see data-model.md AdjustmentSettings).
 * If no settings have been saved yet under this name (including when left blank), falls
 * back to the wizard's own defaults (DEFAULT_WIZARD_ANSWERS) so a run still gets sane values.
 */
export async function resolveEffectiveSettings(settingsName: string): Promise<EffectiveSettings> {
  const saved = await getSettings(settingsName).catch(() => null);
  const wizardAnswers: WizardAnswers = {
    ...DEFAULT_WIZARD_ANSWERS,
    ...(saved?.wizardAnswers as Partial<WizardAnswers> | undefined),
  } as WizardAnswers;
  const resolvedDefaults =
    saved?.resolvedDefaults && Object.keys(saved.resolvedDefaults).length > 0
      ? saved.resolvedDefaults
      : resolveDefaults(wizardAnswers);
  const overrides = saved?.overrides ?? {};

  const effective = (name: string): number => Number(overrides[name] ?? resolvedDefaults[name]);
  const stringOverride = (name: string): string | undefined => {
    const value = overrides[name];
    return typeof value === "string" && value.trim() !== "" ? value : undefined;
  };

  return {
    ref_date: new Date().toISOString().slice(0, 10),
    fixed_seed_num: effective("fixed_seed_num"),
    conditional_least_num_entrants: effective("conditional_least_num_entrants"),
    apply_conditional_least_num_entrants_seed_num: effective("apply_conditional_least_num_entrants_seed_num"),
    search_breadth_multiplier: effective("search_breadth_multiplier"),
    wavePatternWorksheetName: stringOverride("wavePatternWorksheetName"),
    playerWaveWorksheetName: stringOverride("playerWaveWorksheetName"),
  };
}

// Sentinel matching the original notebook's convention: larger than any realistic seed
// count, so "apply to everyone" can be expressed as "apply up to this seed position".
const UNLIMITED_SEED_NUM = 9999;

export function resolveDefaults(answers: WizardAnswers): ResolvedDefaults {
  const exclusion = answers.smallTournamentExclusion;
  return {
    fixed_seed_num: answers.fixedSeedNum,
    conditional_least_num_entrants: exclusion === "none" ? 0 : answers.smallTournamentMaxEntrants,
    apply_conditional_least_num_entrants_seed_num:
      exclusion === "none" ? 0 : exclusion === "all" ? UNLIMITED_SEED_NUM : answers.smallTournamentTopSeedLimit,
    search_breadth_multiplier: answers.searchBreadthMultiplier,
  };
}
