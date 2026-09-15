# Research: 実行履歴ページ

spec.mdで方針が固まっている点は再掲せず、実装アプローチを決めるために調査・決定した点のみを記す。

## R1. 「使用した設定名」を実行記録にどう持たせるか

**現状の調査結果**: `control-plane`の`adjustment_runs`テーブル(`control-plane/src/db/schema.sql`)には、実行時に確定した設定値のスナップショット(`settings_snapshot_json`)は保存されているが、**その値がどの設定名(`AdjustmentSettings.settingsName`)に由来するかを示すカラムは存在しない**。フロントエンド側も、`POST /runs`(`createRun`)のリクエストボディに`settingsName`を含めていない(`frontend/src/engine/runAdjustment.ts`の`runGoogleSheetsAdjustment`/`runStartggAdjustment`は`settingsSnapshot`のみ送信)。設定名は`RunPage.tsx`のローカル状態にはあるが、実行記録側には一切残っていない。

**Decision**: `adjustment_runs`テーブルに`settings_name TEXT`カラム(NULL許容)を追加し、`POST /runs`のリクエストボディに`settingsName`(必須文字列)を追加する。フロントエンドは`RunGoogleSheetsInput`/`RunStartggInput`に`settingsName`を追加し、`createRun`呼び出し時に渡す(呼び出し元の`RunPage.tsx`は既に`settingsName`をstateとして保持しているため、値を素通しするだけでよい)。

既存テーブルは`CREATE TABLE IF NOT EXISTS`方式(`control-plane/package.json`の`db:migrate:local`/`db:migrate:remote`が`schema.sql`をそのまま`wrangler d1 execute`する)であり、**本番のD1には既にこのテーブルが存在するため、`schema.sql`の列定義を書き換えるだけでは反映されない**。本フィーチャーで初めて、稼働中のテーブルへの`ALTER TABLE adjustment_runs ADD COLUMN settings_name TEXT`が必要になる。これは実装タスク側で「デプロイ操作の事前確認」(constitution 原則II)の対象として扱う。

本フィーチャー実装より前に作成された実行記録は`settings_name`が`NULL`になる。履歴ページはこれを「設定名不明」として表示し、設定名によるフィルタの対象には含めない(絞り込みなし=全件表示の状態でのみ表示される)。

**Rationale**: 設定名とは独立した`targetId`空間という2026-09-15の方針転換(spec.md 001, data-model.md 001)に整合させたまま、履歴一覧・絞り込み(FR-003, FR-007)に必要な情報を実行記録自体に持たせる。スナップショット値(`settings_snapshot_json`)から設定名を逆引きする手段はない(スナップショットは値のコピーであり、後から設定が変更されれば余計に一致しなくなる)ため、実行時点の設定名をそのまま記録する以外の方法はない。

**Alternatives considered**:
- `settingsSnapshot`の内容から近い設定を推測する: 値が同じでも設定名が異なる場合・設定変更後に値が変わる場合があり、正確性を保証できないため不採用。
- 履歴ページでは設定名を表示せず`targetId`のみで代替する: spec.md FR-003(設定名を含む識別情報)に反するため不採用。

## R2. 全実行を横断的に一覧・絞り込みするAPI設計

**Decision**: 新規エンドポイント`GET /public/run-history`を追加する。既存の`GET /public/runs?targetId=`(FR-016、結果ページの「同一対象の過去実行」用、`status='succeeded'`のみを返す)はそのまま変更しない。新エンドポイントは:

- クエリパラメータ: `settingsName`(任意、完全一致)、`limit`(任意、既定値・上限は実装時に決定するが目安30件)、`offset`(任意、既定0)
- レスポンス: `{ "runs": [ { "runId", "targetId", "settingsName": "string | null", "inputSource", "status", "createdAt", "startedAt": "string | null", "finishedAt": "string | null" } ], "hasMore": boolean }`
- ステータス(`queued`/`running`/`succeeded`/`failed`)を問わず全件を対象とし、`created_at`降順で返す

既存エンドポイントと責務を分けることで、FR-016(対象を知っている前提での過去実行選択、成功のみ)の既存挙動に一切影響を与えない。

**Rationale**: 新機能の要件(全ステータス・全対象を横断・設定名フィルタ・段階読み込み)は既存エンドポイントの要件(特定対象・成功のみ)と形も用途も異なり、無理に1本化すると分岐が増えて可読性が落ちる。002フィーチャーが既存契約を直接拡張せず新規ファイル(`contracts/tournament-directory.md`)で追加分を説明した前例に倣う。

**Alternatives considered**:
- `GET /public/runs`の`targetId`を任意化し、パラメータで挙動を切り替える: 既存呼び出し元(ResultsPage)への影響有無の検証コストが増え、意味も混在するため不採用。

## R3. ページネーション方式

**Decision**: オフセット方式(`limit`/`offset`)を採用する。

**Rationale**: spec.mdのScale(SC-003は「50件を超える状態」を想定)は個人〜小規模チーム運用を前提としており、実行回数は現実的には数百件程度に留まる見込み。この規模ではオフセット方式のパフォーマンス上の欠点(大きなoffsetでのスキャンコスト)は問題にならず、実装・検証が単純なオフセット方式で要件を満たせる。

**Alternatives considered**: `created_at`+`run_id`によるカーソール方式。新規実行が挿入され続ける状況での「ページ境界での重複/抜け」を厳密に防げる利点はあるが、この規模・用途では過剰な複雑さであり不採用。

## R4. 設定名による絞り込みのUI

**Decision**: 履歴ページの絞り込みUIは、フリーテキストではなく`GET /settings`(既存、登録済み設定名一覧)から取得した名前一覧を選択肢とする`<select>`(未選択時は絞り込みなし=全件表示)とする。

**Rationale**: RunPageの「実行時に設定名を選択必須にする」変更(2026-09-15、data-model.md 001)と同じ理由で、フリーテキストによる入力ミス(存在しない設定名を入力して0件になる/意図せず該当なしになる)を構造的に防げる。既存の`listSettingsNames()`(`controlPlaneClient.ts`)をそのまま再利用でき、新規API不要。

**Alternatives considered**: 履歴データに実際に登場した`settingsName`のみを選択肢にする(現在登録されている設定名と食い違う場合がある廃止済み設定名等も網羅できる利点はあるが、そのための新規集計APIが必要になり、既存の設定名一覧を再利用するより複雑になるため不採用)。

## R5. 「実行日時」として一覧のソートに使うタイムスタンプ

**Decision**: `created_at`(実行作成時刻、既存カラム、常に設定される)をソートキー・表示上の「実行日時」として使う。

**Rationale**: `finished_at`は`queued`/`running`状態の実行には存在せず、`started_at`も同様に`queued`状態では未設定(`created_at`のみが全状態で必ず存在する、`control-plane/src/db/runsRepository.ts`の`createRun`実装を確認済み)。FR-002(進行中・成功・失敗すべてを新しい順に一覧表示)を満たすには、全状態で存在する`created_at`を基準にする以外の選択肢がない。

**Alternatives considered**: 状態ごとに`started_at`/`finished_at`/`created_at`を使い分ける: ソート順が状態によって不連続になり「新しい順」の直感に反するため不採用。

## R6. 新規npm依存・UIコンポーネント方式

**Decision**: 新規npm依存は追加しない。履歴ページは既存の他ページ(`RunPage.tsx`等)と同様、素のHTML要素(`<table>`または`<ul>`、`<select>`、「さらに読み込む」用の`<button>`)で実装する。

**Rationale**: 001・002を通じて確立された「UIコンポーネントライブラリを使わない」方針(002 research.md R2)を踏襲する。
