// Reusable Pyodide execution-time benchmark (research.md #1, tasks.md T024).
// Runs headlessly in Node via the `pyodide` npm package — no browser required — so it can
// be invoked both by hand (`npm run benchmark`) and from CI (T059, .github/workflows/benchmark.yml).
//
// This is NOT a one-time spike: re-run it whenever frontend/src/engine/ or
// frontend/src/data/ changes (see tasks.md Notes, 2026-08-21).

import { loadPyodide } from "pyodide";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEED_ADJUSTER_PY_PATH = path.join(__dirname, "../src/engine/seed_adjuster.py");

// FR-003/SC-002: realistic-scale runs must comfortably finish within 60 minutes.
// This benchmark budget is intentionally much tighter than 60 minutes for the small/medium
// sizes — they should be near-instant; only the largest "realistic" size is checked against
// something close to the real budget, and the extreme size documents where FR-003a's warning
// threshold should probably sit.
const BUDGET_SECONDS_BY_ENTRANTS: { entrants: number; budgetSeconds: number }[] = [
  { entrants: 32, budgetSeconds: 5 },
  { entrants: 128, budgetSeconds: 15 },
  { entrants: 512, budgetSeconds: 60 },
  { entrants: 1024, budgetSeconds: 180 },
  { entrants: 2048, budgetSeconds: 600 },
];

// Roughly matches real match-history density: enough pairs have some history that the
// algorithm actually exercises calc_match_point/get_tight_group non-trivially.
function buildSyntheticData(entrants: number) {
  const initialData = Array.from({ length: entrants }, (_, i) => ({
    user_id: 1000 + i,
    player_name: `Player${i}`,
  }));

  const matchLookup: Record<string, { timestamp: number; numEntrants: number }[]> = {};
  const now = Math.floor(Date.now() / 1000);
  for (let i = 0; i < entrants; i++) {
    // Each player has prior history against a handful of nearby-seeded opponents,
    // similar to real brackets where rivals cluster by region/skill.
    for (let d = 1; d <= 5 && i + d < entrants; d++) {
      const a = 1000 + i;
      const b = 1000 + i + d;
      const key = `${Math.min(a, b)}:${Math.max(a, b)}`;
      matchLookup[key] = [
        { timestamp: now - d * 7 * 24 * 3600, numEntrants: entrants },
      ];
    }
  }

  return { initialData, matchLookup };
}

const params = {
  ref_date: new Date().toISOString().slice(0, 10),
  fixed_seed_num: 0,
  conditional_least_num_entrants: 0,
  apply_conditional_least_num_entrants_seed_num: 0,
  search_breadth_multiplier: 1,
};

async function main() {
  console.log("Loading Pyodide...");
  const pyodide = await loadPyodide();
  const source = readFileSync(SEED_ADJUSTER_PY_PATH, "utf-8");
  pyodide.FS.writeFile("/seed_adjuster.py", source);
  await pyodide.runPythonAsync(`
import sys
sys.path.insert(0, "/")
import seed_adjuster
`);

  let anyOverBudget = false;
  const rows: { entrants: number; seconds: number; budgetSeconds: number; ok: boolean }[] = [];

  for (const { entrants, budgetSeconds } of BUDGET_SECONDS_BY_ENTRANTS) {
    const { initialData, matchLookup } = buildSyntheticData(entrants);
    pyodide.globals.set("initial_data_json", JSON.stringify(initialData));
    pyodide.globals.set("match_lookup_json", JSON.stringify(matchLookup));
    pyodide.globals.set("params_json", JSON.stringify(params));

    const start = performance.now();
    await pyodide.runPythonAsync(`
import json
initial_data = json.loads(initial_data_json)
params = json.loads(params_json)
_raw_match_lookup = json.loads(match_lookup_json)
match_lookup = {}
for key, matches in _raw_match_lookup.items():
    a, b = key.split(":")
    match_lookup[(int(a), int(b))] = matches
result = seed_adjuster.get_adjusted_result(initial_data, match_lookup, params)
`);
    const seconds = (performance.now() - start) / 1000;
    const ok = seconds <= budgetSeconds;
    if (!ok) anyOverBudget = true;
    rows.push({ entrants, seconds, budgetSeconds, ok });
    console.log(
      `entrants=${entrants}: ${seconds.toFixed(2)}s (budget ${budgetSeconds}s) ${ok ? "OK" : "OVER BUDGET"}`,
    );
  }

  console.table(rows);

  if (anyOverBudget) {
    console.error(
      "\n⚠️ 少なくとも1つの規模で予算を超過しました。frontend/src/engine/seed_adjuster.py または " +
        "frontend/src/data/matchIndex.ts の最適化が必要です(T025)。research.md #1 の再検討も検討してください。",
    );
    process.exitCode = 1;
  } else {
    console.log("\n✓ すべての規模で予算内に収まりました。");
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
