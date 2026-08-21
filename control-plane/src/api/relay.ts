import { jsonResponse } from "./http";

// Conditional pass-through relay for start.gg's GraphQL API (research.md #6). Only needed if
// api.start.gg turns out not to support direct browser CORS calls — unverified as of
// 2026-08-21. This handler deliberately never logs the request body or Authorization header,
// and holds no state: it forwards the request and returns the response, nothing else.

const STARTGG_GRAPHQL_URL = "https://api.start.gg/gql/alpha";

export async function handleStartggRelay(request: Request): Promise<Response> {
  const authorization = request.headers.get("Authorization");
  if (!authorization) {
    return jsonResponse(401, { error: { code: "MISSING_TOKEN", message: "Authorization header is required" } });
  }
  const body = await request.text();

  const upstream = await fetch(STARTGG_GRAPHQL_URL, {
    method: "POST",
    headers: { Authorization: authorization, "Content-Type": "application/json" },
    body,
  });

  // Pass the upstream response straight through — no logging, no persistence.
  return new Response(upstream.body, {
    status: upstream.status,
    headers: { "Content-Type": upstream.headers.get("Content-Type") ?? "application/json" },
  });
}
