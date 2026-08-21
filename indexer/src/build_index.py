"""Builds the compact match-history Parquet index from smash_database (research.md #2).

Design note (deviation from the original "incremental" framing in research.md #2 /
tasks.md T055): the empirical size investigation in research.md #2 found that even a
*full* rebuild of the compact pair-index (all ~1.45M matches, all regions, all history)
comes out to only ~8-14MB compressed. Given that, a full rebuild on every run is simpler
and more robust than maintaining incremental merge state, at negligible extra cost. This
script re-scans smash_database's tournament list on every invocation; if smash_database's
volume grows by an order of magnitude in the future, revisit this and add incremental
state tracking as originally sketched.

Usage: python -m src.build_index --out-dir dist/
Produces dist/match-index.parquet and dist/manifest.json (contracts/match-index-format.md).
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
from urllib.parse import quote

import pyarrow as pa
import pyarrow.parquet as pq
import requests

REPO = "tosakazu/smash_database"
RAW_BASE = f"https://raw.githubusercontent.com/{REPO}/main"
TOURNAMENTS_JSONL_URL = f"{RAW_BASE}/data/startgg/tournaments.jsonl"

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


def fetch_tournaments_jsonl(session: requests.Session) -> list[dict]:
    resp = session.get(TOURNAMENTS_JSONL_URL, timeout=30)
    resp.raise_for_status()
    tournaments = []
    for line in resp.text.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            tournaments.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return tournaments


def collect_event_paths(tournaments: list[dict]) -> list[str]:
    paths = []
    for tournament in tournaments:
        for event in tournament.get("events", []):
            path = event.get("path")
            if path:
                paths.append(path)
    return paths


def fetch_event_matches(session: requests.Session, event_path: str) -> tuple[list[MatchRow], bool]:
    """Returns (rows, ok). ok=False on any fetch/parse failure (skipped, not fatal)."""
    encoded_path = quote(event_path, safe="/")
    matches_url = f"{RAW_BASE}/{encoded_path}/matches.json"
    attr_url = f"{RAW_BASE}/{encoded_path}/attr.json"

    try:
        matches_resp = session.get(matches_url, timeout=30)
        attr_resp = session.get(attr_url, timeout=30)
        if matches_resp.status_code != 200 or attr_resp.status_code != 200:
            return [], False
        matches_data = matches_resp.json()
        attr_data = attr_resp.json()
    except (requests.RequestException, json.JSONDecodeError):
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
        rows.append(MatchRow(a, b, int(timestamp), int(num_entrants)))
    return rows, True


def build_index(coverage_years: int = COVERAGE_YEARS, max_workers: int = MAX_WORKERS) -> tuple[list[MatchRow], dict]:
    session = requests.Session()
    print("Fetching tournaments.jsonl...", file=sys.stderr)
    tournaments = fetch_tournaments_jsonl(session)
    event_paths = collect_event_paths(tournaments)
    print(f"{len(event_paths)} events found; fetching matches...", file=sys.stderr)

    cutoff = datetime.now(timezone.utc) - timedelta(days=365 * coverage_years)
    cutoff_ts = int(cutoff.timestamp())

    all_rows: list[MatchRow] = []
    failures = 0
    start = time.monotonic()

    with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {executor.submit(fetch_event_matches, session, p): p for p in event_paths}
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
        f"{len(event_paths)} events (failures skipped, not fatal).",
        file=sys.stderr,
    )

    manifest = {
        "formatVersion": FORMAT_VERSION,
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "coveragePeriod": {
            "from": cutoff.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "to": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        },
    }
    return all_rows, manifest


def write_parquet(rows: list[MatchRow], out_path: Path) -> None:
    table = pa.table(
        {
            "userIdA": pa.array([r.user_id_a for r in rows], type=pa.int64()),
            "userIdB": pa.array([r.user_id_b for r in rows], type=pa.int64()),
            "timestamp": pa.array([r.timestamp for r in rows], type=pa.int64()),
            "numEntrants": pa.array([r.num_entrants for r in rows], type=pa.int32()),
        }
    )
    # Sorting by (userIdA, userIdB) improves dictionary/delta compression (research.md #2).
    table = table.sort_by([("userIdA", "ascending"), ("userIdB", "ascending")])
    pq.write_table(table, out_path, compression="zstd")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out-dir", type=Path, default=Path("dist"))
    parser.add_argument("--coverage-years", type=int, default=COVERAGE_YEARS)
    args = parser.parse_args()

    args.out_dir.mkdir(parents=True, exist_ok=True)
    rows, manifest = build_index(coverage_years=args.coverage_years)

    parquet_path = args.out_dir / "match-index.parquet"
    write_parquet(rows, parquet_path)

    manifest["parquetUrl"] = "REPLACE_WITH_RELEASE_ASSET_URL"  # filled in by the publishing workflow step
    (args.out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False))

    print(f"Wrote {parquet_path} ({parquet_path.stat().st_size / 1e6:.2f} MB) and manifest.json", file=sys.stderr)


if __name__ == "__main__":
    main()
