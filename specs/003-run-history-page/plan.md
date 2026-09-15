# Implementation Plan: 実行履歴ページ

**Branch**: `003-run-history-page` | **Date**: 2026-09-15 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/003-run-history-page/spec.md`

## Summary

「実行」ページ・「設定」ページとは独立した「履歴」ページを新設し、制御プレーンに記録された全実行(対象・設定名を問わず、進行中・成功・失敗すべて)を新しい順に一覧表示する。成功した実行は結果ページ(`/results/:runId`)へ直接遷移できる。設定名による絞り込みと段階的な追加読み込みに対応する。実装過程で、実行記録(`AdjustmentRun`)がそもそも「どの設定名を使ったか」を保持していなかったという既存の欠落が判明したため(research.md R1)、本フィーチャーで`settings_name`カラムを追加し、`POST /runs`から送信させる。

## Technical Context

**Language/Version**: 001・002フィーチャーと同一(フロントエンド: TypeScript 5 / React 18 / Vite。制御プレーン: TypeScript 5 / Cloudflare Workers)。新規言語・新規ランタイムの追加なし。

**Primary Dependencies**: 新規npm依存は追加しない(research.md R6)。履歴一覧は既存ページ同様、素のHTML要素で実装する。

**Storage**: Cloudflare D1の既存`adjustment_runs`テーブルに`settings_name TEXT`カラムを追加する(research.md R1)。新規テーブルは追加しない。新規の静的アーティファクトも追加しない。

**Testing**: 001・002フィーチャーと同一の方針。現時点でリポジトリに自動テストは未整備(002 plan.mdで既知の状態)であり、本フィーチャーでもquickstart.mdの手動検証手順で担保する。

**Target Platform**: 001フィーチャーと同一(GitHub Pages / Cloudflare Workers Free Plan)。新規コンポーネントの追加なし。

**Project Type**: web(既存の`frontend`/`control-plane`を拡張。新規コンポーネントなし)。

**Performance Goals**: 履歴一覧の初期表示はSC-001(1分以内に目的の実行に到達)を満たす範囲で十分高速であればよく、厳密な応答時間の数値目標は設けない(既存の他ページと同水準)。

**Constraints**: 履歴ページは認証を必要としない(既存の公開結果ページと同様、FR-012b相当、spec.md Assumptions)。既存の`GET /public/runs?targetId=`(FR-016)の挙動・レスポンス形は変更しない(research.md R2)。稼働中のD1テーブルへの`ALTER TABLE`は、実行前に必ずユーザーへ確認する(constitution 原則II)。

**Scale/Scope**: 001フィーチャーの想定利用規模(個人〜小規模チーム運用、月あたり数大会程度)と同一。実行履歴の総件数は現実的には数百件程度までを主対象とする(research.md R3)。

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md`(v1.1.0)には2つの原則がある。

- **原則I(日本語での運用)**: 本plan.md含め、本フィーチャーの全ドキュメントは日本語で作成している。PASS。
- **原則II(デプロイ操作の事前確認)**: 本フィーチャーは稼働中のD1テーブルへの`ALTER TABLE`(research.md R1)という、他フィーチャーにはなかった破壊的でないが不可逆な変更(カラム追加自体は取り消し可能だが、本番データに対する操作である点は同じ)を伴う。実装タスク側で、ローカル検証後、リモートD1への適用・`git push`・`wrangler deploy`のいずれについても実行前に必ずユーザーへ確認することを徹底する。プランニング時点でのゲート違反はない。PASS。

新規コンポーネントの追加や、支払い手段の登録を要する変更は一切ない(既存のCloudflare D1 Freeプランの範囲内でのカラム追加のみ)ため、001で確立された「支払い手段を登録しない」大原則(001 research.md #0)にも抵触しない。

**Post-Phase 1 re-check**: Phase 1設計(data-model.md / contracts/ / quickstart.md)を完了した時点でも、上記2原則との衝突はない。GATE: PASS(変更なし)。

## Project Structure

### Documentation (this feature)

```text
specs/003-run-history-page/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output
├── data-model.md         # Phase 1 output(001/data-model.mdへの拡張を記述)
├── quickstart.md         # Phase 1 output
├── contracts/
│   └── run-history.md    # Phase 1 output(001/contracts/への追加分。実装時に001側へ統合済み)
├── checklists/
│   └── requirements.md
└── tasks.md              # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

**注記**: API契約(`api.md`)は001の`contracts/`が正本であり、本Phase 1で該当箇所(`POST /runs`の`settingsName`、`GET /runs/{runId}`の`settingsName`、新規`GET /public/run-history`)を直接反映済み。`003/contracts/run-history.md`はその追加内容の説明であり、重複した別スキーマではない。

### Source Code (repository root)

既存の001の構成([001/plan.md](../001-seed-adjuster-webapp/plan.md) Project Structure参照)をそのまま使い、新規ディレクトリ・新規コンポーネントは追加しない。変更が及ぶファイルは:

```text
control-plane/src/
├── db/
│   ├── schema.sql              # adjustment_runsにsettings_name TEXT列を追加
│   └── runsRepository.ts       # createRun()がsettingsNameを保存、getRun()が返却、
│                                 # 新規listRunHistory()(settingsNameフィルタ・limit/offset)を追加
└── api/
    ├── runs.ts                 # handleCreateRun()がsettingsName必須チェック、
    │                             # handleGetRun()のレスポンスにsettingsName
    └── public.ts                # 新規handleListRunHistory()を追加

frontend/src/
├── services/
│   └── controlPlaneClient.ts   # CreateRunRequest/RunStatusResponseにsettingsName追加、
│                                 # 新規listRunHistory()クライアント関数を追加
├── engine/
│   └── runAdjustment.ts        # RunGoogleSheetsInput/RunStartggInputにsettingsNameを追加し、
│                                 # createRun呼び出しへ渡す
├── pages/
│   ├── RunPage.tsx             # 実行時にsettingsNameをcreateRun呼び出しへ渡すよう変更
│   └── HistoryPage.tsx         # 新規: 履歴一覧・絞り込み・追加読み込みUI
└── App.tsx                     # ナビゲーションに「履歴」リンク、/historyルートを追加
```

**Structure Decision**: 新規コンポーネントは追加せず、既存の`frontend`/`control-plane`を拡張する。UIコンポーネントライブラリや状態管理ライブラリの新規導入もしない(research.md R6)。D1のカラム追加は既存の`schema.sql`運用(`CREATE TABLE IF NOT EXISTS`)の限界により、稼働中DBへは別途`ALTER TABLE`が必要になる初めてのケースであり、実装タスクで明示的な手順として扱う(research.md R1)。

## Complexity Tracking

> Constitution Checkに違反はなく、本表への記載は不要。
