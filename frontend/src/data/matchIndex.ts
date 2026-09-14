// Lazy-loaded DuckDB-WASM match-history query module (research.md #2, contracts/match-index-format.md).
// Only imported once a run starts. Caches the Parquet artifact in the browser Cache API,
// keyed by the manifest's `generatedAt`, so repeat runs against an unchanged index skip
// the download entirely (research.md #2 "ランタイム・インデックスのキャッシュ方針").

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
const CACHE_NAME = "seed-adjuster-match-index-v1";

async function fetchManifest(manifestUrl: string): Promise<MatchIndexManifest> {
  const response = await fetch(manifestUrl, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`対戦履歴インデックスのマニフェスト取得に失敗しました (${response.status})`);
  }
  return response.json();
}

async function fetchParquetCached(manifest: MatchIndexManifest): Promise<ArrayBuffer> {
  const cache = await caches.open(CACHE_NAME);
  const cacheKey = new Request(`${manifest.parquetUrl}#${manifest.generatedAt}`);
  const cached = await cache.match(cacheKey);
  if (cached) return cached.arrayBuffer();

  const response = await fetch(manifest.parquetUrl);
  if (!response.ok) {
    throw new Error(`対戦履歴インデックス(Parquet)の取得に失敗しました (${response.status})`);
  }
  await cache.put(cacheKey, response.clone());
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
  const parquetBuffer = await fetchParquetCached(manifest);

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
 * contracts/tournament-directory.md), published alongside manifest.json. Cached the same way
 * as the Parquet artifact (keyed by the manifest's generatedAt) so repeat opens of the
 * placement-decision detail view don't re-fetch it. Only called lazily when that detail view
 * is first opened — never during a normal run (research.md R1, R4).
 */
export async function fetchTournamentDirectory(manifestUrl: string): Promise<TournamentDirectory> {
  const manifest = await fetchManifest(manifestUrl);
  const tournamentsUrl = tournamentsUrlFromManifestUrl(manifestUrl);
  const cache = await caches.open(CACHE_NAME);
  const cacheKey = new Request(`${tournamentsUrl}#${manifest.generatedAt}`);
  const cached = await cache.match(cacheKey);
  if (cached) {
    const body: { tournaments: TournamentDirectory } = await cached.json();
    return body.tournaments;
  }

  const response = await fetch(tournamentsUrl);
  if (!response.ok) {
    throw new Error(`大会名対応表の取得に失敗しました (${response.status})`);
  }
  await cache.put(cacheKey, response.clone());
  const body: { tournaments: TournamentDirectory } = await response.json();
  return body.tournaments;
}
