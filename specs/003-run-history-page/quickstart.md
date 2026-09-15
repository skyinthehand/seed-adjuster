# Quickstart: 実行履歴ページ

実装後にエンドツーエンドで検証する手順。契約の詳細は[contracts/run-history.md](./contracts/run-history.md)、[001/contracts/api.md](../001-seed-adjuster-webapp/contracts/api.md)を参照。

## 前提

- `control-plane/`の依存関係がインストール済み(`npm ci`)であること。
- `frontend/`の依存関係がインストール済み(`npm ci`)であること。
- 001フィーチャーが実装済み・動作していること。

## 1. D1スキーマ変更の適用(ローカル)

```sh
cd control-plane
sqlite3 --version >/dev/null  # wrangler d1 execute --local が使うsqliteの動作確認は不要、参考
wrangler d1 execute seed-adjuster --local --command "ALTER TABLE adjustment_runs ADD COLUMN settings_name TEXT"
```

- 既存のローカルD1に対して`settings_name`カラムが追加されることを確認する(`wrangler d1 execute seed-adjuster --local --command "PRAGMA table_info(adjustment_runs)"`で`settings_name`が一覧に出ることを確認)。
- **本番(リモート)D1への適用は`--remote`で同様のコマンドを実行するが、既存データに影響する操作のため実行前に必ずユーザーへ確認する**(constitution 原則II)。

## 2. `settingsName`が実行記録に残ることの確認(User Story 1の前提)

```sh
cd control-plane
npm run dev
```

1. `frontend`から(または`curl`で直接)、`settingsName`を含めて`POST /runs`を呼び出す。
2. `GET /runs/{runId}`のレスポンスに、送信した`settingsName`がそのまま含まれることを確認する。
3. `settingsName`を欠落させて`POST /runs`を呼び出すと`400 INVALID_REQUEST`になることを確認する。

## 3. 履歴ページの基本動作(User Story 1)

```sh
cd frontend
npm run dev
```

1. 実行ページから1件実行を完了させる(成功させる)。
2. ナビゲーションの「履歴」を開く。
3. 一覧に、いま完了させた実行が新しい順の先頭付近に表示され、使用した設定名・対象の入力方式・実行日時・「成功」ステータスが表示されることを確認する。
4. その項目を選択し、結果ページ(`/results/:runId`)へ遷移することを確認する。
5. 実行履歴が1件もない状態(例: ローカルDBを初期化した直後)で履歴ページを開き、空状態メッセージが表示されエラーにならないことを確認する。

## 4. 設定名による絞り込み・追加読み込み(User Story 2)

1. 異なる設定名で複数回実行を完了させる。
2. 履歴ページで特定の設定名を選んで絞り込み、その設定名の実行のみが一覧に残ることを確認する。
3. 絞り込みを解除すると全件に戻ることを確認する。
4. (件数が少ない場合は`GET /public/run-history`の`limit`を小さくして動作確認する、または実行を多数作成する)一覧の末尾で「さらに読み込む」を操作し、続きの実行が追加表示されることを確認する。

## 5. 失敗・実行中の実行の扱い(User Story 3)

1. 意図的に失敗する実行を1件発生させる(例: 存在しないスプレッドシートIDを指定する)。
2. 履歴ページを開き、その実行が「失敗」ステータスとともに一覧に含まれることを確認する。
3. その項目を選択しても結果ページへ遷移しないこと(リンクが提供されない、または選択不可であること)を確認する。
4. 実行中に履歴ページを開き(または`POST /runs`直後・`complete`/`fail`報告前の状態を作り)、「実行中」ステータスで表示され、同様にリンクが提供されないことを確認する。

## 6. 設定名不明な既存実行の扱い

1. 本フィーチャー実装前に作成された(=`settings_name`が`NULL`の)実行記録がある状態で履歴ページを開く。
2. その実行が「設定名不明」等の表示とともに一覧に含まれることを確認する(エラーにならないこと)。
3. 何らかの設定名で絞り込むと、この実行は一覧から除外されることを確認する。

## 7. 既存機能への影響がないことの確認

- 結果ページ(`/results/:runId`)の「同一対象の過去実行」選択(FR-016、`GET /public/runs?targetId=`)が、成功した実行のみを対象とする既存の挙動のまま変わらないことを確認する。
- 実行ページ・設定ページの既存の動作(設定名の必須選択等)に変更がないことを確認する。
