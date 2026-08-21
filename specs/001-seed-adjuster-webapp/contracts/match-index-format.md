# Contract: MatchHistoryIndex アーティファクト形式

`indexer`(smash_databaseから対戦履歴を集計するスケジュール実行コンポーネント、GitHub Actions上で動作)と `frontend`(ブラウザ内のDuckDB-WASMでこのインデックスを直接クエリする側)の間の契約。research.md #2 で決定した「メモリに収まる圧縮インデックス」の具体的なデータ形式を定義する。

## 配布方法

- indexerは生成したインデックスファイルを **Parquet形式**で、公開URL経由でHTTP GETできる場所(例: GitHub Releasesのアセット)に配置する。
- フロントエンドは実行開始のたびに最新版インデックスを取得し、DuckDB-WASMにロードする。取得に失敗した場合、そのAdjustmentRunは`failed`とし、`failureHint`にその旨を記録する(FR-014)。

## スキーマ(論理形式)

Parquetファイルは以下の論理スキーマを持つテーブル1つで構成する(`formatVersion`・`generatedAt`・`coveragePeriod`はファイル名やメタデータ、または別途配布する小さなJSONマニフェストで管理する)。

| カラム | 型 | 説明 |
|---|---|---|
| `userIdA` | string | 選手ペアのうち文字列比較で小さい方のID |
| `userIdB` | string | 選手ペアのうち文字列比較で大きい方のID |
| `timestamp` | int64 | 対戦が行われた日時(Unix time) |
| `numEntrants` | int32 | その対戦が行われた大会の参加者数 |

- `userIdA` < `userIdB` に正規化し、同一ペアの対戦は複数行(対戦ごとに1行)として保持する(DuckDB-WASMでのSQL集計に適した縦持ち形式)。
- 収録される対戦は`coveragePeriod.from`以降のみ(近さ指標への寄与が実質ゼロとなる古い対戦を除外する運用。research.md #2)。

## マニフェスト(JSON、Parquet本体と併せて配布)

```json
{
  "formatVersion": 1,
  "generatedAt": "ISO8601",
  "coveragePeriod": { "from": "ISO8601", "to": "ISO8601" },
  "parquetUrl": "https://.../match-index.parquet"
}
```

- `formatVersion`はスキーマ変更時にインクリメントし、フロントエンド側は非対応バージョンを検出した場合、該当実行を`failed`として扱う。

## 増分更新の契約

- indexerは前回の`generatedAt`以降に追加された大会のみを追加集計し、Parquetファイルをマージして再生成・再公開する(smash_database全体の再走査を避けるため)。
- 生成物(マニフェストとParquet本体)は原子的に公開する(マニフェストが指す`parquetUrl`が常に完全なファイルを指すようにし、フロントエンドが部分的に更新された不整合なファイルを取得することがないようにする)。
