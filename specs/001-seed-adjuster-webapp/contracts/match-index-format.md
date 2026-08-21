# Contract: MatchHistoryIndex アーティファクト形式

`indexer`(smash_databaseから対戦履歴を集計するスケジュール実行コンポーネント)と `compute`(実行のたびにこのインデックスを読み込む側)の間の契約。research.md #4 で決定した「メモリに収まる圧縮インデックス」の具体的なデータ形式を定義する。

## 配布方法

- indexerは生成したインデックスファイルを、公開URL経由でHTTP GETできる場所(例: GitHub Releasesのアセット)に配置する。
- computeは実行開始のたびに最新版インデックスを取得する。取得に失敗した場合、そのAdjustmentRunは`failed`とし、`failureHint`にその旨を記録する(FR-014)。

## ファイル形式

```json
{
  "formatVersion": 1,
  "generatedAt": "ISO8601",
  "coveragePeriod": { "from": "ISO8601", "to": "ISO8601" },
  "pairs": [
    {
      "userIdA": "string",
      "userIdB": "string",
      "matches": [
        { "timestamp": 0, "numEntrants": 0 }
      ]
    }
  ]
}
```

- `userIdA` < `userIdB`(文字列比較で正規化)とし、同一ペアの重複エントリを作らない。
- `matches`は`coveragePeriod.from`以降の対戦のみを含む(近さ指標への寄与が実質ゼロとなる古い対戦を除外する運用。research.md #4)。
- `formatVersion`はスキーマ変更時にインクリメントし、compute側は非対応バージョンを検出した場合、該当実行を`failed`として扱う。

## 増分更新の契約

- indexerは前回の`generatedAt`以降に追加された大会のみを追加集計し、`pairs`をマージして再公開する(smash_database全体の再走査を避けるため)。
- 生成物は単一ファイルとして原子的に公開する(部分的に更新された不整合なファイルをcomputeが取得することがないようにする)。
