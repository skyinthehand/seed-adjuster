# API Contract: 制御プレーン(Cloudflare Workers)公開インターフェース

フロントエンド(GitHub Pages上の静的SPA)がCloudflare Workers上の制御プレーンAPIを呼び出す際の契約。**重い計算(調整アルゴリズムの実行、Google Sheets/start.ggの読み書き)はすべてブラウザが直接行い、制御プレーンはそれらの認証情報を一切扱わない**(research.md #5, #6)。制御プレーンの役割は、複数の利用者・端末間で共有される状態(実行ロック・パラメータ設定・公開結果キャッシュ)の管理のみに限定される。

`GET /public/*` 配下は認証不要(FR-012b)。それ以外のエンドポイントは特別な認証を必要としない(制御プレーンが扱う情報に秘匿情報が含まれないため)が、`runId`のような推測困難な識別子で操作対象を特定する。エラーレスポンスは共通形式 `{ "error": { "code": string, "message": string } }` を用いる。

**注記**: 以前の設計にあった `/auth/google/*`(OAuth認可コード交換)、`/auth/startgg/token`(サーバー側トークン保存)、`/internal/*`(GitHub Actions OIDC検証による資格情報払い出し)は、認証がすべてブラウザ内で完結するようになったことに伴い廃止された(research.md #5, #6)。

## 設定

### `GET /settings/{targetId}`
対象の現在の`AdjustmentSettings`(推奨既定値・上書き値)を取得する。
- Response 200: `{ "wizardAnswers": object, "resolvedDefaults": object, "overrides": object }`

### `PUT /settings/{targetId}`
Yes/No回答および個別上書き値を更新する(FR-018, FR-019)。
- Request: `{ "wizardAnswers": object, "overrides": object }`
- Response 200: 更新後の`AdjustmentSettings`

## 実行(ロック・進捗・結果提出)

計算そのものはブラウザ内(Pyodide/DuckDB-WASM)で行われる。以下のエンドポイントは、複数利用者間での多重実行防止(FR-013a)と、認証なしで閲覧できる公開結果(FR-012b)を成立させるための状態管理に用いる。

### `POST /runs`
シード自動調整の実行意図を登録し、対象への排他ロックを取得する。ブラウザは、このレスポンスで`runId`を受け取った後にローカルでの計算を開始する。
- Request:
  ```json
  {
    "targetId": "string",
    "inputSource": "google_sheets" | "startgg",
    "sourceReference": { "spreadsheetId": "...", "worksheetName": "..." } | { "eventId": "...", "phaseId": "..." },
    "auditSpreadsheetId": "string | null",
    "settingsSnapshot": object,
    "estimatedDurationSeconds": number,
    "entrantCount": number
  }
  ```
- Response 202: `{ "runId": string, "status": "queued", "sizeWarning": { "reason": "string", "estimatedDurationSeconds": number, "entrantCount": number } | null }`。事前見積もり上60分を大幅に超える場合でも実行は拒否せず、`sizeWarning`に警告情報を添えて202を返す(FR-003a)。
- Response 409: 同一`targetId`に対して実行中(ハートビート有効期限内)のRunが既に存在する(FR-013a)。`{ "error": { "code": "RUN_IN_PROGRESS", "message": "...", "existingRunId": string } }`
- Response 428: 監査ログ用スプレッドシート未接続(start.gg入力時、FR-012a)。`{ "error": { "code": "AUDIT_SPREADSHEET_REQUIRED", "message": "..." } }`

### `POST /runs/{runId}/heartbeat`
クライアントが計算中、一定間隔で呼び出す(research.md #4)。`status`を`running`に確定させ、`lastHeartbeatAt`を更新する。
- Response 200: `{ "runId": string, "status": "running" }`
- Response 404/410: 当該`runId`が既にハートビート途絶により`failed`とされた場合

### `POST /runs/{runId}/complete`
計算完了後、ブラウザが公開結果のサニタイズ済みコピー(非公開評価値を含まない)を提出する(research.md #8)。`status`を`succeeded`にする。
- Request:
  ```json
  {
    "adjustedEntries": [ { "displayName": "string", "adjustedPosition": 1, "originalPosition": 5, "adjustedWave": "string | null" } ],
    "decisionLog": [ { "position": 1, "comparedCandidates": [ { "candidateDisplayName": "string", "matchPointValue": 0.0 } ], "decisionLogicType": "string" } ],
    "waveConstraintViolations": [ { "position": 3, "playerDisplayName": "string", "wave": "string", "allowedWaves": ["string"] } ],
    "preAdjustmentSnapshot": [ { "displayName": "string", "originalPosition": 1 } ] 
  }
  ```
  `preAdjustmentSnapshot`は`inputSource = "startgg"`の場合のみ含む(FR-012c)。
- Response 200: `{ "runId": string, "status": "succeeded" }`

### `POST /runs/{runId}/fail`
計算がブラウザ側で失敗した場合に報告する。
- Request: `{ "failureHint": "string" }`
- Response 200: `{ "runId": string, "status": "failed" }`

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

### `POST /runs/{runId}/writeback-recorded`
start.gg入力の場合、運営者が確認画面で書き戻しを承認し、**ブラウザが直接start.gg APIへ書き戻しを実行した後**、その完了を記録するために呼び出す(FR-011)。制御プレーン自身はstart.ggへの書き込みを行わない。
- Response 200: `{ "runId": string, "writebackApproved": true }`
- Response 409: 対象Runがまだ`succeeded`でない、または既に記録済み

## 公開結果(認証不要)

### `GET /public/results/{runId}`
`POST /runs/{runId}/complete`でブラウザが提出したサニタイズ済みコピーをそのまま返す(FR-012b)。非公開評価値(hidden_value)はそもそも提出データに含まれないため、除外の実装はブラウザ側(complete提出前)で完結している。
- Response 200:
  ```json
  {
    "runId": "string",
    "targetId": "string",
    "inputSource": "google_sheets" | "startgg",
    "finishedAt": "ISO8601",
    "adjustedEntries": [ { "displayName": "string", "adjustedPosition": 1, "originalPosition": 5, "adjustedWave": "string | null" } ],
    "decisionLog": [ { "position": 1, "comparedCandidates": [ { "candidateDisplayName": "string", "matchPointValue": 0.0 } ], "decisionLogicType": "string" } ],
    "waveConstraintViolations": [ { "position": 3, "playerDisplayName": "string", "wave": "string", "allowedWaves": ["string"] } ],
    "preAdjustmentSnapshot": [ { "displayName": "string", "originalPosition": 1 } ]
  }
  ```
  `preAdjustmentSnapshot` は `inputSource = "startgg"` の場合のみ含まれる(FR-012c)。
- Response 404: 指定`runId`が存在しない、または`status`が`succeeded`でない

### `GET /public/runs?targetId={targetId}`
同一対象に対する過去の実行一覧を返す(FR-016)。
- Response 200: `{ "runs": [ { "runId": string, "finishedAt": "ISO8601", "inputSource": "string" } ] }`(新しい順)

## start.gg CORSリレー(条件付き、research.md #7)

start.gg APIがブラウザからの直接呼び出し(CORS)を許可しない場合にのみ用いる。実装前に検証し、不要と判明すればこのエンドポイントは実装しない。

### `POST /relay/startgg`
リクエストボディとAuthorizationヘッダをそのまま start.gg のGraphQLエンドポイントへ転送し、レスポンスをそのまま返す。リクエスト内容・トークンはログに一切記録しない。
- Request: start.gg GraphQL APIへのリクエストとそのまま同じ形(`{ "query": "...", "variables": {...} }`)、`Authorization: Bearer <利用者のstart.ggトークン>`
- Response: start.gg APIのレスポンスをそのまま透過
