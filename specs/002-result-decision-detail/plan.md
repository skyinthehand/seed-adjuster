# Implementation Plan: 選手別の配置判断根拠の詳細確認

**Branch**: `002-result-decision-detail` | **Date**: 2026-09-14 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/002-result-decision-detail/spec.md`

## Summary

結果ページ(`/results/:runId`)で、選手ごとの配置判断根拠(元の順位・比較した対戦相手候補・採用ロジック・調整後順位、および実際に対戦した大会名・日時)を、選手の行から直接(ボタン+モーダル)確認できるようにする。001フィーチャーで既に記録されている判断根拠ログ(DecisionLog)をUI上で選手単位に見やすくするとともに、対戦履歴インデックス(MatchHistoryIndex)に大会IDを追加し、大会名は索引側の小さな対応表(`tournaments.json`)で解決する(indexerが`smash_database`の`tournaments.jsonl`から構築し、`published-index`ブランチで公開。research.md R1)。近さの指標値の算出ロジック自体は変更しない。

## Technical Context

**Language/Version**: 001フィーチャーと同一(フロントエンド: TypeScript 5 / React 18 / Vite。調整アルゴリズム: 既存Python実装をPyodideで実行。indexer: Python 3.12)。新規言語・新規ランタイムの追加なし。

**Primary Dependencies**: 新規npm依存は追加しない(research.md R2)。モーダルは標準HTML `<dialog>`要素で実装する。indexer側もpyarrow/requests等、既存依存のみで完結する(`tournaments.jsonl`は既に取得済みのデータから対応表を構築するため、追加のHTTP取得は不要。research.md R1)。

**Storage**: Cloudflare D1の既存`adjustment_runs`テーブル(`decision_log_json`カラム)はスキーマ変更不要。JSON blobの中身が`comparedCandidates[].matches[]`分だけ増える(data-model.md参照)。新規の静的アーティファクトとして`tournaments.json`(大会ID→大会名の対応表)を、既存の`match-index.parquet`/`manifest.json`と同じ`published-index`ブランチに追加公開する。

**Testing**: 001フィーチャーと同一の方針(フロントエンド: vitest + Testing Library、Pythonロジック: pytest、制御プレーン: vitest)。ただし現時点でリポジトリに自動テストは未整備(001実装時点の既知の状態)であり、本フィーチャーでもquickstart.mdの手動検証手順で担保する。

**Target Platform**: 001フィーチャーと同一(GitHub Pages / Cloudflare Workers Free Plan / GitHub Actions)。新規コンポーネントの追加なし。

**Project Type**: web(既存の`frontend`/`control-plane`/`indexer`を拡張。新規コンポーネントなし)。

**Performance Goals**: `tournaments.json`の取得は配置判断根拠の詳細確認を最初に開いたときにのみ発生し、他の情報の表示をブロックしない(SC-004)。ファイルサイズはresearch.md R4の見積もり(概ね1MB前後)を実装時に実測検証する。

**Constraints**: 近さの指標値の算出ロジック自体は変更しない(spec.md Assumptions)。結果ページの既存の公開性(認証不要でのアクセス)を変更しない(FR-007)。大会名の遅延解決によって画面内の操作可能な要素の位置がずれてはならない(FR-008、research.md R3)。

**Scale/Scope**: 001フィーチャーの結果ページに閉じた変更であり、利用規模・テナント構成に変化はない。

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md`(v1.1.0)には2つの原則がある。

- **原則I(日本語での運用)**: 本plan.md含め、本フィーチャーの全ドキュメントは日本語で作成している。PASS。
- **原則II(デプロイ操作の事前確認)**: 設計そのものへの制約はないが、実装フェーズでの`git commit`/`git push`/`published-index`ブランチへのforce push/`wrangler deploy`等は、実行前に必ずユーザーへ確認することを実装タスク側で遵守する。プランニング時点でのゲート違反はない。PASS。

新規コンポーネントの追加や、支払い手段の登録を要する変更は一切ない(既存の`published-index`ブランチ配布の仕組みを流用するのみ)ため、001で確立された「支払い手段を登録しない」大原則(research.md #0)にも抵触しない。

**Post-Phase 1 re-check**: Phase 1設計(data-model.md / contracts/ / quickstart.md)を完了した時点でも、上記2原則との衝突はない。GATE: PASS(変更なし)。

## Project Structure

### Documentation (this feature)

```text
specs/002-result-decision-detail/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output
├── data-model.md         # Phase 1 output(001/data-model.mdへの拡張を記述)
├── quickstart.md         # Phase 1 output
├── contracts/
│   └── tournament-directory.md   # Phase 1 output(001/contracts/への追加分。実装時に001側へ統合済み)
├── checklists/
│   └── requirements.md
└── tasks.md              # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

**注記**: 索引まわりの契約(`match-index-format.md`)とAPI契約(`api.md`)は001の`contracts/`が正本であり、本Phase 1で該当箇所(Parquetの`tournamentId`列、`tournaments.json`、`decisionLog.comparedCandidates[].matches[]`)を直接反映済み。`002/contracts/tournament-directory.md`はその追加内容の説明であり、重複した別スキーマではない。

### Source Code (repository root)

既存の001の構成([001/plan.md](../001-seed-adjuster-webapp/plan.md) Project Structure参照)をそのまま使い、新規ディレクトリ・新規コンポーネントは追加しない。変更が及ぶファイルは:

```text
indexer/
└── src/build_index.py        # collect_event_paths()がtournament_idも保持するよう変更、
                                # tournaments.json(大会ID→大会名の対応表)を追加生成

.github/workflows/
└── indexer.yml                # tournaments.jsonもpublished-indexブランチへ一緒にpublish

frontend/src/
├── engine/
│   ├── seed_adjuster.py       # match_logに個々の対戦記録(timestamp, tournament_id)を追加保持
│   ├── pyodideRuntime.ts      # AdjustedResult/match_logsの型を拡張
│   └── runAdjustment.ts       # parseDecisionLog()がmatches[]を組み立てるよう拡張
├── data/
│   └── matchIndex.ts          # tournamentId列もSELECT対象に追加、tournaments.json取得+キャッシュ関数を追加
├── services/
│   └── controlPlaneClient.ts  # DecisionLogEntry/ComparedCandidate型にmatches[]を追加
└── pages/
    └── ResultsPage.tsx        # 選手行に詳細ボタンを追加、<dialog>によるモーダル実装
```

**Structure Decision**: 新規コンポーネントは追加せず、既存の`indexer`/`frontend`(`control-plane`はスキーマ変更不要)を拡張する。UIコンポーネントライブラリや状態管理ライブラリの新規導入もしない(research.md R2)。

## Complexity Tracking

> Constitution Checkに違反はなく、本表への記載は不要。
