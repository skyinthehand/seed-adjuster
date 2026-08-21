# Data Model: 対戦相手シード調整ツールの公開Web化

spec.md の Key Entities を、research.md で決定した保管先(Cloudflare D1 / Google スプレッドシート / 静的インデックス)に対応付けて具体化する。フィールド名は実装時の最終命名を拘束しない設計レベルの記述。

## 保管先の全体像

| エンティティ | 保管先 | 備考 |
|---|---|---|
| ConnectedAccount | Cloudflare D1(control-plane) | 認証トークンは暗号化して保存。無料プラン・カード登録不要(research.md #0, #2) |
| AdjustmentSettings | Cloudflare D1(control-plane) | 対象(大会)単位で保持 |
| AdjustmentRun | Cloudflare D1(control-plane) | 実行状態・ロックを兼ねる |
| SeedEntry | 実行時にGoogleスプレッドシート/start.ggから読み込む(永続保管はしない) | |
| AdjustedSeedResult | Googleスプレッドシート(監査ログ用) + D1(実行への参照) | 公開結果APIの読み出し元 |
| DecisionLog | Googleスプレッドシート(監査ログ用) | 既存ノートブックのmatch_log相当 |
| WaveConstraintViolation | Googleスプレッドシート(監査ログ用) | |
| PreAdjustmentSeedSnapshot | Googleスプレッドシート(監査ログ用、別シート) | start.gg入力時のみ生成。個人情報を含まない |
| MatchHistoryIndex | 静的アーティファクト(indexerが生成・GitHub Releasesで公開) | 実行のたびにcomputeジョブが読み込む圧縮対戦履歴 |

---

## ConnectedAccount

利用者ごとのGoogle/start.gg連携状態。

- `userSessionId`: このツールにおける利用者を識別するID(ブラウザセッション/簡易アカウントの識別子)
- `googleRefreshTokenEncrypted`: Google OAuthのリフレッシュトークン(暗号化)。未連携時はnull
- `googleGrantedScopes`: 付与されたOAuthスコープ一覧(Sheets読み書き・専用スプレッドシート作成用のDrive file scope等)
- `startggAccessTokenEncrypted`: start.gg個人アクセストークン(利用者が設定ページに入力した値をそのまま暗号化して保存。研究上の暫定対応ではなく採用方式として確定。research.md #6)。未連携時はnull
- `connectedAt` / `lastUsedAt`

**バリデーション**: 書き込み系操作(実行開始・設定変更・Startgg書き戻し)は、リクエスト元の`userSessionId`に紐づくConnectedAccountの認可範囲内でのみ許可する(FR-020)。

**漏洩防止(research.md #5, #6)**: `googleRefreshTokenEncrypted` / `startggAccessTokenEncrypted` の暗号鍵はD1には保存せず、Cloudflare Workersのシークレットとして別管理する。いずれの値も、登録後にAPIレスポンスへ含めて返してはならない(`GET /auth/status`は真偽値のみを返す)。ログ(Cloudflare Workers・GitHub Actions双方)にも出力してはならない。

---

## AdjustmentSettings

調整ロジックのパラメータ。対象(大会=入力元スプレッドシート or start.ggイベント)単位で保持し、Yes/No回答由来の既定値と個別上書き値を区別する。

- `targetId`: 対象の識別子(入力元スプレッドシートIDまたはstart.ggイベント/フェーズID)
- `wizardAnswers`: Yes/No質問への回答一覧(例: 「大会規模は小規模か」「対戦履歴の参照期間を短くするか」等)
- `resolvedDefaults`: `wizardAnswers`から導出された推奨既定値一式(固定シード数、探索幅倍率、対戦履歴として考慮する最低大会規模、参照期間の上限 等)
- `overrides`: 利用者が個別に上書きした値(キーはパラメータ名)
- `effectiveValue(name)` = `overrides[name]` が存在すればそれを優先、なければ `resolvedDefaults[name]`(FR-019)

---

## AdjustmentRun

シード自動調整1回分の実行。実行状態の管理と、対象ごとの多重実行ロック(FR-013a)を兼ねる。

- `runId`: 一意識別子(公開結果ページのURLにも使用)
- `targetId`: 対象の識別子(AdjustmentSettingsと同じ単位)
- `inputSource`: `google_sheets` | `startgg`
- `sourceReference`: 入力元スプレッドシートID+ワークシート名、またはstart.ggイベント/フェーズID
- `auditSpreadsheetId`: 監査ログ保存先スプレッドシートID(FR-012a。未設定の場合、start.gg入力では実行不可)
- `settingsSnapshot`: 実行時点で確定した`AdjustmentSettings.effectiveValue`一式のスナップショット(後から「なぜその調整になったか」を追える形で保存)
- `status`: `queued` → `running` → (`succeeded` | `failed`)。参加者数を理由にした拒否状態は持たない(FR-003a)
- `startedAt` / `finishedAt`
- `failureHint`: 失敗時の原因の手がかり(FR-014)。GitHub Actionsのジョブタイムアウト到達による失敗もここに含まれうる(research.md #8)
- `estimatedDurationSeconds` / `entrantCount`: FR-003aの事前見積もりに使用した値
- `sizeWarning`: `{ shown: boolean, reason: string, estimatedDurationSeconds: number, entrantCount: number } | null`。事前見積もりが60分を大幅に超える場合に設定され、運営者向け・結果表示ページ向けの警告表示に使う。設定されていても実行は`queued`のまま進行する(拒否しない)
- `writebackApproved`: start.gg入力の場合のみ。運営者が書き戻しを承認したかどうか(FR-011)。承認されるまでStartgg側は変更しない

**状態遷移**:

```text
queued --(ジョブ起動。sizeWarningがあってもブロックしない)--> running --(正常終了)--> succeeded
running --(エラー、またはジョブタイムアウト到達)--> failed
succeeded --(start.gg入力かつ運営者が承認)--> (Startggへの書き戻し実行) --> succeeded(writebackApproved=true)
```

**多重実行防止**: `targetId`に対して`status`が`queued`または`running`のAdjustmentRunが既に存在する場合、新規AdjustmentRunの作成をD1のトランザクション(SQLiteのUNIQUE制約+トランザクション)で拒否する(FR-013a)。

---

## SeedEntry

大会の参加者1名。入力元から読み込む一時データ(永続保管はしない。監査ログ側にはAdjustedSeedResult/DecisionLogとして必要な範囲のみ残る)。

- `userId`: 対戦相手識別用のID
- `displayName`: ゲーマータグ等の公開ハンドル
- `hiddenValue`: 非公開評価値(結果表示ページでは非表示。FR-012b)
- `discriminator`: Wave希望マッピング用の識別子(任意)
- `desiredWaves`: 希望Wave一覧(任意)
- `originalOrder`: 入力時点のシード順

---

## AdjustedSeedResult

1回の実行で得られた調整後の並び順。

- `runId`(AdjustmentRunへの参照)
- `entries[]`: 各選手について `{ displayName, userId, adjustedPosition, originalPosition, adjustedWave }`
- `hiddenValue`は含まない(公開結果APIのレスポンス生成時点で除外。FR-012b)

**保存先**: 監査ログ用スプレッドシートに新規シートとして追記(FR-012)。Google Sheets入力の場合はさらに元のスプレッドシート内にも同内容が追記される(FR-009)。

---

## DecisionLog

AdjustedSeedResultの各エントリについて、配置決定の判断根拠。

- `runId`
- `position`: 調整後の位置
- `comparedCandidates[]`: 比較した対戦相手候補ごとの `{ candidateUserId, candidateDisplayName, matchPointValue }`
- `decisionLogicType`: `best_left_player_based` | `seed_position_based` など、採用した判定ロジックの種別

---

## WaveConstraintViolation

- `runId`
- `position`
- `playerDisplayName`
- `wave`(実際に配置されたWave)
- `allowedWaves[]`(希望していたWave一覧)

---

## PreAdjustmentSeedSnapshot

start.gg入力時のみ生成。調整前(Startgg上で仮組みされていた時点)のシード順。

- `runId`
- `entries[]`: `{ userId, displayName, originalPosition }` のみ(氏名等の個人情報・hiddenValueは含めない。FR-012c)

**保存先**: 監査ログ用スプレッドシート内の別シート。

---

## MatchHistoryIndex(静的アーティファクト)

indexerが生成し、computeジョブが実行のたびに取得して参照する圧縮対戦履歴。

- `generatedAt`: インデックス生成日時
- `coveragePeriod`: インデックスに含まれる対戦履歴の期間(古すぎる対戦は近さ指標への寄与がほぼ0のため除外。research.md #4参照)
- `pairIndex`: 選手ペア(`userIdA`, `userIdB`)をキーとした対戦記録一覧。各記録は `{ timestamp, numEntrants }`

**更新方式**: indexerは前回処理済みの大会以降のみを増分走査し、`pairIndex`を再構築・再公開する。computeジョブは実行開始時に最新版を取得する。
