<!--
Sync Impact Report
- Version change: 1.0.0 → 1.1.0
- Modified principles: (none)
- Added principles:
  - II. デプロイ操作の事前確認 (confirm before commit/push/deploy)
- Removed sections: (none this amendment)
- Follow-up TODOs: none
-->

# 対戦相手シード調整ツール Constitution

## Core Principles

### I. 日本語での運用

このプロジェクトに関するClaudeとのやり取りは、明確な指示がない限り必ず日本語で行わなければ
ならない(MUST)。プロジェクトの各種ドキュメント(`spec.md`、`plan.md`、`tasks.md`、
`README.md`等)およびgitのコミットメッセージも同様に日本語で記述する。

**Rationale**: プロジェクト所有者は日本語話者であり、既存のspec/plan/tasksドキュメント一式も
すべて日本語で書かれている。これは既存の運用実態を明文化したものであり、Spec Kitの各コマンド
(`/speckit-specify`、`/speckit-plan`等)が新しい文書を生成・更新する際にも、言語を統一する
拠り所として機能する。

### II. デプロイ操作の事前確認

`git commit`、`git push`、Cloudflare Workersへのデプロイ(`wrangler deploy`)、GitHub Actions
ワークフローの手動再実行など、リモート/共有状態やユーザー向け環境に影響する操作は、実行前に
必ずユーザーへ確認し、明示的な許可を得てから実行しなければならない(MUST)。ユーザーがその場で
明示的に指示した操作は、その指示の範囲でのみ実行してよい。ただし、その指示は今回限りの許可
であり、以後の同種の操作について毎回の確認が不要になったことを意味しない(MUST NOT assume
standing permission)。

**Rationale**: これらの操作は取り消しが困難、または他者・本番環境に影響しうる(リモート
リポジトリへの反映、公開中のWorkers/Pagesの更新)。実行前の確認を徹底することで、意図しない
デプロイや、ユーザーが把握していない変更の公開を防ぐ。

## Governance

この憲章はプロジェクトのすべての実践に優先する。改正には、変更内容をこのファイルへ反映し、
上記のSync Impact Reportを更新することが必要。原則の追加・実質的な拡張はMINORバージョンを、
既存原則の後方互換性のない削除・再定義はMAJORバージョンを、文言修正等の非本質的な変更は
PATCHバージョンを、それぞれ増加させる。

**Version**: 1.1.0 | **Ratified**: 2026-09-14 | **Last Amended**: 2026-09-14
