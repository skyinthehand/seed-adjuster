// Typed client for the control-plane API (contracts/api.md). This file only covers the
// run lifecycle (create/status/complete/fail) for now; settings/public/writeback client
// functions are added alongside the tasks that consume them (US3/US4/US5).

const BASE_URL = import.meta.env.VITE_CONTROL_PLANE_API_BASE_URL as string;

export type InputSource = "google_sheets" | "startgg";

export interface SizeWarning {
  reason: string;
  estimatedDurationSeconds: number;
  entrantCount: number;
}

export interface CreateRunRequest {
  targetId: string;
  inputSource: InputSource;
  sourceReference: Record<string, unknown>;
  auditSpreadsheetId: string | null;
  settingsSnapshot: Record<string, unknown>;
  estimatedDurationSeconds: number;
  entrantCount: number;
  sizeWarning?: SizeWarning | null;
}

export interface CreateRunResponse {
  runId: string;
  status: "queued";
  sizeWarning: SizeWarning | null;
}

export class ControlPlaneError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new ControlPlaneError(
      response.status,
      body?.error?.code ?? "UNKNOWN_ERROR",
      body?.error?.message ?? `control-plane returned ${response.status}`,
    );
  }
  return response.json();
}

export function createRun(input: CreateRunRequest): Promise<CreateRunResponse> {
  return request("/runs", { method: "POST", body: JSON.stringify(input) });
}

export interface RunStatusResponse {
  runId: string;
  targetId: string;
  status: "queued" | "running" | "succeeded" | "failed";
  startedAt: string | null;
  finishedAt: string | null;
  failureHint: string | null;
  inputSource: InputSource;
  sizeWarning: SizeWarning | null;
  writebackApproved: boolean | null;
}

export function getRunStatus(runId: string): Promise<RunStatusResponse> {
  return request(`/runs/${runId}`);
}

export interface CompleteRunRequest {
  adjustedEntries: { displayName: string; adjustedPosition: number; originalPosition: number; adjustedWave: string | null }[];
  decisionLog: { position: number; comparedCandidates: { candidateDisplayName: string; matchPointValue: number }[]; decisionLogicType: string }[];
  waveConstraintViolations: { position: number; playerDisplayName: string; wave: string; allowedWaves: string[] }[];
  preAdjustmentSnapshot?: { displayName: string; originalPosition: number }[] | null;
}

export function completeRun(runId: string, input: CompleteRunRequest): Promise<{ runId: string; status: "succeeded" }> {
  return request(`/runs/${runId}/complete`, { method: "POST", body: JSON.stringify(input) });
}

export function failRun(runId: string, failureHint: string): Promise<{ runId: string; status: "failed" }> {
  return request(`/runs/${runId}/fail`, { method: "POST", body: JSON.stringify({ failureHint }) });
}
