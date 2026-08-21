# 対戦相手シード調整ツール

対戦相手の過去対戦履歴に基づいてトーナメントのシードを自動調整するツール。既存のColabノートブック(`seed_adjuster.ipynb`)を、誰でも使える公開Webアプリとして再構成したもの。詳細な設計判断は [`specs/001-seed-adjuster-webapp/`](specs/001-seed-adjuster-webapp/)(spec.md / plan.md / research.md / data-model.md / contracts/ / quickstart.md / tasks.md)を参照。

## アーキテクチャ概要

- **`frontend/`**: React + TypeScript + Vite。GitHub Pagesにホストする静的サイト。シード自動調整の計算そのもの(Pyodide)と対戦履歴の検索(DuckDB-WASM)は、すべて**ブラウザ内**で完結する。サーバー側の可変コンピュートは一切使わない(research.md #0/#1)。
- **`control-plane/`**: Cloudflare Workers + D1。実行記録・パラメータ設定・公開結果キャッシュの記録のみを担う薄い層。計算は行わない。Free Planのみで運用し、超過時は課金ではなくエラーで失敗する設計(research.md #0/#3)。
- **`indexer/`**: Python。`tosakazu/smash_database` から対戦履歴を集約し、コンパクトなParquet形式の索引(MatchHistoryIndex)を生成する。GitHub Actionsで定期実行し、GitHub Releasesに成果物を公開する(research.md #2)。

**大原則**: どのコンポーネントにも支払い手段を一切登録しない状態で運用できることを前提に設計している(research.md #0)。デプロイ手順の中で課金を有効化する操作は絶対に行わないこと。

## 前提条件

- Node.js 20系、npm
- Python 3.12系(indexerのみ)
- Cloudflareアカウント(**支払い手段は登録しない**)
- GitHubアカウント・このリポジトリをフォークまたは所有していること(**公開リポジトリであること** — 公開リポジトリはGitHub Actionsの無料枠が実質無制限になる。research.md #0)
- Googleアカウント(OAuthクライアント登録用。**課金は有効化しない**)

## デプロイ手順

### 1. control-plane(Cloudflare Workers + D1)

```sh
cd control-plane
npm install
npx wrangler login
npx wrangler d1 create seed-adjuster
```

出力された `database_id` を `control-plane/wrangler.toml` の `REPLACE_WITH_D1_DATABASE_ID` に設定する。同ファイルの `ALLOWED_ORIGIN` を、後述のGitHub Pagesの公開オリジン(`https://<org>.github.io` または `https://<org>.github.io/<repo>`)に設定する。

```sh
npm run db:migrate:remote
npm run deploy
```

デプロイ後に表示される `*.workers.dev` のURL(またはカスタムドメイン)を控えておく。後述のフロントエンドの `VITE_CONTROL_PLANE_API_BASE_URL` に使う。

### 2. indexer(GitHub Actions)

追加の手動セットアップは不要。このリポジトリを公開リポジトリとしてGitHubにpushすれば、`.github/workflows/indexer.yml` が毎日定期実行され、`match-index-*` タグと `latest-index` エイリアスのGitHub Releaseとして索引(Parquet + manifest.json)を自動公開する。初回は「Actions」タブから `workflow_dispatch` で手動実行して即座に索引を生成してもよい。

`frontend/src/config.ts` の `MATCH_INDEX_MANIFEST_URL` のフォールバック値にある `REPLACE_WITH_ORG/REPLACE_WITH_REPO` を、実際のリポジトリのorg/repo名に書き換えること(またはフロントエンドのビルド時に `VITE_MATCH_INDEX_MANIFEST_URL` を明示的に設定してもよい)。

### 3. Google OAuthクライアントの登録

[`docs/google-oauth-setup.md`](docs/google-oauth-setup.md) の手順に従う。**課金は有効化しない。** 発行されたクライアントIDを控えておく。

### 4. frontend(GitHub Pages)

1. リポジトリの Settings → Pages で、Source を「GitHub Actions」に設定する。
2. リポジトリの Settings → Secrets and variables → Actions → Variables で、以下のリポジトリ変数を設定する。
   - `GOOGLE_OAUTH_CLIENT_ID`: 手順3で発行したクライアントID
   - `CONTROL_PLANE_API_BASE_URL`: 手順1でデプロイしたcontrol-planeのURL
3. `main` ブランチへ `frontend/**` の変更をpushすると、`.github/workflows/deploy-frontend.yml` が自動的にビルド・デプロイする(公開リポジトリなのでActionsの利用料は発生しない。research.md #0)。初回は「Actions」タブから `workflow_dispatch` で手動実行してもよい。
4. Google Cloud ConsoleのOAuthクライアント設定に、実際に発行されたGitHub PagesのオリジンとCloudflare WorkersのURLとの組み合わせで問題がないか確認する(`docs/google-oauth-setup.md` 手順4)。

### 5. 動作確認

デプロイ後、[`specs/001-seed-adjuster-webapp/quickstart.md`](specs/001-seed-adjuster-webapp/quickstart.md) の各シナリオを実際のブラウザ・実際のGoogle/start.ggアカウントで手動検証すること。control-planeのAPI契約自体はローカルの `wrangler dev` で検証済みだが(tasks.md T060参照)、実ブラウザでのOAuthフロー・実スプレッドシートへの読み書き・start.ggへの書き戻し・DevTools NetworkタブでのCORS/トークン非送出確認・実際に課金が発生しないことの確認は、デプロイ環境でしか検証できない。

## ローカル開発

```sh
# frontend
cd frontend
npm install
cp .env.example .env.local  # 値を埋める
npm run dev

# control-plane
cd control-plane
npm install
npm run db:migrate:local
npm run dev  # wrangler dev --local、ローカルD1を使用

# indexer
cd indexer
pip install -e ".[dev]"
python -m src.build_index --out-dir dist
```

### アルゴリズムの実行速度ベンチマーク

シード調整アルゴリズム(`frontend/src/engine/seed_adjuster.py`)の実測実行時間を、実際にPyodideをNode上で動かして検証するベンチマークが用意されている。

```sh
cd frontend
npm run benchmark
```

`frontend/src/engine/` または `frontend/src/data/` への変更のたびに、`.github/workflows/benchmark.yml` がこのベンチマークをCI上で自動実行し、FR-003/SC-002(60分以内)の予算を超えた場合にビルドを失敗させる(tasks.md T059)。アルゴリズムを変更した場合は、必ずこのベンチマークが通ることを確認すること。

## 各コンポーネントのテスト・静的検査

```sh
cd frontend && npx tsc -b && npx eslint src scripts
cd control-plane && npx tsc --noEmit && npx eslint src
cd indexer && python -m py_compile src/build_index.py && ruff check src
```

## 既知の制約・未検証事項

- start.gg GraphQL APIのフィールドマッピング(`frontend/src/integrations/startgg.ts` 冒頭のコメント参照)は、実際のstart.gg APIに対して未検証。本番投入前に実データで確認すること。
- start.ggがブラウザからの直接CORSアクセスに対応しているかは未確認。対応していない場合は `frontend/src/integrations/startgg.ts` の `USE_RELAY` を `true` に切り替え、`POST /relay/startgg` 経由に切り替える(research.md #6)。
