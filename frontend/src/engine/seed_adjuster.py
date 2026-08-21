"""Seed adjustment algorithm, ported from seed_adjuster.ipynb (see plan.md / research.md #1).

Runs inside Pyodide in the browser. Unlike the original notebook, this module does not
clone smash_database or read Colab userdata secrets — the caller (frontend/src/engine/
runAdjustment.ts) is responsible for:
  - building `match_lookup` from the compact match-history index (DuckDB-WASM, see
    frontend/src/data/matchIndex.ts) for exactly the entrants in this run, and
  - supplying all tunable parameters explicitly via `params` (see AdjustmentSettings in
    data-model.md) instead of environment/secret lookups.

The non-public "hidden_value" concept from the original notebook has been dropped entirely
for this feature (spec.md Assumptions, 2026-08-21) — match_point is based purely on match
history recency and tournament size.
"""

from __future__ import annotations

import math
from datetime import datetime, timezone, timedelta
from functools import lru_cache
from typing import Any, Callable, Iterable, TypedDict


class MatchRecord(TypedDict):
    timestamp: int
    numEntrants: int


MatchLookup = dict[tuple[int, int], list[MatchRecord]]

SECONDS_PER_YEAR = 31536000.0
TEMPORARY_INITIAL_MATCH_VALUE = -10000


def get_midnight_jst_unixtime_from_str(date_str: str) -> int:
    """'YYYY-MM-DD' (JST) -> Unix timestamp of that day's midnight JST."""
    jst = timezone(timedelta(hours=9))
    date_obj = datetime.strptime(date_str, "%Y-%m-%d").date()
    midnight_jst = datetime(date_obj.year, date_obj.month, date_obj.day, tzinfo=jst)
    return int(midnight_jst.astimezone(timezone.utc).timestamp())


def calc_match_point_from_timestamps(match_timestamps: Iterable[int], ref_unixtime: int) -> float:
    return sum(4 ** ((timestamp - ref_unixtime) / SECONDS_PER_YEAR) for timestamp in match_timestamps)


def search_player_matches(
    match_lookup: MatchLookup, target_user_id: int, opponent_user_id: int, least_num_entrants: int = 0
) -> list[MatchRecord]:
    key = (min(target_user_id, opponent_user_id), max(target_user_id, opponent_user_id))
    return [m for m in match_lookup.get(key, []) if m["numEntrants"] >= least_num_entrants]


def make_match_point_calculator(
    match_lookup: MatchLookup, ref_unixtime: int
) -> Callable[[int, int, int], float]:
    """Returns a memoized calc_match_point(target_id, opponent_id, least_num_entrants)."""

    @lru_cache(maxsize=None)
    def calc_match_point(target_user_id: int, opponent_user_id: int, least_num_entrants: int = 0) -> float:
        matches = search_player_matches(match_lookup, target_user_id, opponent_user_id, least_num_entrants)
        return calc_match_point_from_timestamps([m["timestamp"] for m in matches], ref_unixtime)

    return calc_match_point


def calc_breadth(index: int, search_breadth_multiplier: int, breadth_const: int = 0) -> int:
    return int((max(1, math.floor(math.log2(index)) - breadth_const)) * search_breadth_multiplier) if index > 0 else search_breadth_multiplier


def calc_opponent_index(index: int) -> int:
    winner_lrv = math.ceil(math.log2(index + 1))
    return int(math.pow(2, winner_lrv) - index - 1)


class WaveContext:
    """Wraps the optional Wave-preference constraints (see spec.md FR-006)."""

    def __init__(
        self,
        wave_pattern: dict[int, str] | None = None,
        wave_cycle_length: int = 1,
        allowed_waves_map: dict[str, list[str]] | None = None,
    ) -> None:
        self.wave_pattern = wave_pattern or {}
        self.wave_cycle_length = wave_cycle_length or 1
        self.allowed_waves_map = allowed_waves_map or {}

    def get_wave(self, index: int) -> str:
        if not self.wave_pattern:
            return ""
        pos = (index % self.wave_cycle_length) + 1
        return self.wave_pattern.get(pos, "")

    def get_allowed_waves(self, player: dict[str, Any]) -> list[str]:
        disc = str(player.get("discriminator", ""))
        return self.allowed_waves_map.get(disc, [])

    def is_wave_valid(self, player: dict[str, Any], position_index: int) -> bool:
        allowed = self.get_allowed_waves(player)
        if not allowed:
            return True
        return self.get_wave(position_index) in allowed


def _record_wave_violation(
    wave_violations: list[dict[str, Any]],
    initial_data: list[dict[str, Any]],
    adjusted_data: list[dict[str, Any]],
    player_idx: int,
    wave_ctx: WaveContext,
) -> None:
    current_pos = len(adjusted_data)
    player = initial_data[player_idx]
    player_name = player.get("player_name", player.get("gamer_tag", "Unknown"))
    wave_violations.append(
        {
            "phaseseed": current_pos + 1,
            "player_name": player_name,
            "wave": wave_ctx.get_wave(current_pos),
            "allowed_waves": wave_ctx.get_allowed_waves(player),
        }
    )


def is_adjusted_seed(
    initial_data: list[dict[str, Any]],
    adjusted_data: list[dict[str, Any]],
    target_initial_index: int,
    calc_match_point: Callable[[int, int, int], float],
    wave_ctx: WaveContext,
    search_breadth_multiplier: int,
    conditional_least_num_entrants: int,
    apply_conditional_least_num_entrants_seed_num: int,
) -> list[Any] | None:
    target_user_id = initial_data[target_initial_index]["user_id"]
    breadth = calc_breadth(target_initial_index, search_breadth_multiplier)
    max_index = int(min(target_initial_index + breadth, len(initial_data)))

    adjusted_match_value = TEMPORARY_INITIAL_MATCH_VALUE
    match_log: list[Any] = []

    for current_index in range(len(adjusted_data), max_index):
        if not wave_ctx.is_wave_valid(initial_data[target_initial_index], current_index):
            continue
        opponent_index = calc_opponent_index(current_index)
        if opponent_index >= len(initial_data):
            continue
        if opponent_index >= len(adjusted_data):
            return None
        opponent_user_id = adjusted_data[opponent_index]["user_id"]
        least_num_entrants = (
            conditional_least_num_entrants
            if current_index <= apply_conditional_least_num_entrants_seed_num
            and opponent_index <= apply_conditional_least_num_entrants_seed_num
            else 0
        )
        current_match_value = calc_match_point(target_user_id, opponent_user_id, least_num_entrants)

        player_name_for_log = adjusted_data[opponent_index].get(
            "player_name", adjusted_data[opponent_index].get("gamer_tag", "Unknown")
        )
        match_log.extend([opponent_index, opponent_user_id, player_name_for_log, current_match_value])
        if adjusted_match_value <= TEMPORARY_INITIAL_MATCH_VALUE:
            adjusted_match_value = current_match_value
            continue
        if current_match_value < adjusted_match_value:
            return None
    return match_log


def get_target_indices(
    initial_data: list[dict[str, Any]],
    adjusted_data: list[dict[str, Any]],
    wave_ctx: WaveContext,
    search_breadth_multiplier: int,
    placed_ids: set[int],
    ignore_wave: bool = False,
) -> list[int]:
    """`placed_ids` is maintained incrementally by the caller (see get_adjusted_result) so
    this stays O(breadth) per call instead of rebuilding an O(current_pos) set every time
    (tasks.md T025 performance fix, 2026-08-21)."""
    current_pos = len(adjusted_data)
    breadth = calc_breadth(current_pos, search_breadth_multiplier)
    max_index = int(min(len(initial_data), current_pos + breadth))
    indices = []
    for i in range(0, max_index):
        if initial_data[i]["user_id"] in placed_ids:
            continue
        if not ignore_wave and not wave_ctx.is_wave_valid(initial_data[i], current_pos):
            continue
        indices.append(i)
    return indices


def get_tight_group(
    initial_data: list[dict[str, Any]],
    adjusted_data: list[dict[str, Any]],
    wave_ctx: WaveContext,
    search_breadth_multiplier: int,
    unplaced: Iterable[int],
) -> list[int] | None:
    """A group of w players that can only fit in the next w slots (generalizes w=1 forcing).

    Performance note (2026-08-21, tasks.md T025): `valid_positions(idx)` depends only on
    `current_pos` and `player_idx` — never on `w` — so it must be computed once per
    candidate, not once per (candidate, w) pair. The original port recomputed it inside the
    `w` loop, making this function O(n * max_breadth) per call and the overall algorithm
    O(n^2 * log n): benchmarked at 126s for n=1024 in plain CPython (no Pyodide overhead at
    all) — nowhere near meeting FR-003/SC-002's 60-minute budget at realistic scale. Hoisting
    the computation out of the loop, and taking `unplaced` as a parameter maintained
    incrementally by the caller instead of rebuilding it from `adjusted_data` on every call,
    removes both redundancies without changing which tight group (if any) is found.
    """
    current_pos = len(adjusted_data)
    max_breadth = calc_breadth(current_pos, search_breadth_multiplier)

    def valid_positions(player_idx: int) -> list[int]:
        b = calc_breadth(player_idx, search_breadth_multiplier)
        max_pos = min(player_idx + b, len(initial_data))
        return [j for j in range(current_pos, max_pos) if wave_ctx.is_wave_valid(initial_data[player_idx], j)]

    # Computed once per candidate (not once per (candidate, w) pair — see docstring).
    max_valid_position: dict[int, int] = {}
    for idx in unplaced:
        vp = valid_positions(idx)
        if vp:
            max_valid_position[idx] = max(vp)

    for w in range(1, max_breadth + 1):
        window_end = current_pos + w
        constrained = [idx for idx, max_pos in max_valid_position.items() if max_pos < window_end]
        if len(constrained) >= w:
            return constrained

    return None


def get_least_match(
    initial_data: list[dict[str, Any]],
    adjusted_data: list[dict[str, Any]],
    target_indices: list[int],
    calc_match_point: Callable[[int, int, int], float],
    conditional_least_num_entrants: int,
    apply_conditional_least_num_entrants_seed_num: int,
) -> dict[str, Any]:
    opponent_index = calc_opponent_index(len(adjusted_data))
    opponent_user_id = adjusted_data[opponent_index]["user_id"]
    adjusted_index = -1
    adjusted_match_value = TEMPORARY_INITIAL_MATCH_VALUE
    match_log: list[Any] = []
    for current_index in target_indices:
        current_user_id = initial_data[current_index]["user_id"]
        least_num_entrants = (
            conditional_least_num_entrants
            if current_index <= apply_conditional_least_num_entrants_seed_num
            and opponent_index <= apply_conditional_least_num_entrants_seed_num
            else 0
        )
        current_match_value = calc_match_point(current_user_id, opponent_user_id, least_num_entrants)

        player_name_for_log = initial_data[current_index].get(
            "player_name", initial_data[current_index].get("gamer_tag", "Unknown")
        )
        match_log.extend([current_index, current_user_id, player_name_for_log, current_match_value])
        if adjusted_match_value <= TEMPORARY_INITIAL_MATCH_VALUE or current_match_value < adjusted_match_value:
            adjusted_index = current_index
            adjusted_match_value = current_match_value
    return {"adjusted_index": adjusted_index, "opponent_index": opponent_index, "match_log": match_log}


def get_adjusted_result(
    initial_data: list[dict[str, Any]],
    match_lookup: MatchLookup,
    params: dict[str, Any],
) -> dict[str, Any]:
    """Main entry point.

    params keys (see data-model.md AdjustmentSettings.effectiveValue):
      ref_date: str "YYYY-MM-DD"
      fixed_seed_num: int
      conditional_least_num_entrants: int
      apply_conditional_least_num_entrants_seed_num: int
      search_breadth_multiplier: int
      wave_pattern / wave_cycle_length / allowed_waves_map: optional (FR-006)
    """
    ref_unixtime = get_midnight_jst_unixtime_from_str(params["ref_date"])
    calc_match_point = make_match_point_calculator(match_lookup, ref_unixtime)
    wave_ctx = WaveContext(
        params.get("wave_pattern"), params.get("wave_cycle_length", 1), params.get("allowed_waves_map")
    )
    fixed_seed_num = params["fixed_seed_num"]
    conditional_least_num_entrants = params["conditional_least_num_entrants"]
    apply_conditional_least_num_entrants_seed_num = params["apply_conditional_least_num_entrants_seed_num"]
    search_breadth_multiplier = params["search_breadth_multiplier"]

    adjusted_data = [initial_data[0]]
    match_logs: list[Any] = [[]]
    wave_violations: list[dict[str, Any]] = []

    # Maintained incrementally across iterations instead of being rebuilt from
    # `adjusted_data` on every call (tasks.md T025 performance fix, 2026-08-21) — see
    # get_tight_group's docstring for why this mattered for the 60-minute budget.
    placed_ids: set[int] = {initial_data[0]["user_id"]}
    unplaced: set[int] = {i for i in range(1, len(initial_data))}

    def place(index: int) -> None:
        adjusted_data.append(initial_data[index])
        placed_ids.add(initial_data[index]["user_id"])
        unplaced.discard(index)

    for i in range(1, len(initial_data)):
        target_indices = get_target_indices(
            initial_data, adjusted_data, wave_ctx, search_breadth_multiplier, placed_ids
        )
        wave_ignored = False
        if len(target_indices) == 0:
            target_indices = get_target_indices(
                initial_data, adjusted_data, wave_ctx, search_breadth_multiplier, placed_ids, ignore_wave=True
            )
            wave_ignored = True

        if len(target_indices) <= 0:
            break

        if i < fixed_seed_num:
            if wave_ignored:
                _record_wave_violation(wave_violations, initial_data, adjusted_data, target_indices[0], wave_ctx)
            place(target_indices[0])
            match_logs.append([])
            continue

        if len(target_indices) <= 1:
            if wave_ignored:
                _record_wave_violation(wave_violations, initial_data, adjusted_data, target_indices[0], wave_ctx)
            place(target_indices[0])
            match_logs.append([])
            continue

        tight_group = get_tight_group(initial_data, adjusted_data, wave_ctx, search_breadth_multiplier, unplaced)
        if tight_group:
            target_set = set(target_indices)
            tight_valid_here = [idx for idx in tight_group if idx in target_set]
            effective_indices = tight_valid_here if tight_valid_here else target_indices
        else:
            effective_indices = target_indices

        placed = False
        for candidate_index in effective_indices:
            match_log_result = is_adjusted_seed(
                initial_data,
                adjusted_data,
                candidate_index,
                calc_match_point,
                wave_ctx,
                search_breadth_multiplier,
                conditional_least_num_entrants,
                apply_conditional_least_num_entrants_seed_num,
            )
            if match_log_result is not None:
                if wave_ignored:
                    _record_wave_violation(wave_violations, initial_data, adjusted_data, candidate_index, wave_ctx)
                opponent_idx = calc_opponent_index(len(adjusted_data))
                opponent_player_name = initial_data[opponent_idx].get(
                    "player_name", initial_data[opponent_idx].get("gamer_tag", "Unknown")
                )
                match_logs.append(["best_left_player_based", opponent_player_name, ""] + match_log_result)
                place(candidate_index)
                placed = True
                break

        if not placed:
            least_match_result = get_least_match(
                initial_data,
                adjusted_data,
                effective_indices,
                calc_match_point,
                conditional_least_num_entrants,
                apply_conditional_least_num_entrants_seed_num,
            )
            if wave_ignored:
                _record_wave_violation(
                    wave_violations, initial_data, adjusted_data, least_match_result["adjusted_index"], wave_ctx
                )
            opponent_player_name = initial_data[least_match_result["opponent_index"]].get(
                "player_name", initial_data[least_match_result["opponent_index"]].get("gamer_tag", "Unknown")
            )
            match_logs.append(["seed_position_based", opponent_player_name, ""] + least_match_result["match_log"])
            place(least_match_result["adjusted_index"])

    # Mirrors seed_adjuster.ipynb cell 7's post-processing: annotate each output row with
    # its new position, original position, and the Wave it landed in. `original_input_order`
    # must already be set on each entry of `initial_data` (1-indexed) by the caller.
    for i, row in enumerate(adjusted_data):
        row["original_phaseseed"] = row.get("original_input_order")
        row["phaseseed"] = i + 1
        row["adjusted_wave"] = wave_ctx.get_wave(i)

    return {"adjusted_data": adjusted_data, "match_logs": match_logs, "wave_violations": wave_violations}
