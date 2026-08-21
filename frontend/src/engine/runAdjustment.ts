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
    matrix.push([...rowValues, "", ...matchLogs[i].map((v) => String(v))]);
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

interface DecisionLogEntry {
  position: number;
  comparedCandidates: { candidateDisplayName: string; matchPointValue: number }[];
  decisionLogicType: string;
}

/**
 * `match_logs[i]` (from seed_adjuster.py) is either `[]` (no comparison needed — e.g. a
 * fixed seed) or `[decisionLogicType, opponentName, "", idx, userId, name, value, idx, ...]`
 * — a flat list of repeating 4-tuples after the 3-element header. See
 * `is_adjusted_seed`/`get_least_match` in seed_adjuster.py for where each 4-tuple comes from.
 */
function parseDecisionLog(matchLogs: unknown[][]): DecisionLogEntry[] {
  const entries: DecisionLogEntry[] = [];
  matchLogs.forEach((row, i) => {
    if (row.length === 0) return;
    const [decisionLogicType, , , ...rest] = row as [string, string, string, ...unknown[]];
    const comparedCandidates: { candidateDisplayName: string; matchPointValue: number }[] = [];
    for (let j = 0; j + 3 < rest.length; j += 4) {
      comparedCandidates.push({ candidateDisplayName: String(rest[j + 2]), matchPointValue: Number(rest[j + 3]) });
    }
    entries.push({ position: i + 1, comparedCandidates, decisionLogicType: String(decisionLogicType) });
  });
  return entries;
}

function resultSheetTitle(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `adjusted_${ts}`;
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

    onStatusChange?.("computing");
    const params: AdjustmentParams = { ...input.settings };
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
