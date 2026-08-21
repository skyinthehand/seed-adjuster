// Shared HTTP helpers for control-plane API handlers (contracts/api.md common error format).

const CORS_HEADERS_BASE = {
  "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export function corsHeaders(allowedOrigin: string): HeadersInit {
  return { ...CORS_HEADERS_BASE, "Access-Control-Allow-Origin": allowedOrigin };
}

export function jsonResponse(status: number, body: unknown, extraHeaders: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...extraHeaders },
  });
}

export function errorResponse(
  status: number,
  code: string,
  message: string,
  extraHeaders: HeadersInit = {},
): Response {
  return jsonResponse(status, { error: { code, message } }, extraHeaders);
}
