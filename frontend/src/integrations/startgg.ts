// start.gg GraphQL integration. The personal access token is stored **only** in the
// browser's IndexedDB — never sent to control-plane (research.md #5). Calls go directly
// from the browser to start.gg; if start.gg doesn't allow direct browser CORS, requests
// fall back to the control-plane's pass-through relay (research.md #6, #7 — unverified as
// of 2026-08-21; verify against the real start.gg API before relying on the direct path in
// production, and drop the relay if it turns out to be unnecessary).
//
// Schema note: start.gg's GraphQL field names for entrant/participant identity used here
// (`entrant.id`, `entrant.participants[].player.id`) are the standard start.gg public API
// shape as of this writing, but have not been verified end-to-end against smash_database's
// winner_id/loser_id convention — confirm this mapping against real tournament data before
// shipping (tracked as a follow-up; see docs/google-oauth-setup.md sibling doc TODO).

import { CONTROL_PLANE_API_BASE_URL } from "../config";

const DB_NAME = "seed-adjuster";
const STORE_NAME = "startgg";
const TOKEN_KEY = "accessToken";
const STARTGG_GRAPHQL_URL = "https://api.start.gg/gql/alpha";

// Set to true once CORS support against api.start.gg is confirmed absent; false skips the relay.
const USE_RELAY = false;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveStartggToken(token: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(token, TOKEN_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getStartggToken(): Promise<string | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).get(TOKEN_KEY);
    req.onsuccess = () => resolve((req.result as string) ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function isStartggConnected(): Promise<boolean> {
  return (await getStartggToken()) !== null;
}

async function startggQuery<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const token = await getStartggToken();
  if (!token) throw new Error("start.ggアカウントが未接続です。設定ページで連携してください。");

  const url = USE_RELAY ? `${CONTROL_PLANE_API_BASE_URL}/relay/startgg` : STARTGG_GRAPHQL_URL;
  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  if (!response.ok) {
    throw new Error(`start.gg APIエラー (${response.status})`);
  }
  const body = await response.json();
  if (body.errors) {
    throw new Error(`start.gg APIエラー: ${body.errors.map((e: { message: string }) => e.message).join(", ")}`);
  }
  return body.data as T;
}

export interface StartggSeedEntry {
  user_id: number;
  player_name: string;
  original_input_order: number;
  seed_id: string; // start.gg's internal seed ID, needed to write the seeding back
}

interface PhaseSeedsResponse {
  phase: {
    seeds: {
      nodes: {
        id: string;
        seedNum: number;
        entrant: { id: number; name: string; participants: { player: { id: number; gamerTag: string } }[] };
      }[];
    };
  };
}

const GET_PHASE_SEEDS_QUERY = `
  query GetPhaseSeeds($phaseId: ID!) {
    phase(id: $phaseId) {
      seeds(query: { page: 1, perPage: 500 }) {
        nodes {
          id
          seedNum
          entrant {
            id
            name
            participants { player { id gamerTag } }
          }
        }
      }
    }
  }
`;

export async function getCurrentSeeding(phaseId: string): Promise<StartggSeedEntry[]> {
  const data = await startggQuery<PhaseSeedsResponse>(GET_PHASE_SEEDS_QUERY, { phaseId });
  return data.phase.seeds.nodes
    .sort((a, b) => a.seedNum - b.seedNum)
    .map((node, i) => ({
      user_id: node.entrant.participants[0]?.player.id ?? node.entrant.id,
      player_name: node.entrant.participants[0]?.player.gamerTag ?? node.entrant.name,
      original_input_order: i + 1,
      seed_id: node.id,
    }));
}

const UPDATE_PHASE_SEEDING_MUTATION = `
  mutation UpdatePhaseSeeding($phaseId: ID!, $seedMapping: [UpdatePhaseSeedInfo]!) {
    updatePhaseSeeding(phaseId: $phaseId, seedMapping: $seedMapping) {
      id
    }
  }
`;

/**
 * Writes the adjusted order back to start.gg (FR-011). Requires the caller to have already
 * obtained explicit organizer approval (see WritebackConfirmPage.tsx) — this function itself
 * performs no confirmation.
 */
export async function writebackSeeding(
  phaseId: string,
  orderedSeedIds: string[], // seed_id in the NEW (adjusted) order
): Promise<void> {
  const seedMapping = orderedSeedIds.map((seedId, i) => ({ seedId, seedNum: i + 1 }));
  await startggQuery(UPDATE_PHASE_SEEDING_MUTATION, { phaseId, seedMapping });
}
