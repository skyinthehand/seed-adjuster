"""Builds the compact match-history Parquet index from a local clone of smash_database
(research.md #2).

Design note (data source, 2026-09-14, replaces the original per-event HTTP fetching):
this originally fetched each event's matches.json/attr.json individually over HTTP
(raw.githubusercontent.com) under 16-way concurrency with a 30s per-request timeout, with
failures silently skipped (non-fatal, by design — so one flaky request wouldn't abort the
whole run). In practice this meant large events (multi-MB matches.json, 500+ entrants) would
occasionally time out under that concurrent load, and — because the failure was silent — an
entire tournament's matches could vanish from the published index with no visible error,
until some future run happened to succeed in fetching it. Confirmed in production: a 545-
entrant tournament (2176 matches) was completely absent from a published index despite being
fully fetchable moments later in isolation.

Fixed by having indexer.yml `git clone` smash_database's `main` branch (shallow, one bulk
operation, ~2.3GB working tree, ~30s) onto the runner before invoking this script, and reading
tournaments.jsonl/matches.json/attr.json as local files instead of over HTTP. This eliminates
per-file network flakiness entirely: a `git clone` is atomic (fails as a whole or succeeds
completely), so once it succeeds, every file that exists in smash_database is genuinely on
disk — a local file read either finds it or it was never actually there (a real upstream data
gap, e.g. an event whose collection is still in progress — see smash_database's
awaiting_resume.json — not a fetch-reliability issue). Missing/malformed *files* are still
skipped, non-fatal, matching that distinction; but there is no longer a "resource that exists
but we failed to retrieve it" failure mode at all.

Design note (deviation from the original "incremental" framing in research.md #2 /
tasks.md T055): the empirical size investigation in research.md #2 found that even a
*full* rebuild of the compact pair-index (all ~1.45M matches, all regions, all history)
comes out to only ~8-14MB compressed. Given that, a full rebuild on every run is simpler
and more robust than maintaining incremental merge state, at negligible extra cost. This
script re-scans smash_database's tournament list on every invocation; if smash_database's
volume grows by an order of magnitude in the future, revisit this and add incremental
state tracking as originally sketched.

Usage: python -m src.build_index --out-dir dist/ --smash-database-dir ../smash_database
Produces dist/match-index.parquet, dist/manifest.json, and dist/tournaments.json
(contracts/match-index-format.md, contracts/tournament-directory.md).
"""

from __future__ import annotations

import argparse
import concurrent.futures
import json
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq

FORMAT_VERSION = 1
# Matches older than this contribute ~0 to match_point (4^-x decay per year, research.md
# Assumptions) — excluding them keeps the index small without materially changing results.
COVERAGE_YEARS = 5
MAX_WORKERS = 16


@dataclass
class MatchRow:
    user_id_a: int
    user_id_b: int
    timestamp: int
    num_entrants: int
    tournament_id: int


def read_tournaments_jsonl(smash_db_dir: Path) -> list[dict]:
    path = smash_db_dir / "data" / "startgg" / "tournaments.jsonl"
    tournaments = []
    with path.open(encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                tournaments.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return tournaments


def collect_event_paths(tournaments: list[dict]) -> list[tuple[int, str]]:
    """Returns (tournament_id, event_path) pairs — tournament_id is needed on each MatchRow
    (002-result-decision-detail, contracts/tournament-directory.md) so it must survive this
    flattening step rather than being dropped."""
    paths = []
    for tournament in tournaments:
        tournament_id = tournament.get("tournament_id")
        if tournament_id is None:
            continue
        for event in tournament.get("events", []):
            path = event.get("path")
            if path:
                paths.append((int(tournament_id), path))
    return paths


def build_tournament_directory(tournaments: list[dict]) -> dict[int, str]:
    """{tournament_id: name} for every tournament in tournaments.jsonl (already read, no
    extra fetch needed — research.md R1). Callers should filter this down to only the
    tournaments actually referenced by the emitted rows (research.md R4)."""
    directory: dict[int, str] = {}
    for tournament in tournaments:
        tournament_id = tournament.get("tournament_id")
        name = tournament.get("name")
        if tournament_id is not None and name is not None:
            directory[int(tournament_id)] = name
    return directory


def read_event_matches(
    smash_db_dir: Path, tournament_id: int, event_path: str
) -> tuple[list[MatchRow], bool]:
    """Returns (rows, ok). ok=False only for a genuine upstream data gap (missing/malformed
    file, or attr.json missing timestamp/num_entrants — e.g. an event still being collected,
    see smash_database's awaiting_resume.json) — never for a transient fetch problem, since
    this reads from the already-fully-cloned local checkout (see module docstring)."""
    event_dir = smash_db_dir / event_path
    try:
        matches_data = json.loads((event_dir / "matches.json").read_text(encoding="utf-8"))
        attr_data = json.loads((event_dir / "attr.json").read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return [], False

    timestamp = attr_data.get("timestamp")
    num_entrants = attr_data.get("num_entrants")
    if timestamp is None or num_entrants is None:
        return [], False

    rows: list[MatchRow] = []
    for m in matches_data.get("data", []):
        if not isinstance(m, dict):
            continue
        winner_id = m.get("winner_id")
        loser_id = m.get("loser_id")
        if winner_id is None or loser_id is None:
            continue
        a, b = min(winner_id, loser_id), max(winner_id, loser_id)
        rows.append(MatchRow(a, b, int(timestamp), int(num_entrants), tournament_id))
    return rows, True


def build_index(
    smash_db_dir: Path, coverage_years: int = COVERAGE_YEARS, max_workers: int = MAX_WORKERS
) -> tuple[list[MatchRow], dict, dict[int, str]]:
    print(f"Reading tournaments.jsonl from {smash_db_dir}...", file=sys.stderr)
    tournaments = read_tournaments_jsonl(smash_db_dir)
    tournament_directory_full = build_tournament_directory(tournaments)
    event_paths = collect_event_paths(tournaments)
    print(f"{len(event_paths)} events found; reading matches...", file=sys.stderr)

    cutoff = datetime.now(timezone.utc) - timedelta(days=365 * coverage_years)
    cutoff_ts = int(cutoff.timestamp())

    all_rows: list[MatchRow] = []
    failures = 0
    start = time.monotonic()

    with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {
            executor.submit(read_event_matches, smash_db_dir, tournament_id, p): p
            for tournament_id, p in event_paths
        }
        for i, future in enumerate(concurrent.futures.as_completed(futures), start=1):
            rows, ok = future.result()
            if not ok:
                failures += 1
            all_rows.extend(r for r in rows if r.timestamp >= cutoff_ts)
            if i % 1000 == 0:
                print(f"  {i}/{len(event_paths)} events processed...", file=sys.stderr)

    elapsed = time.monotonic() - start
    print(
        f"Done in {elapsed:.1f}s: {len(all_rows)} matches from {len(event_paths) - failures}/"
        f"{len(event_paths)} events ({failures} genuinely missing/incomplete upstream, not a "
        f"fetch failure — see module docstring).",
        file=sys.stderr,
    )

    # Only the tournaments actually referenced by surviving (post-cutoff) rows are worth
    # publishing a name for — keeps tournaments.json small (research.md R4).
    used_tournament_ids = {r.tournament_id for r in all_rows}
    tournament_directory = {
        tid: name for tid, name in tournament_directory_full.items() if tid in used_tournament_ids
    }

    manifest = {
        "formatVersion": FORMAT_VERSION,
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "coveragePeriod": {
            "from": cutoff.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "to": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        },
    }
    return all_rows, manifest, tournament_directory


def write_parquet(rows: list[MatchRow], out_path: Path) -> None:
    table = pa.table(
        {
            "userIdA": pa.array([r.user_id_a for r in rows], type=pa.int64()),
            "userIdB": pa.array([r.user_id_b for r in rows], type=pa.int64()),
            "timestamp": pa.array([r.timestamp for r in rows], type=pa.int64()),
            "numEntrants": pa.array([r.num_entrants for r in rows], type=pa.int32()),
            "tournamentId": pa.array([r.tournament_id for r in rows], type=pa.int64()),
        }
    )
    # Sorting by (userIdA, userIdB) improves dictionary/delta compression (research.md #2).
    table = table.sort_by([("userIdA", "ascending"), ("userIdB", "ascending")])
    pq.write_table(table, out_path, compression="zstd")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out-dir", type=Path, default=Path("dist"))
    parser.add_argument(
        "--smash-database-dir",
        type=Path,
        required=True,
        help="Path to a local clone of smash_database (main branch) — see indexer.yml.",
    )
    parser.add_argument("--coverage-years", type=int, default=COVERAGE_YEARS)
    args = parser.parse_args()

    args.out_dir.mkdir(parents=True, exist_ok=True)
    rows, manifest, tournament_directory = build_index(
        args.smash_database_dir, coverage_years=args.coverage_years
    )

    parquet_path = args.out_dir / "match-index.parquet"
    write_parquet(rows, parquet_path)

    manifest["parquetUrl"] = "REPLACE_WITH_PARQUET_URL"  # filled in by the publishing workflow step
    (args.out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False))

    # tournaments.json: tournamentId -> name (002-result-decision-detail, contracts/tournament-directory.md).
    # JSON object keys must be strings, so tournament_directory's int keys are stringified here.
    tournaments_json_path = args.out_dir / "tournaments.json"
    tournaments_payload = {
        "formatVersion": 1,
        "tournaments": {str(tid): name for tid, name in tournament_directory.items()},
    }
    tournaments_json_path.write_text(json.dumps(tournaments_payload, indent=2, ensure_ascii=False))

    print(
        f"Wrote {parquet_path} ({parquet_path.stat().st_size / 1e6:.2f} MB), manifest.json, and "
        f"{tournaments_json_path} ({tournaments_json_path.stat().st_size / 1e6:.2f} MB, "
        f"{len(tournament_directory)} tournaments)",
        file=sys.stderr,
    )


if __name__ == "__main__":
    main()
