// Build-time configuration (frontend/.env.example documents each of these).

export const GOOGLE_OAUTH_CLIENT_ID = import.meta.env.VITE_GOOGLE_OAUTH_CLIENT_ID as string;
export const CONTROL_PLANE_API_BASE_URL = import.meta.env.VITE_CONTROL_PLANE_API_BASE_URL as string;

// Published by indexer (contracts/match-index-format.md) as a GitHub Release asset.
// The "latest-index" release alias is updated by .github/workflows/indexer.yml on every run.
export const MATCH_INDEX_MANIFEST_URL =
  (import.meta.env.VITE_MATCH_INDEX_MANIFEST_URL as string | undefined) ??
  "https://github.com/skyinthehand/seed-adjuster/releases/download/latest-index/manifest.json";
