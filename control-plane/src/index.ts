import {
  handleCreateRun,
  handleGetRun,
  handleCompleteRun,
  handleFailRun,
  handleWritebackRecorded,
} from "./api/runs";
import { handleGetPublicResult, handleListPublicRuns } from "./api/public";
import { handleStartggRelay } from "./api/relay";
import { handleGetSettings, handlePutSettings } from "./api/settings";
import { corsHeaders, errorResponse } from "./api/http";

export interface Env {
  DB: D1Database;
  ALLOWED_ORIGIN: string;
}

// Route handlers live in src/api/*.ts (one file per resource, per contracts/api.md).
// This entrypoint only does CORS + path dispatch; it holds no business logic.
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const headers = corsHeaders(env.ALLOWED_ORIGIN);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers });
    }

    const url = new URL(request.url);
    const { pathname } = url;
    const { method } = request;

    try {
      const response = await route(pathname, method, request, env);
      for (const [key, value] of Object.entries(headers)) {
        response.headers.set(key, value);
      }
      return response;
    } catch (err) {
      const response = errorResponse(500, "INTERNAL_ERROR", (err as Error).message);
      for (const [key, value] of Object.entries(headers)) {
        response.headers.set(key, value);
      }
      return response;
    }
  },
} satisfies ExportedHandler<Env>;

async function route(pathname: string, method: string, request: Request, env: Env): Promise<Response> {
  if (pathname === "/runs" && method === "POST") {
    return handleCreateRun(request, env);
  }

  if (pathname === "/public/runs" && method === "GET") {
    return handleListPublicRuns(request, env);
  }

  if (pathname === "/relay/startgg" && method === "POST") {
    return handleStartggRelay(request);
  }

  const settingsMatch = pathname.match(/^\/settings\/([^/]+)$/);
  if (settingsMatch) {
    const targetId = decodeURIComponent(settingsMatch[1]);
    if (method === "GET") return handleGetSettings(targetId, env);
    if (method === "PUT") return handlePutSettings(targetId, request, env);
  }

  const publicResultMatch = pathname.match(/^\/public\/results\/([^/]+)$/);
  if (publicResultMatch && method === "GET") {
    return handleGetPublicResult(publicResultMatch[1], env);
  }

  const runMatch = pathname.match(/^\/runs\/([^/]+)(\/(complete|fail|writeback-recorded))?$/);
  if (runMatch) {
    const [, runId, , action] = runMatch;
    if (!action && method === "GET") return handleGetRun(runId, env);
    if (action === "complete" && method === "POST") return handleCompleteRun(runId, request, env);
    if (action === "fail" && method === "POST") return handleFailRun(runId, request, env);
    if (action === "writeback-recorded" && method === "POST") return handleWritebackRecorded(runId, env);
  }

  return errorResponse(404, "NOT_FOUND", "no matching route");
}
