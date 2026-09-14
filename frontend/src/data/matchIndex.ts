// Lazy-loaded DuckDB-WASM match-history query module (research.md #2, contracts/match-index-format.md).
// Only imported once a run starts.
//
// Deliberately does NOT cache the Parquet/tournaments.json bodies anywhere (2026-09-15,
// replaces an earlier Cache-API-based scheme keyed by manifest.generatedAt): indexer
// force-pushes new content to the same URL on every run, and in practice a viewer's browser
// still served a stale, pre-update body from the app's own Cache Storage after a fresh
// indexer run — clearing site data was the only fix. Always re-fetching fresh (no-store, and
// no application-level cache) trades a few extra seconds/MB per run for never showing stale
// match history again — see research.md #2 for the updated policy.

export interface MatchIndexManifest {
  formatVersion: number;
  generatedAt: string;
  coveragePeriod: { from: string; to: string };
  parquetUrl: string;
}

export interface MatchRecord {
  timestamp: number;
  numEntrants: number;
  tournamentId: number;
}

/** tournamentId (stringified) -> tournament name (002-result-decision-detail, contracts/tournament-directory.md). */
export type TournamentDirectory = Record<string, string>;

const SUPPORTED_FORMAT_VERSION = 1;

async function fetchManifest(manifestUrl: string): Promise<MatchIndexManifest> {
  const response = await fetch(manifestUrl, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`対戦履歴インデックスのマニフェスト取得に失敗しました (${response.status})`);
  }
  return response.json();
}

async function fetchParquet(manifest: MatchIndexManifest): Promise<ArrayBuffer> {
  const response = await fetch(manifest.parquetUrl, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`対戦履歴インデックス(Parquet)の取得に失敗しました (${response.status})`);
  }
  return response.arrayBuffer();
}

/**
 * Queries the match-history index for exactly the given entrant IDs and returns a
 * lookup keyed by "minId:maxId" (see frontend/src/engine/pyodideRuntime.ts), which is
 * the shape the ported Python algorithm expects.
 */
export async function loadMatchLookup(
  manifestUrl: string,
  entrantUserIds: number[],
): Promise<Record<string, MatchRecord[]>> {
  const manifest = await fetchManifest(manifestUrl);
  if (manifest.formatVersion !== SUPPORTED_FORMAT_VERSION) {
    throw new Error(
      `対戦履歴インデックスの形式(v${manifest.formatVersion})に対応していません(対応: v${SUPPORTED_FORMAT_VERSION})`,
    );
  }
  const parquetBuffer = await fetchParquet(manifest);

  const duckdb = await import("@duckdb/duckdb-wasm");
  const bundle = await duckdb.selectBundle(duckdb.getJsDelivrBundles());
  // new Worker(bundle.mainWorker) fails browsers' same-origin check for Worker scripts even
  // though jsDelivr serves the script with CORS headers — Worker construction requires the
  // script itself to be same-origin, CORS headers don't satisfy that. duckdb.createWorker()
  // fetches the script and instantiates the Worker from a same-origin Blob URL instead.
  const worker = await duckdb.createWorker(bundle.mainWorker!);
  const logger = new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING);
  const db = new duckdb.AsyncDuckDB(logger, worker);
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker);

  try {
    await db.registerFileBuffer("match-index.parquet", new Uint8Array(parquetBuffer));
    const conn = await db.connect();
    try {
      const idList = entrantUserIds.join(",");
      const result = await conn.query(`
        SELECT "userIdA", "userIdB", "timestamp", "numEntrants", "tournamentId"
        FROM read_parquet('match-index.parquet')
        WHERE "userIdA" IN (${idList}) AND "userIdB" IN (${idList})
      `);

      const lookup: Record<string, MatchRecord[]> = {};
      for (const row of result.toArray()) {
        const key = `${row.userIdA}:${row.userIdB}`;
        (lookup[key] ??= []).push({
          timestamp: Number(row.timestamp),
          numEntrants: Number(row.numEntrants),
          tournamentId: Number(row.tournamentId),
        });
      }
      return lookup;
    } finally {
      await conn.close();
    }
  } finally {
    await db.terminate();
    worker.terminate();
  }
}

function tournamentsUrlFromManifestUrl(manifestUrl: string): string {
  return manifestUrl.replace(/manifest\.json(?=$|[?#])/, "tournaments.json");
}

/**
 * Fetches the tournamentId -> name lookup table (002-result-decision-detail,
 * contracts/tournament-directory.md), published alongside manifest.json. Only called lazily
 * when the placement-decision detail view is first opened — never during a normal run
 * (research.md R1, R4). Not cached — see the module-level comment above.
 */
export async function fetchTournamentDirectory(manifestUrl: string): Promise<TournamentDirectory> {
  const tournamentsUrl = tournamentsUrlFromManifestUrl(manifestUrl);
  const response = await fetch(tournamentsUrl, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`大会名対応表の取得に失敗しました (${response.status})`);
  }
  const body: { tournaments: TournamentDirectory } = await response.json();
  return body.tournaments;
}
