# Implementation Plan: 対戦相手シード調整ツールの公開Web化

**Branch**: `001-seed-adjuster-webapp` | **Date**: 2026-08-21 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-seed-adjuster-webapp/spec.md`

## Summary

現在Colabノートブック(`seed_adjuster.ipynb`)で個人運用している「対戦履歴に基づくシード自動調整」ロジックを、誰でも自分のGoogleアカウント(・任意でStartggアカウント)を接続するだけでセルフサービスに使える公開Webツールとして提供する。フロントエンドはGitHub Pagesでホストする静的SPAとし、シード調整の実行(最大60分・タブを閉じても継続)、smash_databaseの全件読み込みを避けるための事前構築済み対戦履歴インデックス、GoogleスプレッドシートまたはStartggからの入力、Googleスプレッドシートへの監査ログ出力、認証不要で誰でも閲覧できる結果表示ページを、**支払い手段の登録が一切不要で、無料枠を超えても課金ではなく機能停止(fail-closed)にしかならない**構成(GitHub Actions + Cloudflare Workers/D1)で実現する(research.md #0参照)。

## Technical Context

**Language/Version**: 制御プレーン(Cloudflare Workers): TypeScript 5。計算本体(GitHub Actionsジョブ): Python 3.12。インデクサー(GitHub Actions定期実行): Python 3.12。フロントエンド: TypeScript 5 / Node 20 (Vite ビルドで静的出力)。

**Primary Dependencies**: 制御プレーン: Cloudflare Workers標準API、D1(SQLite)、`jose`等のJWT検証ライブラリ(GitHub Actions OIDCトークン検証用)。計算本体/インデクサー: gspread + google-auth-oauthlib(Google Sheets読み書き・OAuthトークン交換)、httpx(start.gg GraphQL呼び出し)、cryptography(トークン暗号化/復号)。フロントエンド: React 18、Vite、Google Identity Services JS SDK(サインインUI)。

**Storage**: Cloudflare D1(無料プラン、カード登録不要) — 実行状態(AdjustmentRun)、対象ごとの多重実行防止ロック、暗号化したGoogle/Startgg連携トークン(ConnectedAccount)、調整パラメータ設定(AdjustmentSettings)を保持。Google スプレッドシート — 各運営者が接続した監査ログ用シート(調整結果・判断根拠ログ・Wave制約違反記録・調整前シード記録)。事前構築済み対戦履歴インデックス — smash_databaseから定期生成する、選手ペア単位の対戦タイムスタンプ一覧に絞った小容量の静的アーティファクト(GitHub Releasesアセットとして配布。生リポジトリ全体は実行時に読み込まない)。

**Testing**: 制御プレーン: vitest(unit・contract。Cloudflare Workers用のテストランナー`@cloudflare/vitest-pool-workers`を使用)。計算本体/インデクサー: pytest(unit・contract・Sheets/Startgg APIのフェイクを用いたintegration)。フロントエンド: vitest + Testing Library。

**Target Platform**: フロントエンド: GitHub Pages上の静的サイト(モダンブラウザ)。制御プレーン(トリガー・状態管理・公開API): Cloudflare Workers(Freeプラン)。計算本体(最大60分の調整計算): GitHub Actions ワークフロー(`repository_dispatch`起動、公開リポジトリのため無料)。インデクサー: GitHub Actionsの定期実行ワークフロー(公開リポジトリのため無料)。Google Cloudは Google OAuth クライアント登録のためだけに使用し、課金は有効化しない。

**Project Type**: web(frontend + 制御プレーン)。加えて、重い計算を担うGitHub Actionsジョブと、smash_databaseを定期的に軽量インデックスへ変換するスケジュール実行コンポーネント(indexer)を持つ構成。

**Performance Goals**: 現実的な規模(数百人規模)の大会であればシード自動調整がデータ取得から結果出力まで常に60分以内に完了する(SC-002)。公開結果ページは完了済みの実行結果を数秒以内に表示する。

**Constraints**: 1回の実行が扱う対戦履歴データはジョブ実行環境のメモリに収まる小容量インデックスに限定する(FR-002)。60分制約を満たす主手段は参加者数上限による拒否ではなく処理自体の最適化とする(FR-003)。参加者数を理由に実行そのものを拒否してはならない。想定処理時間が60分を大幅に超える場合は事前警告のみを行い、運営者はそのまま実行を続行できる(FR-003a)。**アーキテクチャを構成するいかなるコンポーネントについても、運用担当者は支払い手段を登録しない。無料枠超過時の挙動は課金ではなく機能の一時的な利用不可でなければならない**(SC-005、research.md #0)。バックグラウンド実行はブラウザタブを閉じても継続する(FR-013)。同一入力対象への同時実行は禁止する(FR-013a)。結果表示ページは非公開評価値(hidden_value)を除外した上で認証なしに閲覧できる(FR-012b)。公開リポジトリのActionsログは誰でも閲覧できるため、利用者のGoogle/Startggトークンをワークフロー入力やログに一切出力してはならない(research.md #3)。Startggへの書き戻しは運営者の明示的承認後にのみ行う(FR-011)。

**Scale/Scope**: 完全公開のセルフサービス型・複数テナント(利用者ごとに個別のGoogle/Startggアカウントとスプレッドシートを持つ)。全体の想定利用量は月あたり数大会程度(SC-005)。個々の大会は現実的には数百人規模までを主対象とするが、それを大幅に超える規模も拒否せず、警告表示の上で実行できる(FR-003a, SC-002a)。ただしGitHub Actionsのジョブタイムアウト・同時実行数には実用上の技術的上限がある(research.md #1, #8)。

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
│   └── services/               # 制御プレーンREST APIクライアント
└── tests/

control-plane/                  # Cloudflare Workers上で動作するAPI(トリガー/状態/公開結果)
├── src/
│   ├── api/                   # HTTPエンドポイント(認証コールバック/設定/実行トリガー/公開結果)
│   ├── oidc/                    # GitHub Actions OIDCトークン検証(research.md #3)
│   └── db/                      # D1スキーマ・アクセス層
└── tests/
    ├── contract/                # contracts/ に対する契約テスト
    ├── integration/
    └── unit/

compute/                         # GitHub Actionsジョブとして実行する調整計算本体
├── src/
│   ├── engine/                 # シード自動調整アルゴリズム(seed_adjuster.ipynbから移植)
│   └── integrations/
│       ├── google_sheets.py    # シード表の読み込み・監査ログ出力・専用シート自動作成
│       ├── startgg.py          # start.gg GraphQL 読み込み・書き戻し
│       ├── match_index.py      # 事前構築済み対戦履歴インデックスの取得・参照
│       └── control_plane_client.py  # OIDC付きでcontrol-planeから資格情報取得・状態報告
└── tests/
    ├── contract/
    ├── integration/
    └── unit/

indexer/                         # smash_databaseから対戦履歴インデックスを定期生成
├── src/
└── tests/

.github/
└── workflows/
    ├── run-adjustment.yml      # repository_dispatchで起動、compute/を実行(最大60分)
    └── indexer.yml             # 定期実行、indexer/を実行
```

**Structure Decision**: Web application構成に、GitHub Actions上で動く2つの独立コンポーネント(`compute`: 都度の調整計算、`indexer`: smash_databaseの定期集約)を加えた4構成とする。`backend`という単一のオンデマンドAPIサーバーを置く代わりに、軽量で常時無料な`control-plane`(Cloudflare Workers、リクエスト応答のみ)と、重い処理を担う`compute`(GitHub Actionsジョブ、実行のたびに起動)を分離しているのは、両者の課金モデル・実行環境・実行頻度が本質的に異なり(research.md #0〜#2)、これを1コンポーネントに同居させると「常時無料なトリガー層」と「実行のたびに走る計算層」の区別が実装上も曖昧になり、コスト面の安全性(0番の大原則)を保証しづらくなるためである。`indexer`も同様の理由で`compute`とは別ワークフロー・別スケジュールで分離する。プロジェクト憲章に複雑さを制限する原則が定義されていないため、Complexity Trackingとしての正式な justification は不要と判断した。

## Complexity Tracking

> Constitution Checkに違反はなく(憲章がプレースホルダーのため評価対象の原則が存在しない)、本表への記載は不要。
