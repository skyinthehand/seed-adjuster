// Run orchestration for User Story 1 (Google Sheets path). Ties together: reading the seed
// table (googleSheets.ts), fetching match history (matchIndex.ts), running the algorithm
// (pyodideRuntime.ts), writing the result sheet (googleSheets.ts), and reporting the run's
// lifecycle to control-plane (controlPlaneClient.ts). See plan.md Project Structure.

import { readWorksheet, appendResultSheet } from "../integrations/googleSheets";
import { getCurrentSeeding } from "../integrations/startgg";
import { loadMatchLookup } from "../data/matchIndex";
import { runAdjustment as runPyodideAdjustment, type AdjustmentParams } from "./pyodideRuntime";
import { createRun, completeRun, failRun, ControlPlaneError } from "../services/controlPlaneClient";
import { computeSizeWarning } from "./runEstimate";
import { MATCH_INDEX_MANIFEST_URL } from "../config";

export interface AdjustmentSettingsEffective {
  ref_date: string;
  fixed_seed_num: number;
  conditional_least_num_entrants: number;
  apply_conditional_least_num_entrants_seed_num: number;
  search_breadth_multiplier: number;
  wave_pattern?: Record<number, string>;
  wave_cycle_length?: number;
  allowed_waves_map?: Record<string, string[]>;
  [key: string]: unknown;
}

export interface RunGoogleSheetsInput {
  targetId: string;
  settingsName: string;
  spreadsheetId: string;
  worksheetName: string;
  settings: AdjustmentSettingsEffective;
}

export interface RunResult {
  runId: string;
  sizeWarningShown: boolean;
}

/** FR-013: warn before an in-flight run gets interrupted by navigation/tab close. */
let activeRunCount = 0;
function beforeUnloadHandler(e: BeforeUnloadEvent) {
  e.preventDefault();
  e.returnValue = "";
}
function markRunStarted() {
  activeRunCount++;
  if (activeRunCount === 1) window.addEventListener("beforeunload", beforeUnloadHandler);
}
function markRunFinished() {
  activeRunCount = Math.max(0, activeRunCount - 1);
  if (activeRunCount === 0) window.removeEventListener("beforeunload", beforeUnloadHandler);
}

/**
 * Builds the output sheet matrix, mirroring seed_adjuster.ipynb cell 7's layout so existing
 * spreadsheet-based workflows keep working: original columns, then phaseseed/originalPhaseseed
 * /wave, then a blank column, then the per-position decision log, then (if any) a Wave
 * constraint violation section.
 */
function buildResultMatrix(
  originalHeader: string[],
  adjustedData: Record<string, unknown>[],
  matchLogs: unknown[][],
  waveViolations: { phaseseed: number; player_name: string; wave: string; allowed_waves: string[] }[],
): string[][] {
  const outputKeys = [...originalHeader];
  if (!outputKeys.includes("phaseseed")) {
    const idx = outputKeys.indexOf("original_phaseseed");
    if (idx >= 0) outputKeys.splice(idx, 0, "phaseseed");
    else outputKeys.push("phaseseed");
  }
  if (!outputKeys.includes("original_phaseseed")) outputKeys.push("original_phaseseed");
  if (!outputKeys.includes("adjusted_wave")) {
    const idx = outputKeys.indexOf("original_phaseseed");
    outputKeys.splice(idx + 1, 0, "adjusted_wave");
  }

  const displayHeader = outputKeys.map((col) => {
    if (col === "original_phaseseed") return "originalPhaseseed";
    if (col === "adjusted_wave") return "wave";
    return col;
  });
  const header = [...displayHeader, "", "match_type", "projected_opponent", "", "note"];

  const matrix: string[][] = [header];
  adjustedData.forEach((row, i) => {
    const rowValues = outputKeys.map((col) => (col in row ? String(row[col] ?? "") : ""));
    matrix.push([...rowValues, "", ...spreadsheetMatchLogRow(matchLogs[i]).map((v) => String(v))]);
  });

  if (waveViolations.length > 0) {
    matrix.push([]);
    matrix.push(["[警告] Wave希望を満たせなかった選手"]);
    matrix.push(["phaseseed", "player_name", "wave", "allowed_waves"]);
    for (const v of waveViolations) {
      matrix.push([String(v.phaseseed), v.player_name, v.wave, v.allowed_waves.join(",")]);
    }
  }

  return matrix;
}

interface ComparedCandidateMatch {
  tournamentId: number;
  date: string;
  count: number;
}

interface DecisionLogEntry {
  position: number;
  comparedCandidates: {
    candidateDisplayName: string;
    matchPointValue: number;
    matches: ComparedCandidateMatch[];
    originalSeedPosition: number;
  }[];
  decisionLogicType: string;
  /** The bracket-mirror opponent this position is projected to face (calc_opponent_index in
   * seed_adjuster.py) — the entrant seeded above this one whose seed is numerically closest.
   * Was already computed and present in match_logs[i][1] but previously discarded here. */
  projectedOpponentDisplayName: string;
}

// [opponentIndex, opponentUserId, name, matchPointValue, rawMatches, originalSeedPosition] —
// see is_adjusted_seed/get_least_match in seed_adjuster.py for where each chunk comes from.
// rawMatches is `[[timestamp, tournamentId], ...]`, unaggregated (research.md R5); the
// "same tournament+date -> 1 entry with a count" grouping (spec.md Clarifications) happens
// below in aggregateMatches(), not in Python. originalSeedPosition is that candidate's
// 1-indexed position in the original (pre-adjustment) seed order.
const CANDIDATE_CHUNK_SIZE = 6;

/** Unix seconds -> "YYYY-MM-DD" in JST, matching the JST-based ref_date handling elsewhere
 * in this codebase (seed_adjuster.py's get_midnight_jst_unixtime_from_str). */
function toJstDateString(unixSeconds: number): string {
  const jst = new Date((unixSeconds + 9 * 3600) * 1000);
  const y = jst.getUTCFullYear();
  const m = String(jst.getUTCMonth() + 1).padStart(2, "0");
  const d = String(jst.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function aggregateMatches(rawMatches: unknown): ComparedCandidateMatch[] {
  if (!Array.isArray(rawMatches)) return [];
  const byKey = new Map<string, ComparedCandidateMatch>();
  for (const m of rawMatches) {
    if (!Array.isArray(m) || m.length < 2) continue;
    const [timestamp, tournamentId] = m as [number, number];
    const date = toJstDateString(Number(timestamp));
    const key = `${tournamentId}:${date}`;
    const existing = byKey.get(key);
    if (existing) existing.count += 1;
    else byKey.set(key, { tournamentId: Number(tournamentId), date, count: 1 });
  }
  return [...byKey.values()];
}

/**
 * `match_logs[i]` (from seed_adjuster.py) is either `[]` (no comparison needed — e.g. a
 * fixed seed) or `[decisionLogicType, opponentName, "", <CANDIDATE_CHUNK_SIZE-tuple>, ...]`
 * — a flat list of repeating chunks after the 3-element header.
 */
function parseDecisionLog(matchLogs: unknown[][]): DecisionLogEntry[] {
  const entries: DecisionLogEntry[] = [];
  matchLogs.forEach((row, i) => {
    if (row.length === 0) return;
    const [decisionLogicType, projectedOpponentDisplayName, , ...rest] = row as [
      string,
      string,
      string,
      ...unknown[],
    ];
    const comparedCandidates: DecisionLogEntry["comparedCandidates"] = [];
    for (let j = 0; j + CANDIDATE_CHUNK_SIZE - 1 < rest.length; j += CANDIDATE_CHUNK_SIZE) {
      comparedCandidates.push({
        candidateDisplayName: String(rest[j + 2]),
        matchPointValue: Number(rest[j + 3]),
        matches: aggregateMatches(rest[j + 4]),
        originalSeedPosition: Number(rest[j + 5]),
      });
    }
    // "元のシード値が高い順" (UI label): sorted by originalSeedPosition descending — starting
    // from the candidate whose original seed was numerically highest (the weakest original
    // seed among those compared) down to the lowest (closest to seed 1).
    comparedCandidates.sort((a, b) => b.originalSeedPosition - a.originalSeedPosition);
    entries.push({
      position: i + 1,
      comparedCandidates,
      decisionLogicType: String(decisionLogicType),
      projectedOpponentDisplayName: String(projectedOpponentDisplayName),
    });
  });
  return entries;
}

/**
 * The audit spreadsheet only ever showed [idx, userId, name, value] per candidate
 * (buildResultMatrix predates matches[]/originalSeedPosition) — strip the 5th/6th
 * (rawMatches/originalSeedPosition) elements per chunk so the spreadsheet output is
 * unchanged rather than gaining stringified extra columns.
 */
function spreadsheetMatchLogRow(row: unknown[]): unknown[] {
  if (row.length === 0) return [];
  const [decisionLogicType, opponentName, blank, ...rest] = row;
  const flattened: unknown[] = [decisionLogicType, opponentName, blank];
  for (let j = 0; j + CANDIDATE_CHUNK_SIZE - 1 < rest.length; j += CANDIDATE_CHUNK_SIZE) {
    flattened.push(rest[j], rest[j + 1], rest[j + 2], rest[j + 3]);
  }
  return flattened;
}

function resultSheetTitle(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `adjusted_${ts}`;
}

/**
 * FR-006: loads the desired-Wave settings from two optional worksheets (in the same
 * spreadsheet as the main seed table), ported from seed_adjuster.ipynb's
 * WAVE_PATTERN_WORKSHEET_NAME/PLAYER_WAVE_WORKSHEET_NAME logic:
 *  - wavePatternWorksheetName: columns `pattern` (a 1-based cycle position) and `wave` (its
 *    name). Missing/unreadable is non-fatal — falls back to "no Wave constraints", matching
 *    the notebook's behavior.
 *  - playerWaveWorksheetName: columns `discriminator` (must match the main sheet's
 *    `discriminator` column) and `wave` (one of that player's desired Waves; multiple rows
 *    per discriminator are allowed). Requires the main sheet to have a `discriminator`
 *    column, and every discriminator referenced here to exist there — both are fatal errors,
 *    matching the notebook.
 */
async function loadWaveSettings(
  spreadsheetId: string,
  header: string[],
  initialData: Record<string, unknown>[],
  settings: AdjustmentSettingsEffective,
): Promise<Pick<AdjustmentParams, "wave_pattern" | "wave_cycle_length" | "allowed_waves_map">> {
  let wavePattern: Record<number, string> | undefined;
  let waveCycleLength: number | undefined;
  const wavePatternWorksheetName = settings.wavePatternWorksheetName as string | undefined;
  if (wavePatternWorksheetName) {
    try {
      const { rows } = await readWorksheet(spreadsheetId, wavePatternWorksheetName);
      const pattern: Record<number, string> = {};
      for (const row of rows) pattern[Number(row["pattern"])] = row["wave"];
      wavePattern = pattern;
      const positions = Object.keys(pattern).map(Number);
      waveCycleLength = positions.length > 0 ? Math.max(...positions) : 1;
    } catch {
      // Non-fatal, mirroring the notebook's try/except: fall back to no Wave constraints.
    }
  }

  let allowedWavesMap: Record<string, string[]> | undefined;
  const playerWaveWorksheetName = settings.playerWaveWorksheetName as string | undefined;
  if (playerWaveWorksheetName) {
    if (!header.includes("discriminator")) {
      throw new Error("メインシートに discriminator 列がありません");
    }
    const { rows } = await readWorksheet(spreadsheetId, playerWaveWorksheetName);
    const mainDiscriminators = new Set(initialData.map((row) => String(row["discriminator"] ?? "")));
    const missing = rows
      .map((row) => String(row["discriminator"] ?? ""))
      .filter((disc) => !mainDiscriminators.has(disc));
    if (missing.length > 0) {
      throw new Error(`メインシートに存在しない discriminator があります: ${missing.join(", ")}`);
    }
    const map: Record<string, string[]> = {};
    for (const row of rows) {
      const disc = String(row["discriminator"] ?? "");
      (map[disc] ??= []).push(row["wave"]);
    }
    allowedWavesMap = map;
  }

  return { wave_pattern: wavePattern, wave_cycle_length: waveCycleLength, allowed_waves_map: allowedWavesMap };
}

export async function runGoogleSheetsAdjustment(
  input: RunGoogleSheetsInput,
  onStatusChange?: (status: "reading" | "computing" | "writing") => void,
): Promise<RunResult> {
  const { header, rows } = await readWorksheet(input.spreadsheetId, input.worksheetName);
  if (rows.length === 0) {
    throw new Error("シード表が空です。指定したワークシートを確認してください。");
  }

  const initialData = rows.map((row, i) => ({
    ...row,
    user_id: Number(row["user_id"]),
    player_name: row["player_name"] ?? row["gamer_tag"] ?? "",
    original_input_order: i + 1,
  }));
  const entrantCount = initialData.length;
  const sizeWarning = computeSizeWarning(entrantCount);

  const { runId } = await createRun({
    targetId: input.targetId,
    settingsName: input.settingsName,
    inputSource: "google_sheets",
    sourceReference: { spreadsheetId: input.spreadsheetId, worksheetName: input.worksheetName },
    auditSpreadsheetId: input.spreadsheetId,
    settingsSnapshot: input.settings,
    estimatedDurationSeconds: sizeWarning?.estimatedDurationSeconds ?? 0,
    entrantCount,
    sizeWarning,
  });

  markRunStarted();
  try {
    onStatusChange?.("reading");
    const entrantUserIds = initialData.map((e) => e.user_id);
    const matchLookup = await loadMatchLookup(MATCH_INDEX_MANIFEST_URL, entrantUserIds);
    const waveSettings = await loadWaveSettings(input.spreadsheetId, header, initialData, input.settings);

    onStatusChange?.("computing");
    const params: AdjustmentParams = { ...input.settings, ...waveSettings };
    const result = await runPyodideAdjustment(initialData, matchLookup, params);

    onStatusChange?.("writing");
    const matrix = buildResultMatrix(header, result.adjusted_data, result.match_logs, result.wave_violations);
    await appendResultSheet(input.spreadsheetId, resultSheetTitle(), matrix);

    await completeRun(runId, {
      adjustedEntries: result.adjusted_data.map((row) => ({
        displayName: String(row.player_name ?? ""),
        adjustedPosition: Number(row.phaseseed),
        originalPosition: Number(row.original_phaseseed),
        adjustedWave: (row.adjusted_wave as string) || null,
      })),
      decisionLog: parseDecisionLog(result.match_logs),
      waveConstraintViolations: result.wave_violations.map((v) => ({
        position: v.phaseseed,
        playerDisplayName: v.player_name,
        wave: v.wave,
        allowedWaves: v.allowed_waves,
      })),
      preAdjustmentSnapshot: null,
    });

    return { runId, sizeWarningShown: sizeWarning !== null };
  } catch (err) {
    await failRun(runId, err instanceof Error ? err.message : String(err)).catch(() => undefined);
    throw err;
  } finally {
    markRunFinished();
  }
}

export interface RunStartggInput {
  targetId: string;
  settingsName: string;
  phaseId: string;
  auditSpreadsheetId: string;
  settings: AdjustmentSettingsEffective;
}

export interface StartggRunResult extends RunResult {
  phaseId: string;
  /** seed_id, in the NEW (adjusted) order — needed by WritebackConfirmPage (US4). Only
   * available for the lifetime of this page session (not persisted); if the page is
   * reloaded before the organizer approves the write-back, they need to re-run (consistent
   * with FR-013's "re-run if interrupted" fallback used throughout this feature). */
  orderedSeedIds: string[];
}

export async function runStartggAdjustment(
  input: RunStartggInput,
  onStatusChange?: (status: "reading" | "computing" | "writing") => void,
): Promise<StartggRunResult> {
  onStatusChange?.("reading");
  const seeds = await getCurrentSeeding(input.phaseId);
  if (seeds.length === 0) {
    throw new Error("start.ggから仮組みシードを取得できませんでした。フェーズIDを確認してください。");
  }

  const initialData = seeds.map((s) => ({ ...s }));
  const entrantCount = initialData.length;
  const sizeWarning = computeSizeWarning(entrantCount);

  let runId: string;
  try {
    ({ runId } = await createRun({
      targetId: input.targetId,
      settingsName: input.settingsName,
      inputSource: "startgg",
      sourceReference: { phaseId: input.phaseId },
      auditSpreadsheetId: input.auditSpreadsheetId,
      settingsSnapshot: input.settings,
      estimatedDurationSeconds: sizeWarning?.estimatedDurationSeconds ?? 0,
      entrantCount,
      sizeWarning,
    }));
  } catch (err) {
    // FR-012a: surfaced distinctly so the UI can prompt for/auto-create the audit sheet.
    if (err instanceof ControlPlaneError && err.code === "AUDIT_SPREADSHEET_REQUIRED") {
      throw new Error("監査ログ保存用のGoogleスプレッドシートの接続が必要です。");
    }
    throw err;
  }

  markRunStarted();
  try {
    const entrantUserIds = initialData.map((e) => e.user_id);
    const matchLookup = await loadMatchLookup(MATCH_INDEX_MANIFEST_URL, entrantUserIds);

    onStatusChange?.("computing");
    const params: AdjustmentParams = { ...input.settings };
    const result = await runPyodideAdjustment(initialData, matchLookup, params);

    onStatusChange?.("writing");
    // FR-012: 監査ログ(結果 + 判断根拠)を監査用スプレッドシートへ。
    const originalHeader = ["user_id", "player_name"];
    const resultMatrix = buildResultMatrix(originalHeader, result.adjusted_data, result.match_logs, result.wave_violations);
    await appendResultSheet(input.auditSpreadsheetId, resultSheetTitle(), resultMatrix);

    // FR-012c: 調整前(Startgg仮組み時点)のシード順を、個人情報を含めない別シートとして保存。
    const preAdjustmentMatrix: string[][] = [
      ["displayName", "originalPosition"],
      ...seeds.map((s) => [s.player_name, String(s.original_input_order)]),
    ];
    await appendResultSheet(input.auditSpreadsheetId, `pre_adjustment_${resultSheetTitle()}`, preAdjustmentMatrix);

    await completeRun(runId, {
      adjustedEntries: result.adjusted_data.map((row) => ({
        displayName: String(row.player_name ?? ""),
        adjustedPosition: Number(row.phaseseed),
        originalPosition: Number(row.original_phaseseed),
        adjustedWave: (row.adjusted_wave as string) || null,
      })),
      decisionLog: parseDecisionLog(result.match_logs),
      waveConstraintViolations: result.wave_violations.map((v) => ({
        position: v.phaseseed,
        playerDisplayName: v.player_name,
        wave: v.wave,
        allowedWaves: v.allowed_waves,
      })),
      preAdjustmentSnapshot: seeds.map((s) => ({
        displayName: s.player_name,
        originalPosition: s.original_input_order,
      })),
    });

    // seed_id was carried through on each SeedEntry (see StartggSeedEntry) — pull it back
    // out in adjusted order for the write-back step (US4, not executed here — FR-011
    // requires explicit organizer approval first).
    const seedIdByUserId = new Map(seeds.map((s) => [s.user_id, s.seed_id]));
    const orderedSeedIds = result.adjusted_data.map((row) => seedIdByUserId.get(Number(row.user_id))!);

    return { runId, phaseId: input.phaseId, orderedSeedIds, sizeWarningShown: sizeWarning !== null };
  } catch (err) {
    await failRun(runId, err instanceof Error ? err.message : String(err)).catch(() => undefined);
    throw err;
  } finally {
    markRunFinished();
  }
}
