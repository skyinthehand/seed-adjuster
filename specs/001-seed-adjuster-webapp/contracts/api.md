# API Contract: 制御プレーン(Cloudflare Workers)公開インターフェース

フロントエンド(GitHub Pages上の静的SPA)がCloudflare Workers上の制御プレーンAPIを呼び出す際の契約。認証系エンドポイントを除き、`Authorization`ヘッダには `userSessionId` に対応するセッショントークンを付与する。`GET /public/*` 配下は認証不要(FR-012b)。`/internal/*` 配下はGitHub Actionsジョブ専用で、通常のセッショントークンではなくGitHub Actions OIDC IDトークンによる検証を要する(research.md #3)。

各エンドポイントは `data-model.md` のエンティティを参照する。エラーレスポンスは共通形式 `{ "error": { "code": string, "message": string } }` を用いる。

## 認証・設定

### `POST /auth/google/start`
Google OAuth 認可コードフローを開始するための認可URLを発行する。
- Response 200: `{ "authorizationUrl": string }`

### `GET /auth/google/callback`
Googleの認可コード交換を行い、リフレッシュトークンを`ConnectedAccount`に保存する(research.md #5)。
- Query: `code`, `state`
- Response 302: フロントエンドの設定ページへリダイレクト

### `GET /auth/status`
現在のセッションのGoogle/start.gg連携状態を返す。
- Response 200: `{ "google": { "connected": boolean }, "startgg": { "connected": boolean } }`

### `POST /auth/startgg/token`
start.gg個人アクセストークンを登録する(research.md #6)。登録した値は暗号化してD1に保存し、以後どのAPIレスポンスにも生の値を含めない。
- Request: `{ "accessToken": string }`
- Response 200: `{ "connected": true }`(トークンの値自体は返さない)
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
シード自動調整の実行を開始する。`AdjustmentRun`を`queued`状態でD1に作成した上で、GitHub Actionsの`run-adjustment`ワークフローへ`repository_dispatch`(`client_payload: { runId }`)を送信して起動する(research.md #1)。トークン等の秘匿情報はこのペイロードに含めない。
- Request:
  ```json
  {
    "inputSource": "google_sheets" | "startgg",
    "sourceReference": { "spreadsheetId": "...", "worksheetName": "..." } | { "eventId": "...", "phaseId": "..." },
    "auditSpreadsheetId": "string | null"
  }
  ```
- Response 202: `{ "runId": string, "status": "queued", "sizeWarning": { "reason": "string", "estimatedDurationSeconds": number, "entrantCount": number } | null }`。事前見積もり上60分を大幅に超える場合でも実行は拒否せず、`sizeWarning`に警告情報を添えて202を返す(FR-003a)。
- Response 409: 同一`targetId`に対して実行中のRunが既に存在する(FR-013a)。`{ "error": { "code": "RUN_IN_PROGRESS", "message": "...", "existingRunId": string } }`
- Response 428: 監査ログ用スプレッドシート未接続(start.gg入力時、FR-012a)。`{ "error": { "code": "AUDIT_SPREADSHEET_REQUIRED", "message": "..." } }`
- Response 403: 対象への書き込み権限不足(FR-021)

### `GET /runs/{runId}`
実行状況を取得する(運営者向け。ポーリングによりFR-014の状態表示を実現)。
- Response 200:
  ```json
  {
    "runId": "string",
    "targetId": "string",
    "status": "queued" | "running" | "succeeded" | "failed",
    "startedAt": "ISO8601 | null",
    "finishedAt": "ISO8601 | null",
    "failureHint": "string | null",
    "inputSource": "google_sheets" | "startgg",
    "sizeWarning": { "reason": "string", "estimatedDurationSeconds": number, "entrantCount": number } | null,
    "writebackApproved": "boolean | null"
  }
  ```

### `POST /runs/{runId}/writeback/approve`
start.gg入力の実行結果をStartggへ書き戻すことを承認し、反映を実行する(FR-011)。Google Sheets入力の場合は404。
- Response 200: `{ "runId": string, "writebackApproved": true }`
- Response 409: 対象Runがまだ`succeeded`でない、または既に承認済み
- Response 403: start.ggアカウントが対象イベントの運営権限を持たない(FR-021)

## 内部(GitHub Actionsジョブ専用、OIDC検証)

### `POST /internal/runs/{runId}/credentials`
`compute`ジョブが実行開始直後に呼び出し、Google/start.ggの復号済みトークンおよび入力元・監査ログ保存先の参照情報を取得する。GitHub Actions OIDC IDトークンを`Authorization: Bearer`で送付する必要があり、Workerは署名・発行者(`https://token.actions.githubusercontent.com`)・`repository`クレイム(本リポジトリと完全一致)を検証する(research.md #3)。復号済みの値をこのレスポンスとして返すのは、OIDC検証済みの`compute`ジョブに対する一度きりの払い出しのみであり、他のいかなるエンドポイント(`/auth/*`, `GET /runs/*`等)もトークンの値を返さない(research.md #5, #6)。
- Response 200: `{ "googleAccessToken": string, "startggAccessToken": string | null, "sourceReference": object, "auditSpreadsheetId": string, "settingsSnapshot": object }`
- Response 401: OIDC検証失敗
- Response 409: 当該`runId`の資格情報が既に払い出し済み(一度きりの払い出し。research.md #3)

### `POST /internal/runs/{runId}/status`
`compute`ジョブが実行状況を報告する(`running`確定、`succeeded`/`failed`終了、`failureHint`等)。`/internal/runs/{runId}/credentials`と同様にOIDC検証を要する。
- Request: `{ "status": "running" | "succeeded" | "failed", "failureHint": "string | null" }`
- Response 200: `{ "runId": string, "status": "string" }`

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
