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

- [ ] T001 [US1] `frontend/src/pages/ResultsPage.tsx`: 調整前後のシード比較表の各選手行に「詳細」ボタンを追加し、選択中の選手の`adjustedPosition`を保持する状態と、それに連動して開閉する`<dialog>`要素を実装する(FR-001)
- [ ] T002 [US1] `frontend/src/pages/ResultsPage.tsx`: モーダル内に、選択中の選手の元の順位(`originalPosition`)・比較した対戦相手候補一覧(近い順、`candidateDisplayName`と`matchPointValue`)・採用された`decisionLogicType`・調整後の最終順位(`adjustedPosition`)を表示する(既存の`result.decisionLog`を`position`でlookup。FR-002)
- [ ] T003 [US1] `frontend/src/pages/ResultsPage.tsx`: 比較対象の対戦相手候補が0件の選手について、「比較対象なし」である旨を表示する分岐を実装する(エラーにはしない。spec.md User Story 1 Acceptance Scenario 3)
- [ ] T004 [US1] `frontend/src/pages/ResultsPage.tsx`: Wave希望により通常の判定ロジックが無視された選手について、モーダル内にその旨を明示する分岐を実装する(既存の`result.waveConstraintViolations`を`position`でlookup。FR-006)
- [ ] T005 [US1] `frontend/src/pages/ResultsPage.tsx`: 別の選手の行から詳細確認を開き直した際に表示内容が切り替わり前の選手の情報と混在しないこと、および画面幅375px相当でもレイアウトが崩れないことを確認し、必要なCSS調整を行う(FR-005, SC-003)

**Checkpoint**: User Story 1 is fully functional and independently testable — this is the MVP。バックエンド(control-plane)・indexerの変更は一切不要。

---

## Phase 4: User Story 2 - 対戦相手候補の実際の対戦大会・日時を確認する (Priority: P2)

**Goal**: User Story 1のモーダル内で、比較された対戦相手候補それぞれについて、実際に対戦した大会名・対戦日時を確認できる。

**Independent Test**: 既知の対戦実績を持つ選手ペアが含まれる結果ページでUser Story 1の詳細確認を開き、対戦相手候補ごとに実際の大会名・対戦日時(複数回対戦していればまとめて件数併記、対戦記録がなければその旨)が表示されることを検証する。

### Implementation for User Story 2

- [ ] T006 [US2] `indexer/src/build_index.py`: `collect_event_paths()`が`tournament_id`も保持するよう変更し、各`MatchRow`に`tournament_id`を持たせる。あわせて`write_parquet()`で`tournamentId`列(int64)を書き出す(research.md R1、contracts/tournament-directory.md)
- [ ] T007 [US2] `indexer/src/build_index.py`: 走査済みの`tournaments`一覧(`tournament_id`と`name`を両方保持)から、参照期間(`coverage_years`)内の大会のみに絞った`{tournamentId: name}`対応表を構築し、`dist/tournaments.json`として書き出す(追加のHTTP取得は不要。research.md R1, R4)
- [ ] T008 [P] [US2] `.github/workflows/indexer.yml`: `dist/tournaments.json`も`dist/match-index.parquet`/`dist/manifest.json`と一緒に`published-index`ブランチへforce pushで公開するよう更新する
- [ ] T009 [P] [US2] `frontend/src/data/matchIndex.ts`: DuckDB-WASMのSELECT文に`tournamentId`列を追加し、Pyodideへ渡す`matchLookup`の各対戦記録に`tournamentId`を含める
- [ ] T010 [US2] `frontend/src/data/matchIndex.ts`: `tournaments.json`を取得しブラウザの`Cache API`でキャッシュする関数を追加する(取得失敗時は呼び出し元がその旨を扱えるようにnull/エラーを返す設計。research.md R1, R4、contracts/tournament-directory.md)(T009と同ファイルのため逐次実装)
- [ ] T011 [US2] `frontend/src/engine/seed_adjuster.py`: `match_log`に、比較した対戦相手候補ごとの個々の対戦記録(`timestamp`, `tournament_id`)を保持させ、同じ大会・同じ日付の対戦はまとめて1件・件数併記にする集約ロジックを実装する(近さの指標値の算出ロジック自体は変更しない。research.md R5、spec.md Clarifications)
- [ ] T012 [US2] `frontend/src/engine/pyodideRuntime.ts`: `AdjustedResult`/`match_logs`の型を拡張し、T011で追加した個々の対戦記録を保持できるようにする
- [ ] T013 [US2] `frontend/src/engine/runAdjustment.ts`: `parseDecisionLog()`を拡張し、比較候補ごとの`matches[]`(`{ tournamentId, date, count }`)を組み立てて`decisionLog`に含める(contracts/tournament-directory.md参照)
- [ ] T014 [P] [US2] `frontend/src/services/controlPlaneClient.ts`: `DecisionLogEntry`の`comparedCandidates`型に`matches[]`(`{ tournamentId: number, date: string, count: number }`)を追加する
- [ ] T015 [US2] `frontend/src/pages/ResultsPage.tsx`: モーダル内の対戦相手候補ごとに、T010の対応表を使って大会名を解決し、対戦日時・件数とあわせて表示する。対戦記録が0件の候補には「対戦履歴なし」を表示する(FR-003)
- [ ] T016 [US2] `frontend/src/pages/ResultsPage.tsx`: `tournaments.json`の取得が完了するまで大会名欄を「読み込み中」の一時表示にし、取得完了後に差し替える。取得失敗時は大会名が不明である旨を表示し、他の情報の表示は妨げない(FR-004, SC-004)
- [ ] T017 [US2] `frontend/src/pages/ResultsPage.tsx`: モーダルを「閉じるボタン等の操作要素を含む固定領域」と「対戦相手候補一覧を表示するスクロール可能な内容領域」に分離し、T016の大会名差し替えで操作要素の位置がずれないようにする(FR-008、research.md R3)

**Checkpoint**: User Stories 1 and 2 both work independently。

---

## Phase 5: Polish & Cross-Cutting Concerns

**Purpose**: 全ストーリーに関わる横断的な仕上げ

- [ ] T018 Run quickstart.md の全検証シナリオ(indexerの`tournamentId`/`tournaments.json`生成確認、US1基本動作、US2の大会名・日時表示、大会名解決の遅延・失敗時の挙動とFR-008、狭い画面幅、既存機能への非影響)を実施する

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
