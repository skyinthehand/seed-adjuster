# Data Model: 選手別の配置判断根拠の詳細確認

001フィーチャーの既存エンティティ(`specs/001-seed-adjuster-webapp/data-model.md`)を拡張する。新規エンティティは追加せず、既存の`DecisionLog`と`MatchHistoryIndex`にフィールドを追加する形にとどめ、保管先(D1のJSON blob / 静的アーティファクト)も変更しない。

## 保管先の変更点

| エンティティ | 保管先(変更なし) | 変更内容 |
|---|---|---|
| DecisionLog | Googleスプレッドシート(監査ログ用) + D1(公開用コピー、JSON blob) | `comparedCandidates[]`の各要素に`matches[]`を追加。D1側は既存のJSON blobカラムにそのまま収まるため、スキーマ変更(マイグレーション)は不要 |
| MatchHistoryIndex | 静的アーティファクト(indexerが生成、`published-index`ブランチで公開) | Parquetに`tournamentId`列を追加。新規に`tournaments.json`(大会ID→大会名の対応表)を追加公開 |

## DecisionLog(拡張)

001の定義(`runId`, `position`, `comparedCandidates[]`, `decisionLogicType`)はそのまま。`comparedCandidates[]`の各要素を拡張する。

- `candidateUserId` / `candidateDisplayName` / `matchPointValue`: 既存のまま変更なし
- `matches[]`(新規): その対戦相手候補との実際の対戦記録。0件の場合は「対戦履歴なし」を意味する(spec.md Clarifications)。各要素:
  - `tournamentId`: 対戦が行われた大会のID(`tournaments.json`で名前に解決する)
  - `date`: 対戦日(日付単位の精度。spec.md Assumptions)
  - `count`: 同じ大会・同じ日付での対戦回数(spec.md Clarifications。通常は1、複数ラウンドで対戦していた場合はその件数)

**バリデーション**: `matches[]`は同じ`tournamentId`+`date`の組み合わせを1件にまとめ、`count`で回数を表現する(重複エントリを持たない)。

## MatchHistoryIndex(拡張)

001の定義(`generatedAt`, `coveragePeriod`, `pairIndex`)はそのまま。

- `pairIndex`の各対戦記録に`tournamentId`(int64)を追加: `{ timestamp, numEntrants, tournamentId }`
- `tournamentDirectory`(新規): 大会ID→大会名の対応表。`tournaments.json`として`manifest.json`と同じ場所に公開する軽量な静的アーティファクト。フロントエンドは配置判断根拠の詳細確認を最初に開いたときにのみ取得し、以降はブラウザキャッシュから参照する(research.md R1, R4)。参照期間(`coveragePeriod`)に該当する大会のみを含む

## 新規に導入する一時的な画面状態(サーバー/D1には保存しない)

- **配置判断根拠の詳細表示状態**: 結果ページ(`ResultsPage.tsx`)が、どの選手の詳細確認を開いているか、および`tournamentDirectory`の取得状況(未取得/取得中/取得済み/失敗)を保持するブラウザ内の一時的なUI状態。ページを離れれば破棄され、永続化しない(spec.mdはこの機能について新たな永続状態を要求していない)。
