---

description: "Task list for 対戦相手シード調整ツールの公開Web化"
---

# Tasks: 対戦相手シード調整ツールの公開Web化

**Input**: Design documents from `/specs/001-seed-adjuster-webapp/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md (all present)

**Tests**: Not explicitly requested in spec.md; no dedicated test-writing tasks are generated. `frontend/tests/`, `control-plane/tests/`, `indexer/tests/` directories are created in Setup for when tests are added.

**Organization**: Tasks are grouped by user story (spec.md priorities P1–P5) to enable independent implementation and testing of each story. Architecture: reference `plan.md`/`research.md` — heavy computation (adjustment algorithm + match-history query) runs entirely client-side in the browser (Pyodide + DuckDB-WASM); `control-plane` (Cloudflare Workers/D1) only records run state, settings, and the public results cache; `indexer` (GitHub Actions) builds the compact match-history Parquet artifact.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task in the same phase)
- **[Story]**: Which user story this task belongs to (US1–US5)
- File paths follow `plan.md` § Project Structure

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [ ] T001 Create repository directory structure (`frontend/`, `control-plane/`, `indexer/`, `.github/workflows/`) per plan.md Project Structure
- [ ] T002 [P] Initialize frontend Vite + React + TypeScript project in `frontend/` (`package.json`, `tsconfig.json`, `vite.config.ts`)
- [ ] T003 [P] Initialize control-plane Cloudflare Workers TypeScript project in `control-plane/` (`package.json`, `tsconfig.json`, `wrangler.toml` with a D1 database binding)
- [ ] T004 [P] Initialize indexer Python project in `indexer/` (`pyproject.toml` or `requirements.txt`)
- [ ] T005 [P] Configure ESLint + Prettier for `frontend/`
- [ ] T006 [P] Configure ESLint + Prettier for `control-plane/`
- [ ] T007 [P] Configure ruff/black for `indexer/`
- [ ] T008 Document Google Cloud OAuth 2.0 client registration steps (billing disabled, per research.md #0/#4) and add the client ID as a placeholder in `frontend/.env.example`
- [ ] T009 [P] Configure GitHub Pages deployment workflow in `.github/workflows/deploy-frontend.yml`
- [ ] T010 [P] Add control-plane API base URL as a build-time env var in `frontend/.env.example`

**Checkpoint**: Projects scaffolded, deployable shells exist.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [ ] T011 Define D1 schema for `AdjustmentRun` and `AdjustmentSettings` (per data-model.md) in `control-plane/src/db/schema.sql`
- [ ] T012 [P] Implement D1 access layer for `AdjustmentRun` in `control-plane/src/db/runsRepository.ts`
- [ ] T013 [P] Implement D1 access layer for `AdjustmentSettings` in `control-plane/src/db/settingsRepository.ts`
- [ ] T014 Implement `POST /runs` endpoint (creates an `AdjustmentRun`, no locking — concurrent runs for the same `targetId` are accepted; includes `sizeWarning` per FR-003a) in `control-plane/src/api/runs.ts`
- [ ] T015 Implement `GET /runs/{runId}` endpoint in `control-plane/src/api/runs.ts`
- [ ] T016 Implement `POST /runs/{runId}/complete` endpoint (stores the browser-submitted sanitized result) in `control-plane/src/api/runs.ts`
- [ ] T017 Implement `POST /runs/{runId}/fail` endpoint in `control-plane/src/api/runs.ts`
- [ ] T018 [P] Port the adjustment algorithm from `seed_adjuster.ipynb` (`calc_match_point`, `calc_breadth`, `calc_opponent_index`, tight-group detection, `get_adjusted_result`, wave-constraint helpers) to `frontend/src/engine/seed_adjuster.py`
- [ ] T019 [P] Implement lazy-loaded Pyodide bootstrap (loaded only when a run starts) in `frontend/src/engine/pyodideRuntime.ts`
- [ ] T020 [P] Implement lazy-loaded DuckDB-WASM match-index query module (reads the Parquet artifact per contracts/match-index-format.md) in `frontend/src/data/matchIndex.ts`
- [ ] T021 [P] Implement Google Identity Services token-client wrapper (browser-only OAuth, no backend exchange, per research.md #4) in `frontend/src/integrations/googleAuth.ts`
- [ ] T022 [P] Implement control-plane REST client (run lifecycle: create/status/complete/fail) in `frontend/src/services/controlPlaneClient.ts`
- [ ] T023 Implement app shell and routing (settings / run / results pages, placeholders) in `frontend/src/App.tsx` and `frontend/src/pages/`
- [ ] T024 [P] Implement a **reusable** Pyodide execution-time benchmark (synthetic match-history data, representative entrant counts e.g. 32/128/512/1024/2048, exercises T018's algorithm/T019's Pyodide runtime/T020's match-index query), runnable both locally and headlessly in Node (`pyodide` npm package, no browser required) in `frontend/scripts/benchmarkAlgorithm.ts`
- [ ] T025 Profile and optimize the ported algorithm based on T024's measured results (data-structure/query-batching improvements in `frontend/src/engine/seed_adjuster.py` and `frontend/src/data/matchIndex.ts`); re-run T024 until realistic-scale runs comfortably meet the FR-003/SC-002 60-minute budget

**⚠️ GATE**: T024/T025 must show that realistic-scale runs comfortably meet the 60-minute budget (FR-003/SC-002) before proceeding to Phase 3 (US1). If the client-side (Pyodide/DuckDB-WASM) architecture cannot meet this after optimization, escalate and revisit research.md #1 (execution location) before continuing — do not proceed on an unresolved performance risk. (2026-08-21分析: `/speckit-analyze` finding U1, resolved by adding this gate per user instruction; kept within this spec rather than split into a separate one, since it validates this feature's own core architectural decision rather than delivering independent user value.) T024 is a **permanent tool, not a one-time spike** — the algorithm will keep changing (optimizations, new constraints, indexer data growth), so this benchmark needs to be re-run again later; T059 (Polish) automates that re-verification in CI so it doesn't rely on anyone remembering to do it by hand.

**Checkpoint**: Foundation ready and performance-validated — user story implementation can now begin.

---

## Phase 3: User Story 1 - Googleスプレッドシートでのシード自動調整 (Priority: P1) 🎯 MVP

**Goal**: 運営者が自分のGoogleスプレッドシートを接続し、過去の対戦履歴に基づいてシード順を自動調整し、結果と調整理由を元のスプレッドシートで確認できる。

**Independent Test**: 自分のGoogleアカウントで初めてアクセスし、対象スプレッドシートとワークシートを指定してシード調整を実行し、元のスプレッドシートに調整結果と調整理由が新しいシートとして追記されることを確認する。

### Implementation for User Story 1

- [ ] T026 [P] [US1] Implement Google Sheets read/write client (シード表読み込み・監査ログシート追記) in `frontend/src/integrations/googleSheets.ts`
- [ ] T027 [P] [US1] Implement 実行ページ(入力元=Googleスプレッドシート選択、スプレッドシートID/ワークシート名入力フォーム)in `frontend/src/pages/RunPage.tsx`
- [ ] T028 [US1] Implement run orchestration (fetch match index via T020 → load Pyodide via T019 → read sheet via T026 → run algorithm via T018 → write result sheet via T026 → `POST /runs` + `/complete` via T022) in `frontend/src/engine/runAdjustment.ts`
- [ ] T029 [US1] Wire fixed-seed-count exclusion (FR-005) and Wave-constraint handling (FR-006) through `frontend/src/engine/runAdjustment.ts` and `frontend/src/engine/seed_adjuster.py`
- [ ] T030 [P] [US1] Implement minimal Google account connect UI (FR-001) in `frontend/src/pages/SettingsPage.tsx`
- [ ] T031 [US1] Implement permission-error handling and user-facing message for insufficient Sheets access (FR-021, Acceptance Scenario 4) in `frontend/src/integrations/googleSheets.ts`

**Checkpoint**: User Story 1 is fully functional and independently testable — this is the MVP.

---

## Phase 4: User Story 2 - 実行中の状況把握と離脱防止の案内 (Priority: P2)

**Goal**: 運営者が実行中の状況(実行中/完了/失敗)を確認でき、誤ってページを離れようとすると警告を受け取る。同一対象への複数実行はブロックしない。

**Independent Test**: シード調整を実行し、実行中に状況を確認できること、離脱防止の案内が表示されることを確認する。

### Implementation for User Story 2

- [ ] T032 [P] [US2] Implement run-status display (`queued`/`running`/`succeeded`/`failed`, polling `GET /runs/{runId}` via T022) in `frontend/src/pages/RunStatusPage.tsx`
- [ ] T033 [US2] Implement `beforeunload` leave-warning while a run is in-flight (FR-013) in `frontend/src/engine/runAdjustment.ts`
- [ ] T034 [US2] Implement `failureHint` display on failure in `frontend/src/pages/RunStatusPage.tsx`
- [ ] T035 [P] [US2] Confirm `POST /runs` accepts concurrent runs for the same `targetId` without blocking (spec.md Clarifications 方針変更) — add a regression note/assertion in `control-plane/src/api/runs.ts`

**Checkpoint**: User Stories 1 AND 2 both work independently.

---

## Phase 5: User Story 3 - 調整結果を振り返りやすい結果表示ページ (Priority: P3)

**Goal**: 認証なしで誰でも、調整前後のシード比較・配置理由・過去の実行履歴を人が読みやすい形式で閲覧できる。

**Independent Test**: 完了済みの調整結果に対し、認証していないブラウザから結果表示ページにアクセスし、生データを介さず比較・理由が表示されること、過去の実行一覧から選び直せることを確認する。

### Implementation for User Story 3

- [ ] T036 [P] [US3] Implement `GET /public/results/{runId}` endpoint (returns the copy submitted in T016) in `control-plane/src/api/public.ts`
- [ ] T037 [US3] Implement `GET /public/runs?targetId=` endpoint (same file as T036) in `control-plane/src/api/public.ts`
- [ ] T038 [P] [US3] Implement 結果表示ページ(調整前後のシード比較、配置理由。Pyodide/DuckDB-WASMは読み込まない)in `frontend/src/pages/ResultsPage.tsx`
- [ ] T039 [US3] Implement Wave制約違反一覧の強調表示(同ファイル)in `frontend/src/pages/ResultsPage.tsx`
- [ ] T040 [US3] Implement 過去の実行一覧セレクター(`GET /public/runs`を利用、同ファイル)in `frontend/src/pages/ResultsPage.tsx`

**Checkpoint**: User Stories 1, 2, and 3 all work independently.

---

## Phase 6: User Story 4 - Startggから直接読み込み・書き戻し (Priority: P4)

**Goal**: Googleスプレッドシートを使わない運営者が、start.ggから直接シードを読み込み、確認・承認の上でstart.ggへ調整結果を書き戻せる。

**Independent Test**: Startggを入力元として選択し、対象イベント/フェーズを指定してシード調整を実行し、確認画面で承認した上でstart.gg側のシード設定が更新されることを確認する。

### Implementation for User Story 4

- [ ] T041 [P] [US4] Implement start.gg個人アクセストークン入力欄(IndexedDB保存のみ、サーバー送信なし。research.md #5)in `frontend/src/pages/SettingsPage.tsx`
- [ ] T042 [P] [US4] Implement start.gg GraphQLクライアント(ブラウザから直接呼び出し。CORS未対応時は`POST /relay/startgg`にフォールバック。research.md #6)in `frontend/src/integrations/startgg.ts`
- [ ] T043 [P] [US4] Implement `POST /relay/startgg` CORSリレー(条件付き、資格情報・リクエスト内容は一切ログしない)in `control-plane/src/api/relay.ts`
- [ ] T044 [US4] Implement Startgg入力元選択・イベント/フェーズ指定UI(同ファイル、T027で作成済み)in `frontend/src/pages/RunPage.tsx`
- [ ] T045 [US4] Implement `PreAdjustmentSeedSnapshot`生成(個人情報を含めない、FR-012c)in `frontend/src/integrations/startgg.ts`
- [ ] T046 [US4] Implement 監査ログ用スプレッドシート未接続ゲート(FR-012a、`POST /runs`の428応答を処理)in `frontend/src/engine/runAdjustment.ts`
- [ ] T047 [P] [US4] Implement 書き戻し確認画面(反映前に調整後の並び順・理由を表示)in `frontend/src/pages/WritebackConfirmPage.tsx`
- [ ] T048 [US4] Implement 書き戻し実行・権限チェック・完了報告(`POST /runs/{runId}/writeback-recorded`呼び出し)in `frontend/src/integrations/startgg.ts`
- [ ] T049 [US4] Implement `POST /runs/{runId}/writeback-recorded` endpoint in `control-plane/src/api/runs.ts`

**Checkpoint**: User Stories 1–4 all work independently.

---

## Phase 7: User Story 5 - 設定ページでの認証とパラメータの簡易設定 (Priority: P5)

**Goal**: 環境変数を直接編集することなく、Yes/No質問で推奨既定値が自動設定され、必要な場合は個別に上書きできる。

**Independent Test**: 初めて設定ページにアクセスし、Googleアカウント連携を完了させた上でYes/No質問にすべて回答し、妥当な既定値一式が設定されることを確認する。

### Implementation for User Story 5

- [ ] T050 [P] [US5] Implement `GET /settings/{targetId}` / `PUT /settings/{targetId}` endpoints in `control-plane/src/api/settings.ts`
- [ ] T051 [US5] Implement Yes/No質問ウィザードUI(FR-018)in `frontend/src/pages/SettingsPage.tsx`
- [ ] T052 [P] [US5] Implement `resolvedDefaults`導出ロジック(wizardAnswers → 推奨既定値)in `frontend/src/engine/settingsDefaults.ts`
- [ ] T053 [US5] Implement 個別パラメータ上書き入力(FR-019、`effectiveValue`優先順位)in `frontend/src/pages/SettingsPage.tsx`
- [ ] T054 [US5] Wire `settingsSnapshot`(`AdjustmentSettings.effectiveValue`)を`frontend/src/engine/runAdjustment.ts`に接続し、US1で使っていた既定値をこの設定サービス由来の値に置き換える

**Checkpoint**: All user stories are independently functional.

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: 全ストーリーに関わる横断的な仕上げ

- [ ] T055 [P] Implement smash_database増分走査+Parquet生成(選手ペア単位、参照期間の上限あり。research.md #2)in `indexer/src/build_index.py`
- [ ] T056 [P] Implement GitHub Actions定期実行ワークフロー(indexerを実行しGitHub Releasesへ公開)in `.github/workflows/indexer.yml`
- [ ] T057 [P] Implement 事前見積もり・`sizeWarning`計算(FR-003a、参加者数と処理時間の関係)in `frontend/src/engine/runEstimate.ts`
- [ ] T058 [P] トークン非送出の監査(Cloudflare Workers/GitHub Actionsのログ・APIレスポンスにGoogle/start.ggトークンが一切含まれないことを確認、research.md #4・#5)across `control-plane/src/`, `frontend/src/`
- [ ] T059 [P] Wire T024's benchmark into a GitHub Actions workflow (`.github/workflows/benchmark.yml`, public repo → free per research.md #0) that runs on every change to `frontend/src/engine/` or `frontend/src/data/` and fails the build if execution time regresses past the FR-003/SC-002 budget — so future algorithm changes are re-verified automatically instead of relying on someone remembering to re-run T024 manually
- [ ] T060 Run quickstart.md の全検証シナリオ(US1〜US5・非機能要件)を実施
- [ ] T061 [P] README作成(frontend/control-plane/indexerのデプロイ手順)in `README.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion — BLOCKS all user stories
- **User Stories (Phase 3–7)**: All depend on Foundational phase completion
  - Can proceed in priority order (P1 → P2 → P3 → P4 → P5) for a single implementer, or in parallel per story for a team
- **Polish (Phase 8)**: Depends on the user stories being implemented that it touches (indexer tasks T055/T056 have no story dependency and can start anytime after Setup; T059's CI wiring only depends on T024 (Foundational) and can also start anytime; T057/T058/T060 depend on US1–US4 being functional)

### User Story Dependencies

- **User Story 1 (P1)**: No dependency on other stories. MVP.
- **User Story 2 (P2)**: Builds on US1's run orchestration (`runAdjustment.ts`) but is independently testable once US1 exists.
- **User Story 3 (P3)**: Depends on `POST /runs/{runId}/complete` (Foundational) having data to display; independently testable once at least one run has completed via US1.
- **User Story 4 (P4)**: Depends on the core engine (US1) and status/results plumbing (US2/US3) per spec.md's stated priority rationale; reuses `frontend/src/integrations/googleSheets.ts` from US1 for the audit log.
- **User Story 5 (P5)**: Independently testable for its own wizard UI; T054 wires it into the shared `runAdjustment.ts` so its output benefits all other stories retroactively.

### Parallel Opportunities

- All Setup tasks marked [P] can run in parallel once T001 completes.
- Foundational tasks T012/T013 (different DB repositories), T018–T022 (different files) can run in parallel after T011.
- Once Foundational completes, US1 and the indexer tasks (T055/T056) can start in parallel with no interdependency.
- Within each user story, tasks marked [P] touch different files and can run in parallel; unmarked tasks either share a file with a preceding task in the same story or depend on one.

---

## Parallel Example: User Story 1

```bash
# Launch in parallel once Phase 2 (Foundational) is complete:
Task: "Implement Google Sheets read/write client in frontend/src/integrations/googleSheets.ts"
Task: "Implement 実行ページ(入力元=Googleスプレッドシート) in frontend/src/pages/RunPage.tsx"
Task: "Implement minimal Google account connect UI in frontend/src/pages/SettingsPage.tsx"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL — blocks all stories)
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: quickstart.md シナリオ1を実施し、独立して動作することを確認
5. Deploy/demo if ready (frontendはGitHub Pages、control-planeはCloudflare Workersへ)

### Incremental Delivery

1. Setup + Foundational → 基盤完成
2. US1 追加 → 単独検証 → デプロイ/デモ(MVP!)
3. US2 追加 → 単独検証 → デプロイ/デモ
4. US3 追加 → 単独検証 → デプロイ/デモ
5. US4 追加 → 単独検証 → デプロイ/デモ
6. US5 追加 → 単独検証 → デプロイ/デモ
7. Polish(indexer本番稼働・見積もり精度・トークン漏洩監査・ベンチマークのCI自動化・quickstart全検証)

### Parallel Team Strategy

複数人で進める場合:

1. チーム全体でSetup + Foundationalを完了
2. Foundational完了後:
   - 担当A: User Story 1(コアエンジン)
   - 担当B: indexer(smash_database集約、Foundational完了後すぐ着手可能、他ストーリーと独立)
   - 担当C: User Story 3(公開結果ページ、US1完了後にデータが出始め次第並行着手可能)
3. US1完了後、User Story 2・4・5は順次または並行して着手

---

## Notes

- [P] tasks = different files, no dependency on an incomplete task in the same phase
- [Story] label maps task to specific user story for traceability
- 重い計算(調整アルゴリズム・対戦履歴クエリ)はすべてブラウザ内(Pyodide/DuckDB-WASM)で完結する。`control-plane`は状態記録・設定・公開結果キャッシュのみを扱う薄い層(research.md #0〜#3)
- 同一対象への多重実行はブロックしない(spec.md Clarifications 方針変更、2026-08-21)
- Startgg CORSリレー(T043)は実装着手前にstart.gg APIのCORS対応状況を検証し、不要と判明すれば省略してよい(research.md #6)
- アルゴリズムの実行速度検証(T024)は一度きりのスパイクではなく、継続的に再検証が必要な性質のもの。T059でCIに組み込み、以後の変更のたびに自動で再確認する(2026-08-21の指摘を反映)
- Commit after each task or logical group
- Stop at any checkpoint to validate a story independently
- Avoid: vague tasks, same-file conflicts marked [P], cross-story dependencies that break independence
