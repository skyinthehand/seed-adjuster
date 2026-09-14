# Research: 選手別の配置判断根拠の詳細確認

spec.mdのAssumptions・Clarificationsで方針が固まっている点は再掲せず、実装アプローチを決めるために調査・決定した点のみを記す。

## R1. 大会名の解決方法

**Decision**: `match-index.parquet`に`tournamentId`列(int64)を追加するのみとし、大会名の文字列は索引本体に含めない。「大会ID→大会名」の対応表を`tournaments.json`として`manifest.json`と同じ`published-index`ブランチに追加公開し、フロントエンドは配置判断根拠の詳細確認を最初に開いたときにのみ取得・キャッシュする。

対応表は`indexer`がsmash_databaseの`tournaments.jsonl`から構築する。実際にこのファイルの1行を確認したところ、`tournament_id`と`name`が最初から両方含まれている(例: `{"tournament_id": 729207, "name": "渋谷BeeSmash 35", "events": [...], "version": "1.0"}`)。現在の`indexer/src/build_index.py`の`collect_event_paths()`はこの`tournaments`一覧を走査して`event.path`の一覧に平坦化する際に`tournament_id`を捨てている。これを`(tournament_id, path)`のペアの一覧に変更し、各`MatchRow`に`tournament_id`を持たせるとともに、走査中の`tournaments`一覧からそのまま`{tournament_id: name}`の対応表を構築すればよく、**追加のHTTP取得は不要**(`attr.json`の`tournament_name`フィールドを使う必要もない)。

**Rationale**: ユーザーの明示的な指示(索引本体にはIDのみを持たせ、名前は別途解決する)に沿う。索引本体(Parquet)を肥大化させず、対応表は独立した小さいファイルとして初回アクセス時のみ取得すればよい。

**Alternatives considered**:
- `match-index.parquet`に`tournamentName`を直接持たせる: 索引本体が肥大化する(Parquetの辞書圧縮で緩和はされるが、そもそも索引を小さく保つという既存方針(research.md #2, 001)に反する)ため不採用。
- フロントエンドが`smash_database`の`tournaments.jsonl`を都度取得して逆引きする: 実測したところ19,525件(2026-09-14時点)・数MBの1ファイルであり、詳細確認を開くたびにこれを取得するのは非現実的なため不採用(ただしこの実測自体が、対応表`tournaments.json`のサイズ見積もりの根拠になる。R4参照)。

## R2. モーダルの実装方式

**Decision**: 標準のHTML `<dialog>`要素を使って実装する。新規npm依存は追加しない。

**Rationale**: 既存のフロントエンド(`frontend/src/pages/*.tsx`)はUIコンポーネントライブラリを一切使用しておらず、素のHTML要素のみで構成されている。`<dialog>`要素はブラウザネイティブに開閉・背景クリックでの閉じる・Escキーでの閉じるを提供し、モーダル内のコンテンツ量に応じて自然にリフローするため、FR-005(狭い画面幅での利用)にも素直に対応できる。新規依存を増やさないことは、既存の「重い計算以外は極力薄く保つ」という設計方針(plan.md 001, research.md #0/#1)とも整合する。

**Alternatives considered**: 何らかのモーダル/ダイアログ用npmパッケージの追加導入。新規依存が増えるだけでなく、既存の「素のHTML」という一貫性からも外れるため不採用。

## R3. 大会名解決中の位置ズレ防止(FR-008)

**Decision**: モーダル内を「閉じるボタン等の操作要素を含む固定領域」と「比較対象候補の一覧を表示するスクロール可能な内容領域」に分け、大会名の差し替えは内容領域の中でのみ発生させる。閉じるボタンは固定領域(モーダル上部または下部)に配置し、内容領域の高さ変化の影響を受けない位置に固定する。

**Rationale**: 大会名という可変長文字列の差し替えによってモーダル全体の高さが変わっても、操作要素(閉じるボタン)自体は独立した固定領域にあるため位置がずれない。モーダルの最大高さをビューポートに対して制限し、内容領域だけを内部スクロールさせることで、狭い画面幅(FR-005)でも同様の効果が得られる。

**Alternatives considered**: 大会名の解決を待ってからモーダルを開く(Clarificationsで却下済み。SC-004に反する)。すべての領域を一括で再レイアウトさせる(操作要素の位置ズレを許容する)案は、今回の要望(FR-008)に反するため不採用。

## R4. `tournaments.json`のサイズ見積もり

**Decision**: 実装時に実際にビルドして実測検証する(quickstart.mdの検証手順に含める)。事前見積もりとしては、対応表が索引のダウンロード体験を損なわない小容量に収まる可能性が高いと判断し、設計をブロックしない。

**根拠となる実測**(本セッション中に実施): `skyinthehand/smash_database`の`tournaments.jsonl`は2026-09-14時点で19,525件。大会IDと大会名のみに絞った対応表であれば、大会名の実測サンプル(日本語で概ね10〜20文字程度)を踏まえて非圧縮で1MB前後、`raw.githubusercontent.com`はgzip圧縮に対応しているためHTTP応答としてはさらに小さくなると見積もられる。なお対応表は5年間の参照期間(coverage_years)に該当する対戦を含む大会のみに絞ってよく、実際の件数は19,525件より少なくなる可能性が高い。

**Alternatives considered**: 対応表を参照期間で絞らず全期間分作る案は、コード変更を単純化できる一方で不要に大きくなるため、参照期間内の大会のみに絞る設計を採用する。

## R5. 判断根拠ログのデータフロー拡張

**Decision**: `frontend/src/engine/seed_adjuster.py`の`match_log`(比較候補ごとの記録)に、既存の集約値(`match_point`)に加えて、個々の対戦記録(`timestamp`, `tournament_id`)のリストを持たせる。これは`matchLookup`(`frontend/src/data/matchIndex.ts`がDuckDB-WASM経由で既に取得している生の対戦記録一覧)をそのままPython側へ渡せば実現でき、対戦履歴インデックスへのクエリ方法自体(DuckDB-WASMのSQL)は変更不要。`tournamentId`列をSELECT対象に追加するだけでよい。

**Rationale**: 近さの指標値(`match_point`)を算出する計算自体は既存のまま変更せず(spec.md Assumptions)、算出の元になった生データをログとして残すだけなので、アルゴリズムのロジックに影響を与えない。

**Alternatives considered**: 近さの指標値の計算過程で対戦記録を都度ログへ書き出す(計算ロジックに変更が必要になり、既存ロジックを変更しないという方針に反するため不採用)。
