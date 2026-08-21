# Implementation Plan: 対戦相手シード調整ツールの公開Web化

**Branch**: `001-seed-adjuster-webapp` | **Date**: 2026-08-21 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-seed-adjuster-webapp/spec.md`

## Summary

現在Colabノートブック(`seed_adjuster.ipynb`)で個人運用している「対戦履歴に基づくシード自動調整」ロジックを、誰でも自分のGoogleアカウント(・任意でStartggアカウント)を接続するだけでセルフサービスに使える公開Webツールとして提供する。フロントエンドはGitHub Pagesでホストする静的SPAとし、シード調整の実行(最大60分・タブを閉じても継続)、smash_databaseの全件読み込みを避けるための事前構築済み対戦履歴インデックス、GoogleスプレッドシートまたはStartggからの入力、Googleスプレッドシートへの監査ログ出力、認証不要で誰でも閲覧できる結果表示ページを、無料利用枠に収まる最小限のサーバーレスバックエンドで実現する。

## Technical Context

**Language/Version**: バックエンド: Python 3.12 (Cloud Run コンテナ)。フロントエンド: TypeScript 5 / Node 20 (Vite ビルドで静的出力)。インデクサー: Python 3.12 (スケジュール実行)。

**Primary Dependencies**: バックエンド: FastAPI、gspread + google-auth-oauthlib(Google Sheets読み書き・OAuth)、google-cloud-firestore、httpx(start.gg GraphQL呼び出し)、cryptography(保存トークンの暗号化)。フロントエンド: React 18、Vite、Google Identity Services JS SDK(サインインUI)。インデクサー: 既存ノートブックの対戦履歴集計ロジックを流用したPythonスクリプト。

**Storage**: Firestore(無料枠) — 実行状態(AdjustmentRun)、対象ごとの多重実行防止ロック、暗号化したGoogle/Startgg連携トークン(ConnectedAccount)、調整パラメータ設定(AdjustmentSettings)を保持。Google スプレッドシート — 各運営者が接続した監査ログ用シート(調整結果・判断根拠ログ・Wave制約違反記録・調整前シード記録)。事前構築済み対戦履歴インデックス — smash_databaseから定期生成する、選手ペア単位の対戦タイムスタンプ一覧に絞った小容量の静的アーティファクト(生リポジトリ全体は実行時に読み込まない)。

**Testing**: バックエンド/インデクサー: pytest(unit・contract・Firestore/Sheetsのフェイクを用いたintegration)。フロントエンド: vitest + Testing Library。

**Target Platform**: フロントエンド: GitHub Pages上の静的サイト(モダンブラウザ)。バックエンドAPI・バックグラウンド実行: Google Cloud Run(Webhookトリガー用サービス)+ Cloud Run Jobs(最大60分の調整計算本体)。インデクサー: GitHub Actionsの定期実行ワークフロー(公開リポジトリのため無料)。

**Project Type**: web(frontend + backend)。加えて、smash_databaseを定期的に軽量インデックスへ変換するスケジュール実行コンポーネント(indexer)を持つ3構成。

**Performance Goals**: 現実的な規模(数百人規模)の大会であればシード自動調整がデータ取得から結果出力まで常に60分以内に完了する(SC-002)。公開結果ページは完了済みの実行結果を数秒以内に表示する。

**Constraints**: 1回の実行が扱う対戦履歴データはインスタンスのメモリに収まる小容量インデックスに限定する(FR-002)。60分制約を満たす主手段は参加者数上限による拒否ではなく処理自体の最適化とする(FR-003)。極端に大きい参加者数のみ事前見積もりで実行を拒否する(FR-003a)。典型的な月間利用量では追加の有料インフラ費用が発生しない(SC-005)。バックグラウンド実行はブラウザタブを閉じても継続する(FR-013)。同一入力対象への同時実行は禁止する(FR-013a)。結果表示ページは非公開評価値(hidden_value)を除外した上で認証なしに閲覧できる(FR-012b)。Startggへの書き戻しは運営者の明示的承認後にのみ行う(FR-011)。

**Scale/Scope**: 完全公開のセルフサービス型・複数テナント(利用者ごとに個別のGoogle/Startggアカウントとスプレッドシートを持つ)。全体の想定利用量は月あたり数大会程度(SC-005)。個々の大会は現実的には数百人規模までを主対象とし、それを大幅に超える規模は事前拒否の対象となりうる(FR-003a)。

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` はプレースホルダーテンプレートのままであり、批准済みの原則は定義されていない。したがって本機能に対して追加で評価すべきゲートは存在せず、本チェックは自明にPASSする。プロジェクト固有の原則(技術選定方針・レビュー基準など)を今後強制したい場合は、実装着手前に `/speckit-constitution` を実行して憲章を確定させることを推奨する。

**Post-Phase 1 re-check**: Phase 1設計(data-model.md / contracts/ / quickstart.md)を完了した時点でも、参照すべき原則が存在しないため、GATE: PASS(変更なし)。

## Project Structure

### Documentation (this feature)

```text
specs/001-seed-adjuster-webapp/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
├── checklists/
│   └── requirements.md
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
frontend/                      # GitHub Pagesにデプロイする静的SPA
├── src/
│   ├── pages/                 # 設定ページ / 実行ページ(入力元選択) / 結果表示ページ
│   ├── components/
│   └── services/               # backend REST APIクライアント
└── tests/

backend/                        # Cloud Run上で動作するAPIサービス + バックグラウンド実行ジョブ
├── src/
│   ├── api/                   # HTTPエンドポイント(認証コールバック/設定/実行トリガー/公開結果)
│   ├── engine/                 # シード自動調整アルゴリズム(seed_adjuster.ipynbから移植)
│   ├── integrations/
│   │   ├── google_sheets.py    # シード表の読み込み・監査ログ出力・専用シート自動作成
│   │   ├── google_oauth.py     # 認可コードフローによるリフレッシュトークン取得・保管
│   │   ├── startgg.py          # start.gg GraphQL 読み込み・書き戻し
│   │   └── match_index.py      # 事前構築済み対戦履歴インデックスの取得・参照
│   └── jobs/                    # Cloud Run Jobsのエントリポイント(1回の調整実行本体)
└── tests/
    ├── contract/                # contracts/ に対する契約テスト
    ├── integration/
    └── unit/

indexer/                         # smash_databaseから対戦履歴インデックスを定期生成
├── src/
└── tests/
```

**Structure Decision**: Web application構成(frontend + backend)に、smash_databaseの読み込み・圧縮を担う`indexer`を独立コンポーネントとして追加した3構成とする。`indexer`は実行タイミング(定期バッチ)・実行環境(GitHub Actions)・関心事(全対戦履歴の走査と圧縮)が`backend`(オンデマンドAPI・都度実行のジョブ)と明確に異なり、両者を1コンポーネントに同居させると「都度の調整計算」と「データセット全体の定期更新」というライフサイクルの異なる処理が混在してしまうため分離する。プロジェクト憲章に複雑さを制限する原則が定義されていないため、Complexity Trackingとしての正式な justification は不要と判断した。

## Complexity Tracking

> Constitution Checkに違反はなく(憲章がプレースホルダーのため評価対象の原則が存在しない)、本表への記載は不要。
