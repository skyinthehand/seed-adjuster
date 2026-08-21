// Lazy-loaded Pyodide bootstrap (research.md #1, #9). Only imported/invoked once a run
// actually starts — never on page load, so casual visitors (e.g. the public results page)
// never pay this download cost.

import seedAdjusterSource from "./seed_adjuster.py?raw";

// Loaded dynamically so `pyodide` is never bundled into the main chunk.
type PyodideInterface = Awaited<ReturnType<typeof import("pyodide").loadPyodide>>;

let pyodidePromise: Promise<PyodideInterface> | null = null;

async function getPyodide(): Promise<PyodideInterface> {
  if (!pyodidePromise) {
    pyodidePromise = (async () => {
      const { loadPyodide } = await import("pyodide");
      const pyodide = await loadPyodide();
      pyodide.FS.writeFile("/seed_adjuster.py", seedAdjusterSource);
      await pyodide.runPythonAsync(`
import sys
sys.path.insert(0, "/")
import seed_adjuster
`);
      return pyodide;
    })();
  }
  return pyodidePromise;
}

export interface InitialSeedEntry {
  user_id: number;
  player_name: string;
  discriminator?: string;
  [key: string]: unknown;
}

export interface MatchLookupEntry {
  timestamp: number;
  numEntrants: number;
}

export interface AdjustmentParams {
  ref_date: string;
  fixed_seed_num: number;
  conditional_least_num_entrants: number;
  apply_conditional_least_num_entrants_seed_num: number;
  search_breadth_multiplier: number;
  wave_pattern?: Record<number, string>;
  wave_cycle_length?: number;
  allowed_waves_map?: Record<string, string[]>;
}

export interface AdjustedResult {
  adjusted_data: InitialSeedEntry[];
  match_logs: unknown[][];
  wave_violations: { phaseseed: number; player_name: string; wave: string; allowed_waves: string[] }[];
}

/**
 * Runs the ported algorithm (frontend/src/engine/seed_adjuster.py) inside Pyodide.
 * `matchLookup` keys are "minId:maxId" strings (Python tuple keys aren't representable
 * in JSON/JS, so we reconstruct the tuple keys on the Python side — see below).
 */
export async function runAdjustment(
  initialData: InitialSeedEntry[],
  matchLookup: Record<string, MatchLookupEntry[]>,
  params: AdjustmentParams,
): Promise<AdjustedResult> {
  const pyodide = await getPyodide();
  pyodide.globals.set("initial_data_json", JSON.stringify(initialData));
  pyodide.globals.set("match_lookup_json", JSON.stringify(matchLookup));
  pyodide.globals.set("params_json", JSON.stringify(params));

  const resultJson: string = await pyodide.runPythonAsync(`
import json

initial_data = json.loads(initial_data_json)
params = json.loads(params_json)

_raw_match_lookup = json.loads(match_lookup_json)
match_lookup = {}
for key, matches in _raw_match_lookup.items():
    a, b = key.split(":")
    match_lookup[(int(a), int(b))] = matches

result = seed_adjuster.get_adjusted_result(initial_data, match_lookup, params)
json.dumps(result)
`);

  return JSON.parse(resultJson);
}
