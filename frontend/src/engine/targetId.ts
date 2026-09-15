// Shared targetId construction. RunPage.tsx and SettingsPage.tsx MUST produce byte-identical
// targetId strings for the same underlying target, or settings saved on one page silently
// fail to be found at run time and fall back to defaults with no visible error (real incident,
// 2026-09-15: a targetId saved without the worksheet-name suffix never matched the one
// RunPage.tsx builds with it, so overrides silently never applied). Both pages must build
// targetId exclusively through these two functions — never inline the `:` concatenation.

export type InputSource = "google_sheets" | "startgg";

export function buildGoogleSheetsTargetId(spreadsheetId: string, worksheetName: string): string {
  return `${spreadsheetId}:${worksheetName}`;
}

export function buildStartggTargetId(phaseId: string): string {
  return `startgg:${phaseId}`;
}
