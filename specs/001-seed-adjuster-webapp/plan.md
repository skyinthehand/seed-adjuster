# Implementation Plan: 対戦相手シード調整ツールの公開Web化

**Branch**: `001-seed-adjuster-webapp` | **Date**: 2026-08-21 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-seed-adjuster-webapp/spec.md`

## Summary

現在Colabノートブック(`seed_adjuster.ipynb`)で個人運用している「対戦履歴に基づくシード自動調整」ロジックを、誰でも自分のGoogleアカウント(・任意でStartggアカウント)を接続するだけでセルフサービスに使える公開Webツールとして提供する。**重い計算(smash_databaseの参照・シード調整アルゴリズム)はサーバーを介さず、ブラウザ内で完結させる**(DuckDB-WASM + Pyodideによるクライアントサイド実行。research.md #1参照)。フロントエンドはGitHub Pagesでホストする静的SPA、実行状態の記録・パラメータ設定・公開結果の保管には最小限のCloudflare Workers/D1のみを用いる(同一対象への多重実行は禁止しない。spec.md Clarifications参照)。この結果、**支払い手段の登録が一切不要で、無料枠を超えても課金ではなく機能停止(fail-closed)にしかならない**うえ、重い計算自体がそもそも運営者自身の端末で行われるため課金対象のサーバー計算資源を一切使わない構成となる(research.md #0参照)。「実行中にタブを閉じても処理が継続する」ことは希望要件にとどめ、必須要件としない(spec.md Clarifications参照)。

## Technical Context

**Language/Version**: フロントエンド: TypeScript 5 / Node 20 (Vite ビルドで静的出力)。調整アルゴリズム本体: 既存のPython実装(`seed_adjuster.ipynb`由来)をそのままPyodide(ブラウザ内WASM Python)で実行。制御プレーン(Cloudflare Workers): TypeScript 5。インデクサー(GitHub Actions定期実行、smash_database集約専用・ユーザー認証情報を扱わない): Python 3.12。

**Primary Dependencies**: フロントエンド: React 18、Vite、Google Identity Services JS SDK(ブラウザ完結のOAuthトークン取得)、Pyodide(調整アルゴリズムの実行)、DuckDB-WASM(対戦履歴インデックスに対するSQLクエリ)。調整アルゴリズム(Pyodide経由で動く既存Pythonコード)からのGoogle Sheets / start.gg 呼び出しは、ブラウザから直接fetchする(取得したアクセストークン・利用者入力のstart.ggトークンをそのまま使用)。制御プレーン: Cloudflare Workers標準API、D1(SQLite)。インデクサー: 既存ノートブックの対戦履歴集計ロジックを流用したPythonスクリプト。

**Storage**: ブラウザのローカルストレージ(IndexedDB) — start.gg個人アクセストークン(利用者の端末内にのみ保存し、いかなるサーバーにも保存しない。research.md #5)。Cloudflare D1(無料プラン、カード登録不要) — 実行状態(AdjustmentRun、複数実行を許容する単純な記録)、調整パラメータ設定(AdjustmentSettings)、クライアントが実行完了後に提出する公開結果のサニタイズ済みコピー(AdjustedSeedResult等)を保持。ユーザーの認証トークンはD1には一切保存しない。Google スプレッドシート — 各運営者が接続した監査ログ用シート(調整結果・判断根拠ログ・Wave制約違反記録・調整前シード記録。ブラウザから直接書き込む)。事前構築済み対戦履歴インデックス — smash_databaseから定期生成する、選手ペア単位の対戦タイムスタンプ一覧に絞った小容量の静的アーティファクト(DuckDB-WASMで読み込みやすいParquet形式。GitHub Releasesアセットとして配布)。

**Testing**: フロントエンド(調整アルゴリズムの呼び出し・DuckDB-WASMクエリ・OAuthフローを含む): vitest + Testing Library、Pyodide経由で動くPythonロジック自体の単体テストはpytest(ブラウザ外で通常のPythonとして実行して検証)。制御プレーン: vitest(unit・contract。`@cloudflare/vitest-pool-workers`を使用)。インデクサー: pytest。

**Target Platform**: フロントエンド: GitHub Pages上の静的サイト(モダンブラウザ。調整計算はここで完結)。制御プレーン(状態管理・公開結果キャッシュ): Cloudflare Workers(Freeプラン)。インデクサー: GitHub Actionsの定期実行ワークフロー(公開リポジトリのため無料、ユーザー認証情報は扱わない)。Google Cloudは Google OAuth クライアント登録のためだけに使用し、課金は有効化しない。

**Project Type**: web(frontend + 最小限の制御プレーン)。重い計算はサーバー側コンポーネントを持たず、フロントエンド内で完結する。smash_databaseを定期的に軽量インデックスへ変換するスケジュール実行コンポーネント(indexer)のみ、GitHub Actions上に独立して存在する。

**Performance Goals**: 現実的な規模(数百人規模)の大会であれば、運営者の一般的なノートPC等のブラウザ上でシード自動調整がデータ取得から結果出力まで常に60分以内に完了する(SC-002)。対戦履歴インデックスのダウンロードは、実測調査(research.md #2)に基づけば全期間・全地域を対象としても概ね1桁MB台〜十数MB程度・数秒以内で完了する見込みであり、60分の予算に対して無視できる水準である。Pyodide/DuckDB-WASMの実行環境(初回のみ概ね10〜15MB程度)はブラウザキャッシュにより2回目以降は再ダウンロードされない。公開結果ページは完了済みの実行結果を数秒以内に表示する。

**Constraints**: 1回の実行が扱う対戦履歴データはブラウザのメモリに収まる小容量インデックスに限定する(FR-002)。60分制約を満たす主手段は参加者数上限による拒否ではなく処理自体の最適化とする(FR-003)。参加者数を理由に実行そのものを拒否してはならない。想定処理時間が60分を大幅に超える場合は事前警告のみを行い、運営者はそのまま実行を続行できる(FR-003a)。**アーキテクチャを構成するいかなるコンポーネントについても、運用担当者は支払い手段を登録しない。無料枠超過時の挙動は課金ではなく機能の一時的な利用不可でなければならない**(SC-005、research.md #0)。実行中にブラウザタブを閉じても処理が継続することは希望要件であり必須ではない(FR-013)。同一入力対象への同時実行は禁止しない(spec.md Clarifications、方針変更2026-08-21)。当初検討していた多重実行防止ロック・ハートビート機構は、ブラウザ完結化により当初の目的(共有計算資源の浪費防止)が該当しなくなったため撤回した。結果表示ページは認証なしに閲覧できる(FR-012b)。start.ggトークンはブラウザの外(サーバー)へ送信・保存してはならない(research.md #5)。start.gg APIが呼び出し元オリジンからのブラウザ直接呼び出し(CORS)に対応していない場合、資格情報を保持・ログ保存しない薄いリレーで中継する必要があり、これは未検証のリスクとして扱う(research.md #6)。Startggへの書き戻しは運営者の明示的承認後にのみ行う(FR-011)。

**Scale/Scope**: 完全公開のセルフサービス型・複数テナント(利用者ごとに個別のGoogle/Startggアカウントとスプレッドシートを持つ)。全体の想定利用量は月あたり数大会程度(SC-005)。個々の大会は現実的には数百人規模までを主対象とするが、それを大幅に超える規模も拒否せず、警告表示の上で実行できる(FR-003a, SC-002a)。計算が各利用者自身のブラウザで行われるため、共有インフラの同時実行数を巡る利用者間の競合は生じない。

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
frontend/                      # GitHub Pagesにデプロイする静的SPA(重い計算もここで完結)
├── src/
│   ├── pages/                 # 設定ページ / 実行ページ(入力元選択) / 結果表示ページ
│   ├── components/
│   ├── engine/                 # 調整アルゴリズム(seed_adjuster.ipynb由来のPythonをPyodideで実行するためのラッパー)
│   │   └── seed_adjuster.py     # 既存ロジックを移植したPython本体(Pyodideにロードして実行)
│   ├── data/
│   │   ├── matchIndex.ts        # DuckDB-WASMで対戦履歴インデックス(Parquet)をクエリするモジュール
│   │   └── indexer/              # (indexer/ の出力形式契約への参照。実体は別コンポーネント)
│   ├── integrations/
│   │   ├── googleSheets.ts      # ブラウザから直接Google Sheets APIを呼び出す(アクセストークンはセッション内メモリのみ)
│   │   └── startgg.ts           # ブラウザから直接start.gg GraphQL APIを呼び出す(トークンはIndexedDBのみに保存)
│   └── services/                # 制御プレーンREST APIクライアント(実行記録・公開結果提出)
└── tests/

control-plane/                  # Cloudflare Workers上で動作する最小限のAPI(状態記録/公開結果キャッシュ)
├── src/
│   ├── api/                   # HTTPエンドポイント(設定/実行記録/公開結果提出・閲覧/任意のstart.ggリレー)
│   └── db/                      # D1スキーマ・アクセス層
└── tests/
    ├── contract/                # contracts/ に対する契約テスト
    ├── integration/
    └── unit/

indexer/                         # smash_databaseから対戦履歴インデックスを定期生成(ユーザー認証情報は扱わない)
├── src/
└── tests/

.github/
└── workflows/
    └── indexer.yml             # 定期実行、indexer/を実行してParquetアーティファクトを公開
```

**Structure Decision**: Web application構成のうち、重い計算(調整アルゴリズム・対戦履歴クエリ)を担うサーバー側コンポーネントを廃し、`frontend`内で完結させる(research.md #1)。これに伴い、以前案にあった`compute`(GitHub Actionsジョブ)と、GitHub Actions OIDCトークンの検証によるcompute向け資格情報払い出し機構は不要になった。`control-plane`(Cloudflare Workers)は、複数の利用者・端末間で共有されるべき状態(対象ごとのパラメータ設定、実行履歴、認証なしで公開する結果のキャッシュ)のみを扱う薄い層として残す(多重実行を防ぐロック機構は持たない。方針変更、spec.md Clarifications参照)。これらはブラウザ単体では実現できない「複数の利用者間で共有される状態」だからであり、それ以外(重い計算・認証情報の保持)はすべてブラウザ側に閉じる。`indexer`はsmash_databaseの定期集約という関心事がフロントエンド・制御プレーンいずれとも異なり、かつユーザー認証情報を一切扱わない無人バッチであるため、引き続き独立したGitHub Actionsコンポーネントとして分離する。プロジェクト憲章に複雑さを制限する原則が定義されていないため、Complexity Trackingとしての正式な justification は不要と判断した。

## Complexity Tracking

> Constitution Checkに違反はなく(憲章がプレースホルダーのため評価対象の原則が存在しない)、本表への記載は不要。
