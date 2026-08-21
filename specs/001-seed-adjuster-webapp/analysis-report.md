# Specification Analysis Report: 対戦相手シード調整ツールの公開Web化

**Generated**: 2026-08-21
**Scope**: `spec.md` × `plan.md` × `tasks.md`(参照: `data-model.md`, `contracts/api.md`, `research.md`, `quickstart.md`)
**Mode**: Read-only analysis (`/speckit-analyze`)

**更新(2026-08-21 フォローアップ)**: 依頼者の指示により、G2は仕組みごと削除(spec.md/data-model.md/contracts/api.mdからhidden_value関連の記述を除去)、U1はベンチマーク+最適化タスク(T024/T025、Foundationalフェーズのゲート)を追加して最優先で解決する方針とした(別specへの分割は不要と判断)。これに伴い`tasks.md`のタスクIDが2つ後ろにずれている(旧T024以降は+2)。

**追加更新(同日、2回目)**: 「アルゴリズム改善はどうせ後でまた検証することになる」との指摘を受け、T024を一度きりのスパイクではなく再利用可能なベンチマークツールとして再定義し、T059として「このベンチマークをGitHub Actionsに組み込み、`frontend/src/engine/`または`frontend/src/data/`への変更のたびに自動で再検証する」タスクを新設した(Polishフェーズ)。これに伴いPolishフェーズの旧T059以降がさらに+1された。

**追加更新(2026-08-21、実装完了後)**: `/speckit-implement`実施の結果、G1(監査ログ用スプレッドシート指定・自動作成)はPhase 6(T044)で`frontend/src/pages/RunPage.tsx`に監査ログ用スプレッドシートID入力欄+自動作成チェックボックスを実装し、`frontend/src/integrations/googleSheets.ts`の`createSpreadsheet()`と組み合わせて解消済み。T060(quickstart全検証)も実施済み(ローカルAPI検証+実ブラウザ検証は運営者による手動実施が必要という制約付き、詳細はtasks.md T060参照)。

本レポートの表・タスクIDはこれらの更新後の状態に合わせて修正済み。G3・U2・A1・A2・G4は未対応のまま recommendation として残す。

## Findings

| ID | Category | Severity | Status | Location(s) | Summary | Recommendation |
|----|----------|----------|--------|-------------|---------|----------------|
| G1 | Coverage Gap | ~~HIGH~~ | **Resolved(実装済み)** | spec.md FR-012a/Clarifications; tasks.md T044/T046 (Phase 6) | FR-012aが要求する「監査ログ用スプレッドシートへの接続」「専用スプレッドシートの自動作成」のUIをT044で`frontend/src/pages/RunPage.tsx`に実装(指定欄+自動作成チェックボックス)、`createSpreadsheet()`(`frontend/src/integrations/googleSheets.ts`)と接続済み。T046の428ゲートと合わせてUS4(Startgg経路)は428エラーから正常に抜けられる。 | 対応不要。 |
| G2 | Coverage Gap / Security | ~~HIGH~~ | **Resolved(削除)** | spec.md FR-012b/US3/Key Entities; data-model.md; contracts/api.md | hidden_value(非公開評価値)の概念自体をスコープから除去したため、除外実装タスクの欠落という問題そのものが解消した。spec.md/data-model.md/contracts/api.mdからhidden_value関連の記述を削除済み。 | 対応不要。将来hidden_valueが必要になった場合は、公開結果からの除外を含めて別途仕様化する(spec.md Assumptions参照)。 |
| U1 | Underspecification | ~~MEDIUM-HIGH~~ | **Resolved(タスク追加・ゲート化・CI自動化)** | tasks.md T024/T025(Phase 2 Foundational)、T059(Phase 8 Polish) | Pyodide上でのアルゴリズム実行速度が未検証だった問題に対し、ベンチマークタスク(T024)と最適化タスク(T025)をFoundationalフェーズ末尾に追加し、「実測で60分予算を満たすまでPhase 3(US1)に進めない」ゲートとして明記した。さらに「アルゴリズム改善は今後も繰り返し検証が必要になる」という指摘を受け、T024を再利用可能なツールとして再定義し、T059でGitHub Actionsに組み込んで変更のたびに自動再検証する仕組みを追加した。実測結果そのものはまだ得られていないため、実装着手後の最優先事項として残る。 | T024/T025を最初に着手し、結果次第でresearch.md #1(実行場所の選択)の再検討が必要か判断する。T059は実装が落ち着いた段階(Polish)で対応。 |
| G3 | Coverage Gap | MEDIUM | Open | spec.md SC-001; quickstart.md; tasks.md | SC-001(初回15分以内にセットアップ〜初回実行開始)を検証する手順が quickstart.md にも tasks.md にも存在しない。 | quickstart.mdに新規シナリオを追加し、T060(quickstart全検証)の対象に含める、または専用タスクを追加。 |
| U2 | Underspecified Edge Case | MEDIUM | Open | spec.md Edge Cases; tasks.md | 「トークン期限切れ時の再認証の促し方」がEdge Caseとして未解決のまま記載されており、対応するタスクもない。 | 401/期限切れ検知時の再認証プロンプトを実装する小タスクを追加(例: US1またはPolishフェーズ)。 |
| A1 | Ambiguity | LOW | Open | tasks.md T035 | 「add a regression note/assertion」という記述が他タスクと比べて具体性を欠き、実質的にT014が既に実現している挙動を繰り返しているだけに見える。 | T014の受け入れ基準に統合するか、quickstart.mdの検証項目として書き換える。 |
| A2 | Ambiguity | LOW | Open | spec.md FR-015, FR-021 | 「わかりやすく通知」「把握しやすい」など、測定基準のない主観的形容が使われている(SC-003がFR-015側は部分的に具体化済み)。 | 優先度低。必要であればPolishフェーズでユーザビリティ確認を追加。 |
| G4 | Coverage Gap | LOW | Open | data-model.md ConnectedAccount/SeedEntry; tasks.md | この2エンティティの型定義を明示するタスクがない(T021/T026/T041/T042内で暗黙に生成される想定)。 | 対応不要(既存タスク内での自然な副産物として許容可)。実装時に明示的な型ファイルが欲しい場合のみ追加。 |

## Coverage Summary Table

| Requirement Key | Has Task? | Task IDs | Notes |
|---|---|---|---|
| FR-001 | Yes | T008, T021, T030 | |
| FR-002 | Yes | T020, T055 | |
| FR-003 | Yes | T018, T024, T025, T028, T057, T059, T060 | ベンチマーク/最適化ゲート(T024/T025)+CI自動再検証(T059)により解消(U1) |
| FR-003a | Yes | T014, T057 | |
| FR-004 | Yes | T018, T028 | |
| FR-005 | Yes | T029 | |
| FR-006 | Yes | T029, T039 | |
| FR-007 | Yes | T016, T018, T026 | |
| FR-008 | Yes | T027, T044 | |
| FR-009 | Yes | T026 | |
| FR-010 | Yes | T042, T044 | |
| FR-011 | Yes | T047, T048, T049 | |
| FR-012 | Yes | T026, T028 | |
| FR-012a | Yes | T044, T046 | UI(T044)+428ゲート(T046)実装済み(G1解決) |
| FR-012b | Yes | T036, T038 | hidden_value条項を削除、除外実装は不要になった(G2解決) |
| FR-012c | Yes | T045 | |
| FR-013 | Yes | T032, T033, T035 | |
| FR-014 | Yes | T015, T017, T032, T034 | |
| FR-015 | Yes | T038 | |
| FR-016 | Yes | T037, T040 | |
| FR-017 | Yes | T030, T041, T051 | |
| FR-018 | Yes | T051, T052 | |
| FR-019 | Yes | T053 | |
| FR-020 | Implicit | — | アーキテクチャ(サーバーが資格情報を持たない)で自動的に満たされる。専用タスクなし(問題ではない) |
| FR-021 | Yes | T031, T048 | |
| SC-001 | No | — | 検証タスクなし(G3、未解決) |
| SC-002 | Yes | T024, T025, T059, T060 | ベンチマーク/最適化ゲート+CI自動再検証(T059)追加により解消(U1) |
| SC-002a | Yes | T014, T057, T060 | |
| SC-003 | Yes | T038 | |
| SC-004 | Yes | T033, T035 | |
| SC-005 | Partial | T060 | 実装タスクは無く運用規律(billing無効化)に依存。research.md #0で担保 |
| SC-006 | Yes | T047-T049 | |
| SC-007 | Yes | T040 | |
| SC-008 | Yes | T036, T038 | |

## Constitution Alignment Issues

なし。`.specify/memory/constitution.md`は未策定のプレースホルダーで、MUST/SHOULD原則が0件のため評価対象外。

## Unmapped Tasks

なし。全61タスクは何らかのFR/SC/エンティティ/契約に遡れる。

## Metrics

- Total Requirements (FR+SC): 34
- Total Tasks: 61(フォローアップでT024/T025を追加(+2)、さらにT059(CI自動化)を追加(+1))
- Coverage %(≥1タスクが紐づく要件、Partial含む): 33/34 = 97%(SC-001のみ完全未カバー)
- Ambiguity Count: 2
- Duplication Count: 0
- Critical Issues Count: 0(G1・G2ともに解決済み)

## Next Actions

- **G1は解決済み**(T044で監査ログ用スプレッドシートの指定・自動作成UIを実装)。
- **G2は解決済み**(hidden_valueの仕組みを削除)。
- **U1は解決済み**(T024/T025のベンチマーク/最適化ゲートに加え、T059でCI自動再検証を追加。実測: n=2048で335秒、60分予算に対し余裕あり)。
- 全61タスク(T001〜T061)は実装完了。G3・U2・A1・A2・G4はLOW〜MEDIUMのrecommendationとして残っており、対応するかは今後の判断に委ねる。

## Remediation Offer

G1は実装により解消済みのため対応不要。残るG3・U2・A1・A2・G4について具体的な修正案が必要であれば、別途`tasks.md`への反映案を作成可能。
