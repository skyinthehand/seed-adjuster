// Google Sheets read/write, called directly from the browser with the access token from
// googleAuth.ts (research.md #4 — never sent to control-plane). Covers FR-009 (write
// adjusted results back as a new sheet, never overwriting existing data) and FR-012a's
// "auto-create a dedicated audit spreadsheet" option.

import { getGoogleAccessToken, clearGoogleAccessToken } from "./googleAuth";

const SHEETS_API_BASE = "https://sheets.googleapis.com/v4/spreadsheets";

export class GoogleSheetsError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** FR-021: surfaces permission/auth failures with a message the UI can show directly. */
async function sheetsFetch(url: string, init?: RequestInit): Promise<Response> {
  const token = getGoogleAccessToken();
  if (!token) {
    throw new GoogleSheetsError(401, "Googleアカウントが未接続です。設定ページで連携してください。");
  }
  const response = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...init?.headers },
  });
  if (response.status === 401) {
    clearGoogleAccessToken();
    throw new GoogleSheetsError(401, "Google認証の有効期限が切れました。設定ページで再度連携してください。");
  }
  if (response.status === 403) {
    throw new GoogleSheetsError(
      403,
      "このスプレッドシートへの編集権限がありません。共有設定を確認するか、権限のあるGoogleアカウントで接続し直してください。",
    );
  }
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new GoogleSheetsError(response.status, `Google Sheets APIエラー (${response.status}): ${body}`);
  }
  return response;
}

export interface WorksheetData {
  header: string[];
  rows: Record<string, string>[];
}

/** Reads a worksheet the way gspread's get_all_records() did in the original notebook. */
export async function readWorksheet(spreadsheetId: string, worksheetName: string): Promise<WorksheetData> {
  const range = encodeURIComponent(`${worksheetName}`);
  const response = await sheetsFetch(`${SHEETS_API_BASE}/${spreadsheetId}/values/${range}`);
  const data: { values?: string[][] } = await response.json();
  const values = data.values ?? [];
  if (values.length === 0) return { header: [], rows: [] };

  const [header, ...dataRows] = values;
  const rows = dataRows.map((row) => {
    const record: Record<string, string> = {};
    header.forEach((col, i) => {
      record[col] = row[i] ?? "";
    });
    return record;
  });
  return { header, rows };
}

/**
 * Appends a new sheet (tab) named `sheetTitle` containing `matrix` (header + data rows).
 * Never touches existing sheets/data — satisfies FR-009's "never overwrite" requirement by
 * construction (addSheet always creates a brand-new tab).
 */
export async function appendResultSheet(
  spreadsheetId: string,
  sheetTitle: string,
  matrix: string[][],
): Promise<void> {
  const addSheetResponse = await sheetsFetch(`${SHEETS_API_BASE}/${spreadsheetId}:batchUpdate`, {
    method: "POST",
    body: JSON.stringify({
      requests: [
        {
          addSheet: {
            properties: {
              title: sheetTitle,
              gridProperties: { rowCount: matrix.length + 5, columnCount: Math.max(26, matrix[0]?.length ?? 0) },
            },
          },
        },
      ],
    }),
  });
  const addSheetBody = await addSheetResponse.json();
  const newSheetTitle: string = addSheetBody.replies[0].addSheet.properties.title;

  const range = encodeURIComponent(`${newSheetTitle}!A1`);
  await sheetsFetch(`${SHEETS_API_BASE}/${spreadsheetId}/values/${range}?valueInputOption=RAW`, {
    method: "PUT",
    body: JSON.stringify({ values: matrix }),
  });
}

/**
 * Creates a brand-new spreadsheet (FR-012a's "auto-create a dedicated audit spreadsheet"
 * option) and returns its ID. Requires the drive.file scope (research.md #4/#8).
 */
export async function createSpreadsheet(title: string): Promise<string> {
  const response = await sheetsFetch(SHEETS_API_BASE, {
    method: "POST",
    body: JSON.stringify({ properties: { title } }),
  });
  const body: { spreadsheetId: string } = await response.json();
  return body.spreadsheetId;
}
