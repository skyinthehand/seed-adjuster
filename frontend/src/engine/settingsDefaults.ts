// FR-018: derive recommended AdjustmentSettings defaults from a small set of Yes/No
// questions, for organizers who don't want to tune the underlying parameters directly.

import { getSettings } from "../services/controlPlaneClient";

export interface WizardAnswers {
  protectTopSeeds: boolean;
  ignoreSmallTournamentHistory: boolean;
  thoroughSearch: boolean;
}

export const WIZARD_QUESTIONS: {
  key: keyof WizardAnswers;
  label: string;
  help: string;
}[] = [
  {
    key: "protectTopSeeds",
    label: "上位シード(既存のシード1〜4位)は調整の対象から外し、そのまま固定しますか？",
    help: "はい: 上位4シードを動かさず、5位以降のみ対戦相手の履歴に基づいて調整します。",
  },
  {
    key: "ignoreSmallTournamentHistory",
    label: "参加者数の少ない小規模大会での対戦履歴は、参考にしないようにしますか？",
    help: "はい: 参加者16人未満の大会での対戦は、シード調整の判断材料から除外します。",
  },
  {
    key: "thoroughSearch",
    label: "対戦相手候補の探索を広めに行いますか？(大会規模が大きい場合、処理時間が延びる可能性があります)",
    help: "はい: より多くの候補を比較してから配置を決定します。いいえ: 標準的な探索幅で高速に処理します。",
  },
];

export const DEFAULT_WIZARD_ANSWERS: WizardAnswers = {
  protectTopSeeds: true,
  ignoreSmallTournamentHistory: true,
  thoroughSearch: false,
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
  [key: string]: unknown;
}

/**
 * FR-019: fetch the target's saved settings (wizard-derived defaults + overrides) and
 * resolve them into the concrete values a run actually uses, override taking priority.
 * If no settings have been saved yet for this target, falls back to the wizard's own
 * defaults (DEFAULT_WIZARD_ANSWERS) so a first-time run still gets sane values.
 */
export async function resolveEffectiveSettings(targetId: string): Promise<EffectiveSettings> {
  const saved = await getSettings(targetId).catch(() => null);
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

  return {
    ref_date: new Date().toISOString().slice(0, 10),
    fixed_seed_num: effective("fixed_seed_num"),
    conditional_least_num_entrants: effective("conditional_least_num_entrants"),
    apply_conditional_least_num_entrants_seed_num: effective("apply_conditional_least_num_entrants_seed_num"),
    search_breadth_multiplier: effective("search_breadth_multiplier"),
  };
}

export function resolveDefaults(answers: WizardAnswers): ResolvedDefaults {
  return {
    fixed_seed_num: answers.protectTopSeeds ? 4 : 0,
    conditional_least_num_entrants: answers.ignoreSmallTournamentHistory ? 16 : 0,
    // Only meaningful when conditional_least_num_entrants > 0; applies the filter across
    // all non-fixed seeds when history quality matters, otherwise it's a no-op.
    apply_conditional_least_num_entrants_seed_num: answers.ignoreSmallTournamentHistory ? 9999 : 0,
    search_breadth_multiplier: answers.thoroughSearch ? 2 : 1,
  };
}
