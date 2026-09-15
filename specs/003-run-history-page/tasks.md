---

description: "Task list for 実行履歴ページ"
---

# Tasks: 実行履歴ページ

**Input**: Design documents from `/specs/003-run-history-page/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md (all present)

**Tests**: spec.mdで明示的に要求されていないため、専用のテスト作成タスクは生成しない(001・002と同様の方針)。検証はquickstart.mdの手動シナリオで行う。

**Organization**: Tasks are grouped by user story (spec.md priorities P1–P3)。新規コンポーネントは追加せず、既存の`frontend`/`control-plane`を拡張する(plan.md Project Structure参照)。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task in the same phase)
- **[Story]**: Which user story this task belongs to (US1–US3)
- File paths follow `plan.md` § Project Structure

## Phase 1: Setup

新規プロジェクト・新規npm依存の追加はない(research.md R6、既存の`frontend`/`control-plane`をそのまま拡張)。Setupタスクはなし。

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: 全ユーザーストーリーが依存する「実行記録への設定名の付与」と「全実行を横断取得するAPI」を用意する。research.md R1で判明した既存の欠落(実行記録がそもそも設定名を保持していない)を埋める作業のため、いずれのユーザーストーリーもこれなしには成立しない。

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [ ] T001 `control-plane/src/db/schema.sql`: `adjustment_runs`テーブルに`settings_name TEXT`カラムを追加する。あわせて、既存の`CREATE TABLE IF NOT EXISTS`方式では稼働中のテーブルに反映されない旨のコメントを残す(research.md R1)
- [ ] T002 `control-plane/src/db/runsRepository.ts`: `CreateRunInput`/`AdjustmentRunRecord`に`settingsName: string`(取得系は`string | null`)を追加し、`createRun()`が`settings_name`列へ保存、`getRun()`が返却するよう変更する。あわせて新規`RunHistoryEntry`型(`runId, targetId, settingsName, inputSource, status, createdAt, startedAt, finishedAt`)と`listRunHistory(env, { settingsName?, limit, offset })`関数を追加する。全ステータス(`queued`/`running`/`succeeded`/`failed`)を対象に`created_at`降順で取得し、`{ runs, hasMore }`を返す(`hasMore`は`offset + limit`件より先に行が存在するかで判定。research.md R2, R3, R5、contracts/run-history.md)
- [ ] T003 `control-plane/src/api/runs.ts`: `handleCreateRun()`で`settingsName`が非空文字列であることを必須チェックに追加(欠落・空文字は`400 INVALID_REQUEST`)。`handleGetRun()`のレスポンスは`getRun()`の返り値をそのまま返しているため`settingsName`は自動的に含まれることを確認する(contracts/run-history.md)
- [ ] T004 `control-plane/src/api/public.ts`: 新規`handleListRunHistory(request, env)`を追加する。クエリパラメータ`settingsName`(任意)・`limit`(既定30・上限100)・`offset`(既定0)をパースし、T002の`listRunHistory()`を呼んで`{ runs, hasMore }`をそのまま返す(contracts/run-history.md)
- [ ] T005 `control-plane/src/index.ts`: `GET /public/run-history`を`handleListRunHistory`へルーティングする(既存の`/public/runs`ルートとは別のパスのため、既存挙動に影響しない)
- [ ] T006 [P] `frontend/src/services/controlPlaneClient.ts`: `CreateRunRequest`に`settingsName: string`、`RunStatusResponse`に`settingsName: string | null`を追加する。新規`RunHistoryEntry`型(control-planeのレスポンス形と一致させる)と、`GET /public/run-history`を呼ぶ`listRunHistory(params: { settingsName?: string; limit?: number; offset?: number }): Promise<{ runs: RunHistoryEntry[]; hasMore: boolean }>`を追加する
- [ ] T007 `frontend/src/engine/runAdjustment.ts`: `RunGoogleSheetsInput`/`RunStartggInput`に`settingsName: string`を追加し、2箇所の`createRun()`呼び出し(`runGoogleSheetsAdjustment`/`runStartggAdjustment`)にそのまま渡す(T006完了後)
- [ ] T008 `frontend/src/pages/RunPage.tsx`: `runGoogleSheetsAdjustment`/`runStartggAdjustment`の呼び出し引数に、既にstateとして保持している`settingsName`を追加する(T007完了後)

**Checkpoint**: `POST /runs`が`settingsName`を記録し、`GET /public/run-history`が全実行を横断取得できる状態。ここから各ユーザーストーリーのUI実装に進める。

---

## Phase 3: User Story 1 - 過去の実行を一覧から見つけて開く (Priority: P1) 🎯 MVP

**Goal**: 「実行」ページ・「設定」ページとは別の「履歴」ページで、過去の実行(進行中・成功・失敗すべて)を新しい順に一覧表示し、成功した実行は結果ページへ直接遷移できる。

**Independent Test**: 実行を1件完了させた後、結果URLを保存せずに履歴ページを開き、一覧からその実行を選んで結果ページに到達できることを確認する(quickstart.md #3)。

### Implementation for User Story 1

- [ ] T009 [US1] `frontend/src/App.tsx`: ナビゲーションに「履歴」リンクを追加し、`/history`ルートを新規`HistoryPage`にマッピングする
- [ ] T010 [US1] `frontend/src/pages/HistoryPage.tsx`(新規): マウント時に`listRunHistory({})`(絞り込みなし)を呼び出し、読み込み中状態を表示する。取得した`runs`をstateに保持する
- [ ] T011 [US1] `frontend/src/pages/HistoryPage.tsx`: 一覧を表(または`<ul>`)で表示する。各行に設定名(`settingsName`が`null`の場合は「設定名不明」)・入力方式(`google_sheets`→「Googleスプレッドシート」、`startgg`→「start.gg」の日本語表示)・実行日時(`createdAt`を読みやすい形式に整形)・ステータスラベル(`queued`/`running`→「実行中」、`succeeded`→「成功」、`failed`→「失敗」に変換する共有関数`formatRunStatus()`を実装)を表示する(FR-002, FR-003)
- [ ] T012 [US1] `frontend/src/pages/HistoryPage.tsx`: `status === "succeeded"`の行のみ`<Link to={`/results/${runId}`}>`でラップし、結果ページへ遷移できるようにする。一覧が0件の場合は「まだ実行履歴がありません」等の空状態メッセージを表示する(FR-004, FR-006)
- [ ] T013 [US1] `frontend/src/pages/HistoryPage.tsx`: `listRunHistory()`の取得に失敗した場合、エラーメッセージと再試行ボタン(再度`listRunHistory()`を呼び直す)を表示する(FR-010)

**Checkpoint**: User Story 1 is fully functional and independently testable — this is the MVP。

---

## Phase 4: User Story 2 - 大量の履歴から目的の実行を絞り込む (Priority: P2)

**Goal**: 履歴ページで設定名による絞り込みと、一覧の段階的な追加読み込みができる。

**Independent Test**: 異なる設定名で複数回実行した状態で、履歴ページ上である設定名を指定して絞り込み、その設定名に該当する実行のみが表示されることを確認する(quickstart.md #4)。

### Implementation for User Story 2

- [ ] T014 [P] [US2] `frontend/src/pages/HistoryPage.tsx`: 既存の`listSettingsNames()`(`controlPlaneClient.ts`、設定ページ・実行ページで使用中)を使って登録済み設定名一覧を取得し、「絞り込みなし」を含む`<select>`を追加する。選択が変わるたびに`settingsName`を指定して`listRunHistory()`を呼び直し、一覧・オフセットをリセットする(FR-007、research.md R4)
- [ ] T015 [US2] `frontend/src/pages/HistoryPage.tsx`: `offset`/`limit`のstateを追加し、「さらに読み込む」ボタンを一覧末尾に表示する(`hasMore === true`のときのみ表示)。押下時は現在の`offset + limit`を新たな`offset`として`listRunHistory()`を呼び、結果を既存の一覧に追記する(FR-008、research.md R3)

**Checkpoint**: User Stories 1 and 2 both work independently。

---

## Phase 5: User Story 3 - 失敗した実行も履歴から把握する (Priority: P3)

**Goal**: 失敗した実行・進行中の実行についても、履歴一覧からステータスが明確にわかり、結果が存在しないことによる混乱がない。

**Independent Test**: 失敗した実行を1件発生させた後、履歴ページの一覧にその実行が「失敗」というステータス付きで表示され、選択しても結果ページへ遷移しないことを確認する(quickstart.md #5)。

### Implementation for User Story 3

- [ ] T016 [US3] `frontend/src/pages/HistoryPage.tsx`: `status`が`succeeded`以外の行は`<Link>`でラップせず、行内に短い説明("実行中"の場合「まだ結果はありません」、"失敗"の場合「この実行は失敗しました」)を表示し、選択操作をしても何も起きない/迷わないようにする(spec.md User Story 3 Acceptance Scenario 2)
- [ ] T017 [US3] `frontend/src/pages/HistoryPage.tsx`: 「失敗」ステータスの行を視覚的に区別できるスタイル(例: 警告色のバッジ)にし、長い一覧の中でも見つけやすくする(SC-004)

**Checkpoint**: All user stories should now be independently functional。

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: 全ストーリーに関わる横断的な仕上げ

- [ ] T018 Run quickstart.mdの全検証シナリオ(ローカルD1へのスキーマ変更適用、`settingsName`が実行記録に残ることの確認、履歴ページの基本動作/絞り込み/追加読み込み/失敗・実行中の扱い/設定名不明な既存実行の扱い、既存機能への非影響)を実施する。リモートD1への`ALTER TABLE`適用・`git push`・`wrangler deploy`は、実行前に必ずユーザーへ確認する(constitution 原則II)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: なし(タスクなし)
- **Foundational (Phase 2)**: T001→T002→(T003・T004→T005)という順。T006(フロントエンド型)は独立して並行着手でき、T007→T008がそれに続く。全ユーザーストーリーはこのフェーズ完了後にのみ着手できる。
- **User Story 1 (Phase 3)**: Foundational完了後に着手。他ストーリーへの依存なし。MVP。
- **User Story 2 (Phase 4)**: Foundational完了後に着手可能だが、絞り込みUI・追加読み込みUIは一覧の土台(T009-T013)の上に乗るため、実務上はUser Story 1完了後に着手する。
- **User Story 3 (Phase 5)**: 同様にUser Story 1が作る一覧UI(T011, T012)の上に乗るため、User Story 1完了後に着手する。
- **Polish (Phase 6)**: User Story 1・2・3の実装完了後。

### User Story Dependencies

- **User Story 1 (P1)**: Foundational(実行記録への設定名付与・`GET /public/run-history`)に依存。他ユーザーストーリーへの依存なし。
- **User Story 2 (P2)**: User Story 1が作る一覧UI(`HistoryPage.tsx`の基本構造)に依存。バックエンド側(設定名フィルタ・limit/offset)は既にFoundationalで実装済みのため、UI追加のみで完結する。
- **User Story 3 (P3)**: User Story 1が作る一覧UI(行のレンダリング・リンク判定ロジック)に依存。バックエンド側の変更は不要(`status`は既にFoundationalのレスポンスに含まれる)。

### Parallel Opportunities

- Foundational内: T006([P])はT001-T005(control-plane側)と並行して着手できる。
- User Story 2内: T014([P])はUser Story 1完了後、T015より先に(または並行に)着手できる(異なる関心事だが同一ファイルへの追記のため、実装順序の都合でP付きだが競合に注意)。
- User Story 1・2・3はいずれも同一ファイル(`HistoryPage.tsx`)への逐次的な追記が中心のため、[P]マークは最小限(T006, T014)に留めている。

---

## Parallel Example: Foundational着手時

```bash
# T001(schema.sql)と並行して、フロントエンドの型定義を先行着手できる:
Task: "control-plane/src/db/schema.sql に settings_name TEXT 列を追加(T001)"
Task: "frontend/src/services/controlPlaneClient.ts に settingsName・RunHistoryEntry・listRunHistory() を追加(T006)"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 2(Foundational)を実装する — 特に稼働中D1への`ALTER TABLE`適用は事前にユーザーへ確認する
2. Phase 3(User Story 1)を実装する
3. **STOP and VALIDATE**: quickstart.md #3(履歴ページの基本動作)を実施し、独立して動作することを確認する
4. デプロイ/デモ(既存のGitHub Pages/Cloudflare Workersへの再デプロイのみ、新規コンポーネントなし)

### Incremental Delivery

1. Foundational → 設定名の記録・横断取得APIが揃う
2. User Story 1 → 単独検証(quickstart.md #3) → デプロイ/デモ(MVP!)
3. User Story 2 → 単独検証(quickstart.md #4) → デプロイ/デモ
4. User Story 3 → 単独検証(quickstart.md #5) → デプロイ/デモ
5. Polish(quickstart.md全検証)

### Parallel Team Strategy

複数人で進める場合:

1. 担当A: Foundationalのcontrol-plane側(T001-T005)
2. 担当B: Foundationalのfrontend側(T006-T008、T006はT001と並行着手可能、T007以降はT006完了後)
3. Foundational完了後:
   - 担当A: User Story 1(T009-T013)
   - 担当B: User Story 1完了を待って User Story 2(T014-T015)・User Story 3(T016-T017)を分担

---

## Notes

- [P] tasks = different files, no dependency on an incomplete task in the same phase
- [Story] label maps task to specific user story for traceability
- 実行記録に設定名を保持するカラムがそもそも存在しなかった(research.md R1)という既存の欠落は、本フィーチャーのFoundationalフェーズで埋める。本フィーチャー以前に作成された実行記録は`settingsName`が`null`のまま残り、履歴ページ上は「設定名不明」として表示する(設定名フィルタの対象外)
- `GET /public/runs?targetId=`(既存、FR-016、結果ページの「同一対象の過去実行」用)は変更しない。新規`GET /public/run-history`と役割を分離している(research.md R2)
- Commit after each task or logical group
- Stop at any checkpoint to validate a story independently
- Avoid: vague tasks, same-file conflicts marked [P], cross-story dependencies that break independence
