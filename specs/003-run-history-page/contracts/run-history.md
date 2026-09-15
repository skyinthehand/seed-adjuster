# API Contract 追加分: 実行履歴ページ

[001/contracts/api.md](../../001-seed-adjuster-webapp/contracts/api.md)への追加分。001本体の契約は変更しない(既存の`GET /public/runs?targetId=`はそのまま)。

## `POST /runs` の変更

Request bodyに`settingsName`(必須、空文字不可)を追加する。

```json
{
  "targetId": "string",
  "settingsName": "string",
  "inputSource": "google_sheets" | "startgg",
  "sourceReference": { "spreadsheetId": "...", "worksheetName": "..." } | { "eventId": "...", "phaseId": "..." },
  "auditSpreadsheetId": "string | null",
  "settingsSnapshot": {},
  "estimatedDurationSeconds": 0,
  "entrantCount": 0
}
```

`settingsName`欠落時は`400 INVALID_REQUEST`とする(既存の必須項目チェックと同様)。

## `GET /runs/{runId}` の変更

Response bodyに`settingsName: "string | null"`を追加する(運営者向けの実行状況表示。既存フィールドは変更なし)。

## `GET /public/run-history`(新規)

実行履歴ページが、対象・設定名を問わず全実行を新しい順に一覧取得するために使う。認証不要(既存の`/public/*`と同様)。

- Query: `settingsName`(任意、完全一致フィルタ)、`limit`(任意、既定30・上限100)、`offset`(任意、既定0)
- Response 200:
  ```json
  {
    "runs": [
      {
        "runId": "string",
        "targetId": "string",
        "settingsName": "string | null",
        "inputSource": "google_sheets" | "startgg",
        "status": "queued" | "running" | "succeeded" | "failed",
        "createdAt": "ISO8601",
        "startedAt": "ISO8601 | null",
        "finishedAt": "ISO8601 | null"
      }
    ],
    "hasMore": true
  }
  ```
  `createdAt`降順。`hasMore`は`offset + runs.length`より後にさらに実行が存在するかどうか(FR-008の「さらに読み込む」操作の表示可否に使う)。
- Response 200(0件時): `{ "runs": [], "hasMore": false }`(FR-006の空状態はフロントエンド側で表示する)
