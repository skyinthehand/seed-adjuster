# Data Model: 実行履歴ページ

[001/data-model.md](../001-seed-adjuster-webapp/data-model.md)の`AdjustmentRun`エンティティを拡張する。新しい永続エンティティは追加しない。

## AdjustmentRun(拡張)

既存フィールドに加え、以下を追加する。

- `settingsName`(新規、`string | null`): 実行時に選択された設定名(`AdjustmentSettings.settingsName`)。**方針転換(2026-09-15)以降に導入された「設定名」概念が実行記録自体には反映されていなかったための追加**(research.md R1)。本フィーチャー実装より前に作成された実行記録では`null`(「設定名不明」として表示、設定名フィルタの対象外)。

**保管先**: Cloudflare D1、`adjustment_runs`テーブルに`settings_name TEXT`カラムを追加(既存の`CREATE TABLE IF NOT EXISTS`方式では反映されないため、稼働中のテーブルへ`ALTER TABLE`が別途必要。research.md R1)。

**バリデーション**: `POST /runs`のリクエストボディで必須(空文字不可)。RunPageは既に設定名を必須選択(`<select required>`)にしているため、常に非空の値が送られる前提。

## 実行履歴一覧項目(新規、永続データではなく投影)

`AdjustmentRun`を履歴ページ向けに一覧表示するための表示専用の形。新しい保存領域を持たず、`GET /public/run-history`のレスポンスとしてのみ存在する。

- `runId`: `AdjustmentRun.runId`
- `targetId`: `AdjustmentRun.targetId`
- `settingsName`: `AdjustmentRun.settingsName`(`null`の場合「設定名不明」として表示)
- `inputSource`: `AdjustmentRun.inputSource`
- `status`: `AdjustmentRun.status`(`queued` | `running` | `succeeded` | `failed`)。履歴ページ上は`queued`/`running`をまとめて「実行中」と表示する(spec.md Edge Cases)
- `createdAt`: `AdjustmentRun`の作成時刻。一覧のソートキー・表示上の「実行日時」として使う(research.md R5)
- `startedAt` / `finishedAt`: 参考情報として保持するが、一覧のソート・表示上の主たる日時としては`createdAt`を用いる
- `resultLink`: `status === "succeeded"`の場合のみ`/results/{runId}`への参照を持つ(FR-004, FR-005)。それ以外は`null`。**注**: `GET /public/run-history`のレスポンス(contracts/run-history.md)にこの名前のフィールドは存在しない — フロントエンドが`runId`と`status`から都度その場で導出する表示専用の値である

## フィルタ条件(永続データではない、リクエストパラメータ)

- `settingsName`(任意): 指定された場合、その設定名と完全一致する実行のみを対象とする(`null`の「設定名不明」実行は、フィルタ未指定時にのみ一覧に含まれる)
- `limit` / `offset`(任意): 段階的な追加読み込み(FR-008)に使用(research.md R3)
