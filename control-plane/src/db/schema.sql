-- D1 schema for the control-plane (see data-model.md).
-- No user credentials are ever stored here (research.md #4, #5) — only run
-- bookkeeping, shared parameter settings, and the sanitized public-result copy
-- that the browser submits after a run completes.

CREATE TABLE IF NOT EXISTS adjustment_runs (
  run_id TEXT PRIMARY KEY,
  target_id TEXT NOT NULL,
  input_source TEXT NOT NULL CHECK (input_source IN ('google_sheets', 'startgg')),
  source_reference_json TEXT NOT NULL,
  audit_spreadsheet_id TEXT,
  settings_snapshot_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
  started_at TEXT,
  finished_at TEXT,
  failure_hint TEXT,
  estimated_duration_seconds INTEGER,
  entrant_count INTEGER,
  size_warning_json TEXT,
  writeback_approved INTEGER NOT NULL DEFAULT 0 CHECK (writeback_approved IN (0, 1)),
  -- Sanitized public-result copy submitted via POST /runs/{runId}/complete (research.md #7).
  adjusted_entries_json TEXT,
  decision_log_json TEXT,
  wave_constraint_violations_json TEXT,
  pre_adjustment_snapshot_json TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Supports GET /runs/{runId} and multi-run history lookups (FR-016) without a full scan.
CREATE INDEX IF NOT EXISTS idx_adjustment_runs_target_id
  ON adjustment_runs (target_id, created_at DESC);

CREATE TABLE IF NOT EXISTS adjustment_settings (
  target_id TEXT PRIMARY KEY,
  wizard_answers_json TEXT NOT NULL DEFAULT '{}',
  resolved_defaults_json TEXT NOT NULL DEFAULT '{}',
  overrides_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
