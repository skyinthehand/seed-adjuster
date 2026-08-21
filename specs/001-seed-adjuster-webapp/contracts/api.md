# API Contract: バックエンド公開インターフェース

フロントエンド(GitHub Pages上の静的SPA)がCloud Run上のバックエンドAPIを呼び出す際の契約。認証系エンドポイントを除き、`Authorization`ヘッダには `userSessionId` に対応するセッショントークンを付与する。`GET /public/*` 配下は認証不要(FR-012b)。

各エンドポイントは `data-model.md` のエンティティを参照する。エラーレスポンスは共通形式 `{ "error": { "code": string, "message": string } }` を用いる。

## 認証・設定

### `POST /auth/google/start`
Google OAuth 認可コードフローを開始するための認可URLを発行する。
- Response 200: `{ "authorizationUrl": string }`

### `GET /auth/google/callback`
Googleの認可コード交換を行い、リフレッシュトークンを`ConnectedAccount`に保存する(research.md #4)。
- Query: `code`, `state`
- Response 302: フロントエンドの設定ページへリダイレクト

### `GET /auth/status`
現在のセッションのGoogle/start.gg連携状態を返す。
- Response 200: `{ "google": { "connected": boolean }, "startgg": { "connected": boolean } }`

### `POST /auth/startgg/token`
start.gg個人アクセストークンを登録する(research.md #5)。
- Request: `{ "accessToken": string }`
- Response 200: `{ "connected": true }`
- Response 400: トークン検証失敗(start.gg APIへの疎通確認結果)

### `GET /settings/{targetId}`
対象の現在の`AdjustmentSettings`(推奨既定値・上書き値)を取得する。
- Response 200: `{ "wizardAnswers": object, "resolvedDefaults": object, "overrides": object }`

### `PUT /settings/{targetId}`
Yes/No回答および個別上書き値を更新する(FR-018, FR-019)。
- Request: `{ "wizardAnswers": object, "overrides": object }`
- Response 200: 更新後の`AdjustmentSettings`

## 実行

### `POST /runs`
シード自動調整の実行を開始する。
- Request:
  ```json
  {
    "inputSource": "google_sheets" | "startgg",
    "sourceReference": { "spreadsheetId": "...", "worksheetName": "..." } | { "eventId": "...", "phaseId": "..." },
    "auditSpreadsheetId": "string | null"
  }
  ```
- Response 202: `{ "runId": string, "status": "queued" }`
- Response 409: 同一`targetId`に対して実行中のRunが既に存在する(FR-013a)。`{ "error": { "code": "RUN_IN_PROGRESS", "message": "...", "existingRunId": string } }`
- Response 422: 事前見積もりにより実行を拒否(FR-003a)。`{ "error": { "code": "ESTIMATED_TIME_EXCEEDED", "message": "...", "entrantCount": number, "recommendedMaxEntrants": number } }`
- Response 428: 監査ログ用スプレッドシート未接続(start.gg入力時、FR-012a)。`{ "error": { "code": "AUDIT_SPREADSHEET_REQUIRED", "message": "..." } }`
- Response 403: 対象への書き込み権限不足(FR-021)

### `GET /runs/{runId}`
実行状況を取得する(運営者向け。ポーリングによりFR-014の状態表示を実現)。
- Response 200:
  ```json
  {
    "runId": "string",
    "targetId": "string",
    "status": "queued" | "running" | "succeeded" | "failed" | "rejected_preflight",
    "startedAt": "ISO8601 | null",
    "finishedAt": "ISO8601 | null",
    "failureHint": "string | null",
    "inputSource": "google_sheets" | "startgg",
    "writebackApproved": "boolean | null"
  }
  ```

### `POST /runs/{runId}/writeback/approve`
start.gg入力の実行結果をStartggへ書き戻すことを承認し、反映を実行する(FR-011)。Google Sheets入力の場合は404。
- Response 200: `{ "runId": string, "writebackApproved": true }`
- Response 409: 対象Runがまだ`succeeded`でない、または既に承認済み
- Response 403: start.ggアカウントが対象イベントの運営権限を持たない(FR-021)

## 公開結果(認証不要)

### `GET /public/results/{runId}`
調整結果を、非公開評価値(hidden_value)を除外して返す(FR-012b)。
- Response 200:
  ```json
  {
    "runId": "string",
    "targetId": "string",
    "inputSource": "google_sheets" | "startgg",
    "finishedAt": "ISO8601",
    "adjustedEntries": [
      { "displayName": "string", "adjustedPosition": 1, "originalPosition": 5, "adjustedWave": "string | null" }
    ],
    "decisionLog": [
      { "position": 1, "comparedCandidates": [ { "candidateDisplayName": "string", "matchPointValue": 0.0 } ], "decisionLogicType": "string" }
    ],
    "waveConstraintViolations": [
      { "position": 3, "playerDisplayName": "string", "wave": "string", "allowedWaves": ["string"] }
    ],
    "preAdjustmentSnapshot": [
      { "displayName": "string", "originalPosition": 1 }
    ]
  }
  ```
  `preAdjustmentSnapshot` は `inputSource = "startgg"` の場合のみ含まれる(FR-012c)。
- Response 404: 指定`runId`が存在しない、または`status`が`succeeded`でない

### `GET /public/runs?targetId={targetId}`
同一対象に対する過去の実行一覧を返す(FR-016)。
- Response 200: `{ "runs": [ { "runId": string, "finishedAt": "ISO8601", "inputSource": "string" } ] }`(新しい順)
