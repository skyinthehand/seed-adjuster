---

description: "Task list for 選手別の配置判断根拠の詳細確認"
---

# Tasks: 選手別の配置判断根拠の詳細確認

**Input**: Design documents from `/specs/002-result-decision-detail/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md (all present)

**Tests**: Not explicitly requested in spec.md; no dedicated test-writing tasks are generated(001と同様の方針)。検証はquickstart.mdの手動シナリオで行う。

**Organization**: Tasks are grouped by user story (spec.md priorities P1–P2)。新規コンポーネントは追加せず、既存の`frontend`/`indexer`を拡張する(plan.md Project Structure参照)。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task in the same phase)
- **[Story]**: Which user story this task belongs to (US1–US2)
- File paths follow `plan.md` § Project Structure

## Phase 1: Setup

新規プロジェクト・新規依存の追加はない(research.md R2、既存の`frontend`/`indexer`をそのまま拡張)。Setupタスクはなし。

## Phase 2: Foundational

全ストーリー共通でブロッキングとなる前提作業はない。User Story 1はResultsPage.tsxの単独変更のみで完結し、User Story 2はUser Story 1が作るモーダルの中身を拡張する形になる(依存関係は下記「User Story Dependencies」に明記)。Foundationalタスクはなし。

---

## Phase 3: User Story 1 - 選手の行から配置判断根拠を直接確認する (Priority: P1) 🎯 MVP

**Goal**: 結果ページの調整前後のシード比較表で、選手の行から直接その選手の配置判断根拠(元の順位・比較した対戦相手候補・採用ロジック・調整後順位)をモーダルで確認できる。

**Independent Test**: 完了済みの結果ページを開き、任意の選手の行から詳細確認を開いて、その選手の元の順位・比較した対戦相手候補(近い順)・近さの指標値・採用ロジック・調整後の順位が、他の選手の情報と混在せず確認できることを検証する(既存の`decisionLog`/`waveConstraintViolations`データのみで完結し、バックエンド・indexerの変更は不要)。

### Implementation for User Story 1

- [X] T001 [US1] `frontend/src/pages/ResultsPage.tsx`: 調整前後のシード比較表の各選手行に「詳細」ボタンを追加し、選択中の選手の`adjustedPosition`を保持する状態と、それに連動して開閉する`<dialog>`要素を実装する。この時点で、モーダル内を「閉じるボタン等の操作要素を含む固定領域」と「内容を表示するスクロール可能な領域」に分けたレイアウトにしておく(User Story 2のT017で内容領域に非同期差し替えが入っても手戻りにならないよう、先回りしておく。FR-001, FR-008)(実装: `PlacementDecisionModal`コンポーネント、`header`が固定領域・内側の`div`がスクロール可能領域)
- [X] T002 [US1] `frontend/src/pages/ResultsPage.tsx`: モーダル内に、選択中の選手の元の順位(`originalPosition`)・比較した対戦相手候補一覧(近い順、`candidateDisplayName`と`matchPointValue`)・採用された`decisionLogicType`・調整後の最終順位(`adjustedPosition`)を表示する(既存の`result.decisionLog`を`position`でlookup。FR-002)
- [X] T003 [US1] `frontend/src/pages/ResultsPage.tsx`: 比較対象の対戦相手候補が0件の選手について、「比較対象なし」である旨を表示する分岐を実装する(エラーにはしない。spec.md User Story 1 Acceptance Scenario 3)
- [X] T004 [US1] `frontend/src/pages/ResultsPage.tsx`: Wave希望により通常の判定ロジックが無視された選手について、モーダル内にその旨を明示する分岐を実装する(既存の`result.waveConstraintViolations`を`position`でlookup。FR-006)
- [X] T005 [US1] `frontend/src/pages/ResultsPage.tsx`: 別の選手の行から詳細確認を開き直した際に表示内容が切り替わり前の選手の情報と混在しないこと、および画面幅375px相当でもレイアウトが崩れないことを確認し、必要なCSS調整を行う(FR-005, SC-003)(実装: `maxWidth: 90vw`+flex column+内容領域`overflowY: auto`。`selectedPosition`が変わるたびに`entry`/`log`/`waveViolation`を再計算するため混在なし。実ブラウザでの375px目視確認は本環境では未実施、quickstart.mdシナリオ5でのデプロイ後確認が必要)

**Checkpoint**: User Story 1 is fully functional and independently testable — this is the MVP。バックエンド(control-plane)・indexerの変更は一切不要。

---

## Phase 4: User Story 2 - 対戦相手候補の実際の対戦大会・日時を確認する (Priority: P2)

**Goal**: User Story 1のモーダル内で、比較された対戦相手候補それぞれについて、実際に対戦した大会名・対戦日時を確認できる。

**Independent Test**: 既知の対戦実績を持つ選手ペアが含まれる結果ページでUser Story 1の詳細確認を開き、対戦相手候補ごとに実際の大会名・対戦日時(複数回対戦していればまとめて件数併記、対戦記録がなければその旨)が表示されることを検証する。

### Implementation for User Story 2

- [X] T006 [US2] `indexer/src/build_index.py`: `collect_event_paths()`が`tournament_id`も保持するよう変更し、各`MatchRow`に`tournament_id`を持たせる。あわせて`write_parquet()`で`tournamentId`列(int64)を書き出す(research.md R1、contracts/tournament-directory.md)(実データで検証: `skyinthehand/smash_database`の`tournaments.jsonl`から`tournament_id`が正しく`MatchRow`まで届くことを確認済み)
- [X] T007 [US2] `indexer/src/build_index.py`: 走査済みの`tournaments`一覧(`tournament_id`と`name`を両方保持)から、参照期間内に対戦が残った大会のみに絞った`{tournamentId: name}`対応表(`build_tournament_directory()` + `build_index()`内の`used_tournament_ids`フィルタ)を構築し、`dist/tournaments.json`として書き出す(追加のHTTP取得は不要。research.md R1, R4)(実データで検証: 全19,525件のフィルタなし対応表で0.78MB、research.md R4の見積もり(概ね1MB前後)と一致。実際の出力は参照期間フィルタでさらに小さくなる)
- [X] T008 [P] [US2] `.github/workflows/indexer.yml`: `dist/tournaments.json`も`dist/match-index.parquet`/`dist/manifest.json`と一緒に`published-index`ブランチへforce pushで公開するよう更新する
- [X] T009 [P] [US2] `frontend/src/data/matchIndex.ts`: DuckDB-WASMのSELECT文に`tournamentId`列を追加し、Pyodideへ渡す`matchLookup`の各対戦記録に`tournamentId`を含める
- [X] T010 [US2] `frontend/src/data/matchIndex.ts`: `tournaments.json`を取得しブラウザの`Cache API`でキャッシュする関数を追加する(取得失敗時は呼び出し元がその旨を扱えるようにnull/エラーを返す設計。research.md R1, R4、contracts/tournament-directory.md)(T009と同ファイルのため逐次実装)(実装: `fetchTournamentDirectory()`。失敗時は例外をthrowし、既存の`fetchManifest`/`fetchParquetCached`と同じ流儀に統一。呼び出し元は`try/catch`で扱う)
- [X] T011 [US2] `frontend/src/engine/seed_adjuster.py`: `match_log`に、比較した対戦相手候補ごとの**個々の**対戦記録(`timestamp`, `tournament_id`)をそのまま(集約せず)保持させる。近さの指標値の算出ロジック自体は変更しない(research.md R5)(実装: `is_adjusted_seed`/`get_least_match`に`match_lookup`を渡し、`search_player_matches()`(既存関数)で`calc_match_point`と同じフィルタ条件の生の対戦記録を取得、各候補チャンクの5番目の要素として追加。合成データで動作確認済み: 同一大会・同一日の重複対戦も集約されず生のまま出力されることを確認)
- [X] T012 [US2] `frontend/src/engine/pyodideRuntime.ts`: `AdjustedResult`/`match_logs`の型を拡張し、T011で追加した個々の対戦記録を保持できるようにする(`match_logs: unknown[][]`は既にネスト配列を許容するため型変更不要。`MatchLookupEntry`に`tournamentId: number`を追加)
- [X] T013 [US2] `frontend/src/engine/runAdjustment.ts`: `parseDecisionLog()`を拡張し、T011/T012で渡ってくる個々の対戦記録から、**同じ大会・同じ日付の対戦をまとめて1件・件数併記にする集約ロジックをここで実装し**、比較候補ごとの`matches[]`(`{ tournamentId, date, count }`)を組み立てて`decisionLog`に含める(集約はPython側では行わない。contracts/tournament-directory.md参照)(実装: `aggregateMatches()`/`toJstDateString()`(JST日付、既存のref_date処理と統一)。あわせて`buildResultMatrix()`が監査ログスプレッドシートへ生の対戦記録配列をそのまま書き出してしまわないよう`spreadsheetMatchLogRow()`を追加し、スプレッドシート出力は従来通り4要素のみ使用。Node上でJS版の集約ロジックを検証: 同一大会・同一日の重複3件が正しく2件(count=2/1)にまとまることを確認)
- [X] T014 [P] [US2] `frontend/src/services/controlPlaneClient.ts`: `DecisionLogEntry`の`comparedCandidates`型に`matches[]`(`{ tournamentId: number, date: string, count: number }`)を追加する(`CompleteRunRequest`側にも同様に反映)
- [X] T015 [US2] `frontend/src/pages/ResultsPage.tsx`: モーダル内の対戦相手候補ごとに、T010の対応表を使って大会名を解決し、対戦日時・件数とあわせて表示する。対戦記録が0件の候補には「対戦履歴なし」を表示する(FR-003)(実装: `MatchList`コンポーネント)
- [X] T016 [US2] `frontend/src/pages/ResultsPage.tsx`: `tournaments.json`の取得が完了するまで大会名欄を「読み込み中」の一時表示にし、取得完了後に差し替える。取得失敗時は大会名が不明である旨を表示し、他の情報の表示は妨げない(FR-004, SC-004)(実装: `directoryStatus`(idle/loading/loaded/failed)を選手行の詳細を初めて開いたときにのみ`fetchTournamentDirectory()`で取得、`tournamentNameLabel()`で状態に応じた文言を返す)
- [X] T017 [US2] `frontend/src/pages/ResultsPage.tsx`: T001で用意した固定領域/スクロール可能な内容領域のレイアウトに沿って対戦相手候補一覧を内容領域内に配置し、T016の大会名差し替えで操作要素の位置がずれないことを確認する(FR-008、research.md R3)(`MatchList`はスクロール可能な内容領域`div`内にのみ描画され、固定領域の`header`(閉じるボタン)には影響しない。実ブラウザでの目視確認は本環境では未実施、quickstart.mdシナリオ4でのデプロイ後確認が必要)

**Checkpoint**: User Stories 1 and 2 both work independently。

---

## Phase 5: Polish & Cross-Cutting Concerns

**Purpose**: 全ストーリーに関わる横断的な仕上げ

- [X] T018 Run quickstart.md の全検証シナリオ(indexerの`tournamentId`/`tournaments.json`生成確認、US1基本動作、US2の大会名・日時表示、大会名解決の遅延・失敗時の挙動とFR-008、狭い画面幅、既存機能への非影響)を実施する(実施範囲の制約: このCLI環境には実ブラウザ・デプロイ済みCloudflare Workers/D1/GitHub Pages/`published-index`ブランチが存在しないため、真のE2Eブラウザ検証は未実施。代わりに以下を実施:
  - シナリオ1: `skyinthehand/smash_database`に対し実際に`build_index()`を実行し、`tournamentId`が`MatchRow`まで正しく届くこと、`tournaments.json`相当の対応表(全19,525件で0.78MB、research.md R4の見積もりと一致)が構築できることを確認
  - シナリオ2/3: `seed_adjuster.py`に合成データ(同一大会・同一日付の重複対戦を含む)を与え、`match_log`の各候補チャンクに個々の対戦記録が集約されずそのまま残ること、`frontend/src/engine/runAdjustment.ts`の集約ロジック(`aggregateMatches`)と同一実装をNode上で検証し、重複3件が正しく2件(count=2/1)にまとまることを確認
  - シナリオ4/5: `tsc -b --force`・`eslint`・`vite build`がすべてエラーなく通ることを確認。`directoryStatus`によるローディング/失敗表示、固定領域/スクロール領域の分離はコードレビューで確認したが、実ブラウザでの目視確認(375px表示・閉じるボタンの位置ズレなし)は未実施
  - シナリオ6: 既存の001機能(調整前後のシード比較表・Wave違反一覧・調整前シード順)のJSX構造は変更しておらず、`decisionLog`・`waveConstraintViolations`等の既存フィールドの読み取り方も変更していないため影響なしと判断。認証不要のアクセス経路(`GET /public/results/{runId}`)自体にも変更なし
  - 残作業: デプロイ後、運営者自身による実ブラウザでの目視確認(375px表示、大会名の読み込み中→解決の差し替えでボタン位置が動かないこと、`tournaments.json`取得失敗時のフォールバック表示)が必要)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: なし(タスクなし)
- **Foundational (Phase 2)**: なし(タスクなし)
- **User Story 1 (Phase 3)**: 依存なし。すぐ着手可能。MVP。
- **User Story 2 (Phase 4)**: User Story 1が作るモーダルの中身を拡張するため、T001(モーダルの開閉状態・シェル)完了後に着手する。indexer側のタスク(T006–T008)はUser Story 1と並行して着手できる。
- **Polish (Phase 5)**: User Story 1・2の実装完了後。

### User Story Dependencies

- **User Story 1 (P1)**: 他ストーリーへの依存なし。既存の`decisionLog`/`waveConstraintViolations`データのみで完結する。
- **User Story 2 (P2)**: User Story 1が実装したモーダルのシェル(T001)に依存する。indexer側のデータ拡張(T006–T008)自体はUser Story 1と独立して並行実装できる。

### Parallel Opportunities

- indexer側のタスク(T006–T008のうちT008)とfrontend側のUser Story 1タスク(T001–T005)は互いに独立しており並行実装できる。
- T009([P])と T014([P])は異なるファイルのため、T006–T008完了を待たずに並行して着手できる。
- User Story 1内のタスク(T001–T005)はすべて同一ファイル(`ResultsPage.tsx`)のため[P]マークなし、逐次実装する。
- User Story 2内も大半が同一ファイル群への逐次変更(indexer: T006→T007、frontend: T009→T010、T011→T012→T013、ResultsPage.tsx: T015→T016→T017)のため、[P]マークがあるのはT008・T009・T014のみ。

---

## Parallel Example: User Story 2 着手時

```bash
# T001(User Story 1のモーダルシェル)完了後、以下は並行して着手できる:
Task: "indexer/src/build_index.py に tournamentId 列と tournaments.json 生成を追加(T006-T007)"
Task: ".github/workflows/indexer.yml に tournaments.json のpublishを追加(T008)"
Task: "frontend/src/data/matchIndex.ts に tournamentId SELECT + tournaments.json 取得関数を追加(T009-T010)"
Task: "frontend/src/services/controlPlaneClient.ts の DecisionLogEntry 型を拡張(T014)"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 3(User Story 1)を実装する
2. **STOP and VALIDATE**: quickstart.mdのシナリオ2(詳細確認UIの基本動作)を実施し、独立して動作することを確認する
3. デプロイ/デモ(既存のGitHub Pages/Cloudflare Workersへの再デプロイのみ、新規コンポーネントなし)

### Incremental Delivery

1. User Story 1 → 単独検証 → デプロイ/デモ(MVP!)
2. User Story 2 → 単独検証(quickstart.mdシナリオ3・4) → デプロイ/デモ
3. Polish(quickstart.md全検証)

### Parallel Team Strategy

複数人で進める場合:

1. 担当A: User Story 1(`ResultsPage.tsx`のモーダルシェル、T001)を最初に完了させる
2. T001完了後:
   - 担当A: User Story 1の残り(T002–T005)
   - 担当B: indexer側の拡張(T006–T008、User Story 1と独立して並行着手可能)
   - 担当C: `matchIndex.ts`/`controlPlaneClient.ts`の型・データ層拡張(T009, T014)
3. 上記が揃い次第、User Story 2のアルゴリズム側(T011–T013)とUI側(T015–T017)を実装する

---

## Notes

- [P] tasks = different files, no dependency on an incomplete task in the same phase
- [Story] label maps task to specific user story for traceability
- User Story 1は既存の`decisionLog`データの見せ方を変えるだけで、バックエンド(control-plane)・indexerの変更を一切必要としない(spec.mdのFR-007「結果ページの既存の公開性を変更してはならない」にも寄与する、変更範囲が最小であるため)
- User Story 2で追加する`tournaments.json`は、詳細確認を最初に開いたときにのみ取得する(SC-004)。ページ読み込み時に先読みしない
- 近さの指標値(`matchPointValue`)の算出ロジック自体は本フィーチャーでは変更しない(spec.md Assumptions)
- Commit after each task or logical group
- Stop at any checkpoint to validate a story independently
- Avoid: vague tasks, same-file conflicts marked [P], cross-story dependencies that break independence
