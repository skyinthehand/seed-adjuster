import type { Env } from "../index";

export type InputSource = "google_sheets" | "startgg";
export type RunStatus = "queued" | "running" | "succeeded" | "failed";

export interface SourceReference {
  spreadsheetId?: string;
  worksheetName?: string;
  eventId?: string;
  phaseId?: string;
}

export interface SizeWarning {
  reason: string;
  estimatedDurationSeconds: number;
  entrantCount: number;
}

export interface CreateRunInput {
  runId: string;
  targetId: string;
  settingsName: string;
  inputSource: InputSource;
  sourceReference: SourceReference;
  auditSpreadsheetId: string | null;
  settingsSnapshot: Record<string, unknown>;
  estimatedDurationSeconds: number;
  entrantCount: number;
  sizeWarning: SizeWarning | null;
}

export interface AdjustedEntry {
  displayName: string;
  adjustedPosition: number;
  originalPosition: number;
  adjustedWave: string | null;
}

export interface DecisionLogEntry {
  position: number;
  comparedCandidates: { candidateDisplayName: string; matchPointValue: number }[];
  decisionLogicType: string;
}

export interface WaveConstraintViolation {
  position: number;
  playerDisplayName: string;
  wave: string;
  allowedWaves: string[];
}

export interface PreAdjustmentSnapshotEntry {
  displayName: string;
  originalPosition: number;
}

export interface CompleteRunInput {
  adjustedEntries: AdjustedEntry[];
  decisionLog: DecisionLogEntry[];
  waveConstraintViolations: WaveConstraintViolation[];
  preAdjustmentSnapshot: PreAdjustmentSnapshotEntry[] | null;
}

export interface AdjustmentRunRecord {
  runId: string;
  targetId: string;
  settingsName: string | null;
  inputSource: InputSource;
  status: RunStatus;
  startedAt: string | null;
  finishedAt: string | null;
  failureHint: string | null;
  sizeWarning: SizeWarning | null;
  writebackApproved: boolean;
}

export interface PublicResult {
  runId: string;
  targetId: string;
  inputSource: InputSource;
  finishedAt: string;
  adjustedEntries: AdjustedEntry[];
  decisionLog: DecisionLogEntry[];
  waveConstraintViolations: WaveConstraintViolation[];
  preAdjustmentSnapshot: PreAdjustmentSnapshotEntry[] | null;
}

const nowIso = () => new Date().toISOString();

export async function createRun(env: Env, input: CreateRunInput): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO adjustment_runs (
       run_id, target_id, settings_name, input_source, source_reference_json, audit_spreadsheet_id,
       settings_snapshot_json, status, started_at, estimated_duration_seconds,
       entrant_count, size_warning_json
     ) VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?)`,
  )
    .bind(
      input.runId,
      input.targetId,
      input.settingsName,
      input.inputSource,
      JSON.stringify(input.sourceReference),
      input.auditSpreadsheetId,
      JSON.stringify(input.settingsSnapshot),
      nowIso(),
      input.estimatedDurationSeconds,
      input.entrantCount,
      input.sizeWarning ? JSON.stringify(input.sizeWarning) : null,
    )
    .run();
}

export async function getRun(env: Env, runId: string): Promise<AdjustmentRunRecord | null> {
  const row = await env.DB.prepare(
    `SELECT run_id, target_id, settings_name, input_source, status, started_at, finished_at,
            failure_hint, size_warning_json, writeback_approved
     FROM adjustment_runs WHERE run_id = ?`,
  )
    .bind(runId)
    .first<Record<string, unknown>>();
  if (!row) return null;
  return {
    runId: row.run_id as string,
    targetId: row.target_id as string,
    settingsName: (row.settings_name as string | null) ?? null,
    inputSource: row.input_source as InputSource,
    status: row.status as RunStatus,
    startedAt: row.started_at as string | null,
    finishedAt: row.finished_at as string | null,
    failureHint: row.failure_hint as string | null,
    sizeWarning: row.size_warning_json ? JSON.parse(row.size_warning_json as string) : null,
    writebackApproved: Boolean(row.writeback_approved),
  };
}

export async function completeRun(
  env: Env,
  runId: string,
  input: CompleteRunInput,
): Promise<void> {
  await env.DB.prepare(
    `UPDATE adjustment_runs SET
       status = 'succeeded',
       finished_at = ?,
       adjusted_entries_json = ?,
       decision_log_json = ?,
       wave_constraint_violations_json = ?,
       pre_adjustment_snapshot_json = ?
     WHERE run_id = ?`,
  )
    .bind(
      nowIso(),
      JSON.stringify(input.adjustedEntries),
      JSON.stringify(input.decisionLog),
      JSON.stringify(input.waveConstraintViolations),
      input.preAdjustmentSnapshot ? JSON.stringify(input.preAdjustmentSnapshot) : null,
      runId,
    )
    .run();
}

export async function failRun(env: Env, runId: string, failureHint: string): Promise<void> {
  await env.DB.prepare(
    `UPDATE adjustment_runs SET status = 'failed', finished_at = ?, failure_hint = ? WHERE run_id = ?`,
  )
    .bind(nowIso(), failureHint, runId)
    .run();
}

export async function recordWriteback(env: Env, runId: string): Promise<void> {
  await env.DB.prepare(`UPDATE adjustment_runs SET writeback_approved = 1 WHERE run_id = ?`)
    .bind(runId)
    .run();
}

export async function getPublicResult(env: Env, runId: string): Promise<PublicResult | null> {
  const row = await env.DB.prepare(
    `SELECT run_id, target_id, input_source, status, finished_at,
            adjusted_entries_json, decision_log_json, wave_constraint_violations_json,
            pre_adjustment_snapshot_json
     FROM adjustment_runs WHERE run_id = ?`,
  )
    .bind(runId)
    .first<Record<string, unknown>>();
  if (!row || row.status !== "succeeded") return null;
  return {
    runId: row.run_id as string,
    targetId: row.target_id as string,
    inputSource: row.input_source as InputSource,
    finishedAt: row.finished_at as string,
    adjustedEntries: JSON.parse((row.adjusted_entries_json as string) ?? "[]"),
    decisionLog: JSON.parse((row.decision_log_json as string) ?? "[]"),
    waveConstraintViolations: JSON.parse((row.wave_constraint_violations_json as string) ?? "[]"),
    preAdjustmentSnapshot: row.pre_adjustment_snapshot_json
      ? JSON.parse(row.pre_adjustment_snapshot_json as string)
      : null,
  };
}

export interface RunHistoryEntry {
  runId: string;
  finishedAt: string;
  inputSource: InputSource;
}

export async function listRunsForTarget(env: Env, targetId: string): Promise<RunHistoryEntry[]> {
  const { results } = await env.DB.prepare(
    `SELECT run_id, finished_at, input_source FROM adjustment_runs
     WHERE target_id = ? AND status = 'succeeded'
     ORDER BY finished_at DESC`,
  )
    .bind(targetId)
    .all<Record<string, unknown>>();
  return results.map((row) => ({
    runId: row.run_id as string,
    finishedAt: row.finished_at as string,
    inputSource: row.input_source as InputSource,
  }));
}

// Distinct from RunHistoryEntry above (which backs the narrower, existing
// GET /public/runs?targetId= for FR-016) to avoid a same-name/different-shape clash;
// this backs the new GET /public/run-history (003フィーチャー, contracts/run-history.md).
export interface RunHistorySummary {
  runId: string;
  targetId: string;
  settingsName: string | null;
  inputSource: InputSource;
  status: RunStatus;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface ListRunHistoryParams {
  settingsName?: string;
  limit: number;
  offset: number;
}

export async function listRunHistory(
  env: Env,
  params: ListRunHistoryParams,
): Promise<{ runs: RunHistorySummary[]; hasMore: boolean }> {
  const whereClause = params.settingsName ? "WHERE settings_name = ?" : "";
  const bindings = params.settingsName
    ? [params.settingsName, params.limit + 1, params.offset]
    : [params.limit + 1, params.offset];

  const { results } = await env.DB.prepare(
    `SELECT run_id, target_id, settings_name, input_source, status, created_at, started_at, finished_at
     FROM adjustment_runs
     ${whereClause}
     ORDER BY created_at DESC
     LIMIT ? OFFSET ?`,
  )
    .bind(...bindings)
    .all<Record<string, unknown>>();

  const hasMore = results.length > params.limit;
  const rows = hasMore ? results.slice(0, params.limit) : results;

  return {
    runs: rows.map((row) => ({
      runId: row.run_id as string,
      targetId: row.target_id as string,
      settingsName: (row.settings_name as string | null) ?? null,
      inputSource: row.input_source as InputSource,
      status: row.status as RunStatus,
      createdAt: row.created_at as string,
      startedAt: row.started_at as string | null,
      finishedAt: row.finished_at as string | null,
    })),
    hasMore,
  };
}
