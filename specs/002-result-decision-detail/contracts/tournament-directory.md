# Contract: 大会ID→大会名対応表(tournamentDirectory)

`indexer`(`match-index.parquet`/`manifest.json`と同じ`published-index`ブランチ)と`frontend`(配置判断根拠の詳細確認)の間の契約。research.md R1参照。

このファイルは既存の[001の`contracts/match-index-format.md`](../../001-seed-adjuster-webapp/contracts/match-index-format.md)への**追加**を定義する。実装時、以下の内容は001の`contracts/match-index-format.md`に統合し、この機能専用の別スキーマとしては扱わない(索引まわりの契約は1箇所に集約する)。

## Parquetスキーマへの追加

`match-index.parquet`の既存カラム(`userIdA`, `userIdB`, `timestamp`, `numEntrants`)に加え:

| カラム | 型 | 説明 |
|---|---|---|
| `tournamentId` | int64 | その対戦が行われた大会のID(`tournaments.json`で大会名に解決する) |

## `tournaments.json`(新規、manifest.jsonと同じ場所で公開)

```json
{
  "formatVersion": 1,
  "tournaments": { "<tournamentId>": "<大会名>", "...": "..." }
}
```

- `manifest.json`と同様、`published-index`ブランチへの force push で1コミットに置き換える(履歴を積まない、research.md R1)。
- 参照期間(`coveragePeriod`)に該当する大会のみを含む(research.md R4)。
- フロントエンドは配置判断根拠の詳細確認を最初に開いたときにのみ取得し、ブラウザの`Cache API`(`frontend/src/data/matchIndex.ts`が`match-index.parquet`に対して既に行っているキャッシュ方針と同様)でキャッシュする。取得が完了するまで、大会名欄は一時的な表示(例:「読み込み中」)とし、他の情報の表示は妨げない(FR-004, SC-004)。
- 取得に失敗した場合も、大会名が不明である旨を示すのみとし、他の情報の表示は妨げない(FR-004)。

## `POST /runs/{runId}/complete` / `GET /public/results/{runId}` の `decisionLog` への追加

既存の[001の`contracts/api.md`](../../001-seed-adjuster-webapp/contracts/api.md)の`decisionLog[].comparedCandidates[]`に`matches[]`を追加する:

```json
"comparedCandidates": [
  {
    "candidateDisplayName": "string",
    "matchPointValue": 0.0,
    "matches": [
      { "tournamentId": 123, "date": "YYYY-MM-DD", "count": 1 }
    ]
  }
]
```

- `matches`が空配列の場合、その対戦相手候補との実際の対戦記録が1件もないことを意味する(spec.md Clarifications)。
- 同じ`tournamentId`+`date`の組み合わせはまとめて1件とし、`count`で対戦回数を表す(data-model.md参照)。
