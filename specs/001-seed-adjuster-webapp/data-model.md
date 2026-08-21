# Data Model: 対戦相手シード調整ツールの公開Web化

spec.md の Key Entities を、research.md で決定した保管先(ブラウザローカル / Cloudflare D1 / Google スプレッドシート / 静的インデックス)に対応付けて具体化する。フィールド名は実装時の最終命名を拘束しない設計レベルの記述。

**方針転換の要点**: 重い計算(調整アルゴリズム・対戦履歴クエリ)がブラウザ内で完結するようになったこと(research.md #1)に伴い、利用者の認証トークンはサーバー側に一切保存しない設計へ変更した。`ConnectedAccount`はサーバー(Cloudflare D1)のエンティティではなく、ブラウザローカルの状態として扱う。

## 保管先の全体像

| エンティティ | 保管先 | 備考 |
|---|---|---|
| ConnectedAccount | ブラウザローカル(IndexedDB / メモリ) | サーバーには一切送信・保存しない(research.md #4, #5) |
| AdjustmentSettings | Cloudflare D1(control-plane) | 対象(大会)単位で保持。秘匿情報を含まない共有状態 |
| AdjustmentRun | Cloudflare D1(control-plane) | 実行状態の記録。ロックは行わず、同一対象への複数実行を許容する(research.md #3) |
| SeedEntry | 実行時にGoogleスプレッドシート/start.ggからブラウザが直接読み込む(永続保管はしない) | |
| AdjustedSeedResult | Googleスプレッドシート(監査ログ用、ブラウザが直接書き込む) + D1(ブラウザが提出する公開用サニタイズ済みコピー) | 公開結果APIの読み出し元はD1側 |
| DecisionLog | Googleスプレッドシート(監査ログ用) + D1(公開用コピー) | 既存ノートブックのmatch_log相当 |
| WaveConstraintViolation | Googleスプレッドシート(監査ログ用) + D1(公開用コピー) | |
| PreAdjustmentSeedSnapshot | Googleスプレッドシート(監査ログ用、別シート) + D1(公開用コピー) | start.gg入力時のみ生成。個人情報を含まない |
| MatchHistoryIndex | 静的アーティファクト(indexerが生成・GitHub Releasesで公開、Parquet形式) | 実行のたびにブラウザ(DuckDB-WASM)が直接取得して読み込む圧縮対戦履歴 |

---

## ConnectedAccount(ブラウザローカル)

利用者ごとのGoogle/start.gg連携状態。**このエンティティはいかなるサーバーにも存在せず、利用者自身のブラウザ内にのみ存在する。**

- `googleAccessToken`: Google Identity Servicesのトークンクライアントから取得した短命なアクセストークン。ブラウザのメモリ内(実行中のセッションの間)にのみ保持し、永続化しない(research.md #4)
- `googleGrantedScopes`: 付与されたOAuthスコープ一覧(Sheets読み書き・専用スプレッドシート作成用のDrive file scope等)
- `startggAccessToken`: 利用者が設定ページに入力したstart.gg個人アクセストークン。ブラウザのIndexedDBに保存し、次回訪問時も再入力を省略できるようにする(research.md #5)

**バリデーション**: 書き込み系操作(実行開始・設定変更・Startgg書き戻し)は、ブラウザが保持するこのトークンの権限範囲内でのみ行われる(FR-020)。サーバー側はこれらのトークンを一切検証・保管しないため、認可はGoogle/start.gg自身のAPIが行う。

---

## AdjustmentSettings(Cloudflare D1)

調整ロジックのパラメータ。対象(大会=入力元スプレッドシート or start.ggイベント)単位で保持し、Yes/No回答由来の既定値と個別上書き値を区別する。秘匿情報を含まないため、サーバー(D1)に保存して複数端末・複数運営者間で共有してよい。

- `targetId`: 対象の識別子(入力元スプレッドシートIDまたはstart.ggイベント/フェーズID)
- `wizardAnswers`: Yes/No質問への回答一覧(例: 「大会規模は小規模か」「対戦履歴の参照期間を短くするか」等)
- `resolvedDefaults`: `wizardAnswers`から導出された推奨既定値一式(固定シード数、探索幅倍率、対戦履歴として考慮する最低大会規模、参照期間の上限 等)
- `overrides`: 利用者が個別に上書きした値(キーはパラメータ名)
- `effectiveValue(name)` = `overrides[name]` が存在すればそれを優先、なければ `resolvedDefaults[name]`(FR-019)

---

## AdjustmentRun(Cloudflare D1)

シード自動調整1回分の実行記録。**計算そのものはブラウザ内で行われ、Workerはその開始・進捗・完了をブラウザからの報告として記録するのみ。ロックは行わず、同一対象への複数実行を妨げない**(方針変更、spec.md Clarifications参照。research.md #3)。

- `runId`: 一意識別子(公開結果ページのURLにも使用)
- `targetId`: 対象の識別子(AdjustmentSettingsと同じ単位)
- `inputSource`: `google_sheets` | `startgg`
- `sourceReference`: 入力元スプレッドシートID+ワークシート名、またはstart.ggイベント/フェーズID(トークンなど秘匿情報は含まない)
- `auditSpreadsheetId`: 監査ログ保存先スプレッドシートID(FR-012a。未設定の場合、start.gg入力では実行不可)
- `settingsSnapshot`: 実行時点で確定した`AdjustmentSettings.effectiveValue`一式のスナップショット(後から「なぜその調整になったか」を追える形で保存)
- `status`: `queued` → `running` → (`succeeded` | `failed`)。参加者数を理由にした拒否状態は持たない(FR-003a)
- `startedAt` / `finishedAt`
- `failureHint`: 失敗時の原因の手がかり(FR-014)。ブラウザが`fail`報告を送れないまま処理が止まった場合(タブが閉じられた等)、`status`は`running`のまま残りうる。これは公開結果APIやFR-016の履歴表示上は「未完了の実行」として自然に扱われ、他の実行を妨げることはない
- `estimatedDurationSeconds` / `entrantCount`: FR-003aの事前見積もりに使用した値
- `sizeWarning`: `{ shown: boolean, reason: string, estimatedDurationSeconds: number, entrantCount: number } | null`。事前見積もりが60分を大幅に超える場合に設定され、運営者向け・結果表示ページ向けの警告表示に使う。設定されていても実行は`queued`のまま進行する(拒否しない)
- `writebackApproved`: start.gg入力の場合のみ。運営者が書き戻しを承認したかどうか(FR-011)。承認されるまでStartgg側は変更しない。書き戻し自体もブラウザから直接start.gg APIへ行われ、Workerへはその実行結果が事後報告されるのみ。同一対象に対して複数の実行が独立に承認された場合、後から承認された書き戻しが先の書き戻しを上書きしうることを許容する(spec.md Assumptions参照)

**状態遷移**:

```text
queued --(クライアントが計算開始)--> running --(正常終了・complete報告)--> succeeded
running --(エラー報告)--> failed
succeeded --(start.gg入力かつ運営者が承認・ブラウザが直接書き戻しを実行)--> (writeback-recorded報告) --> succeeded(writebackApproved=true)
```

---

## SeedEntry

大会の参加者1名。入力元からブラウザが直接読み込む一時データ(いかなるサーバーにも送信・保管されない。監査ログ側にはAdjustedSeedResult/DecisionLogとして必要な範囲のみ、ブラウザから直接Googleスプレッドシートおよび公開結果として提出される)。

- `userId`: 対戦相手識別用のID
- `displayName`: ゲーマータグ等の公開ハンドル
- `discriminator`: Wave希望マッピング用の識別子(任意)
- `desiredWaves`: 希望Wave一覧(任意)
- `originalOrder`: 入力時点のシード順

---

## AdjustedSeedResult

1回の実行で得られた調整後の並び順。ブラウザ内(Pyodide)で計算される。

- `runId`(AdjustmentRunへの参照)
- `entries[]`: 各選手について `{ displayName, userId, adjustedPosition, originalPosition, adjustedWave }`

**保存先**: (1) 監査ログ用スプレッドシートに新規シートとして、ブラウザが直接追記(FR-012)。Google Sheets入力の場合はさらに元のスプレッドシート内にも同内容が追記される(FR-009)。(2) 認証なしの公開結果APIから読めるよう、ブラウザが`POST /runs/{runId}/complete`でCloudflare D1へサニタイズ済みコピーを提出する(research.md #7)。

---

## DecisionLog

AdjustedSeedResultの各エントリについて、配置決定の判断根拠。ブラウザ内で計算される。

- `runId`
- `position`: 調整後の位置
- `comparedCandidates[]`: 比較した対戦相手候補ごとの `{ candidateUserId, candidateDisplayName, matchPointValue }`
- `decisionLogicType`: `best_left_player_based` | `seed_position_based` など、採用した判定ロジックの種別

**保存先**: AdjustedSeedResultと同様(スプレッドシート + D1公開コピー)。

---

## WaveConstraintViolation

- `runId`
- `position`
- `playerDisplayName`
- `wave`(実際に配置されたWave)
- `allowedWaves[]`(希望していたWave一覧)

**保存先**: AdjustedSeedResultと同様(スプレッドシート + D1公開コピー)。

---

## PreAdjustmentSeedSnapshot

start.gg入力時のみ生成。調整前(Startgg上で仮組みされていた時点)のシード順。ブラウザがstart.ggから読み込んだ内容から生成する。

- `runId`
- `entries[]`: `{ userId, displayName, originalPosition }` のみ(氏名等の個人情報は含めない。FR-012c)

**保存先**: 監査ログ用スプレッドシート内の別シート(ブラウザが直接書き込む) + D1公開コピー。

---

## MatchHistoryIndex(静的アーティファクト)

indexerが生成し、フロントエンド(ブラウザ、DuckDB-WASM)が実行のたびに直接取得して参照する圧縮対戦履歴。形式の詳細は[contracts/match-index-format.md](./contracts/match-index-format.md)を参照。

- `generatedAt`: インデックス生成日時
- `coveragePeriod`: インデックスに含まれる対戦履歴の期間(古すぎる対戦は近さ指標への寄与がほぼ0のため除外。research.md #2参照)
- `pairIndex`: 選手ペア(数値ID`userIdA`, `userIdB`)をキーとした対戦記録一覧。各記録は `{ timestamp, numEntrants }`。Parquet形式(1行28バイトの整数のみ)で配布され、DuckDB-WASMがSQLクエリで参照する。実測調査(research.md #2)では、全期間・全地域(推定約145万試合)を対象としても圧縮後概ね1桁MB台〜十数MB程度と見積もられている

**更新方式**: indexerは前回処理済みの大会以降のみを増分走査し、`pairIndex`を再構築・再公開する。ブラウザは実行開始時に最新版を取得する。
