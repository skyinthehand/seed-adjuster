// Browser-only Google OAuth via Google Identity Services (research.md #4).
// No authorization-code exchange, no refresh token, nothing sent to control-plane.
// The access token lives in memory for the current page session only.

const GIS_SCRIPT_SRC = "https://accounts.google.com/gsi/client";
const SCOPES = "https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.file";

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient(config: {
            client_id: string;
            scope: string;
            callback: (response: { access_token?: string; error?: string }) => void;
          }): { requestAccessToken: (opts?: { prompt?: string }) => void };
        };
      };
    };
  }
}

let accessToken: string | null = null;
let gisScriptPromise: Promise<void> | null = null;

function loadGisScript(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (!gisScriptPromise) {
    gisScriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = GIS_SCRIPT_SRC;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Google Identity Servicesの読み込みに失敗しました"));
      document.head.appendChild(script);
    });
  }
  return gisScriptPromise;
}

/**
 * Kicks off loading the GIS script ahead of time (e.g. on page mount), so that by the time
 * the user clicks "connect", requestAccessToken() below fires synchronously within the click
 * handler. Without this, the network fetch for the script can eat enough time between the
 * click and requestAccessToken() that browsers silently block the popup as not being a
 * direct result of user interaction.
 */
export function preloadGoogleIdentityServices(): void {
  loadGisScript().catch(() => {
    // Swallowed here; connectGoogleAccount() surfaces the same failure to the caller.
  });
}

/** Opens the Google consent flow if needed and resolves once an access token is available. */
export async function connectGoogleAccount(clientId: string): Promise<string> {
  if (!clientId) {
    throw new Error(
      "Google OAuthクライアントIDが設定されていません(VITE_GOOGLE_OAUTH_CLIENT_ID)。デプロイ設定を確認してください。",
    );
  }
  await loadGisScript();
  return new Promise((resolve, reject) => {
    const client = window.google!.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPES,
      callback: (response) => {
        if (response.error || !response.access_token) {
          reject(new Error(response.error ?? "Google認証に失敗しました"));
          return;
        }
        accessToken = response.access_token;
        resolve(accessToken);
      },
    });
    client.requestAccessToken();
  });
}

export function getGoogleAccessToken(): string | null {
  return accessToken;
}

export function isGoogleConnected(): boolean {
  return accessToken !== null;
}

/** Clears the in-memory token (e.g. on 401 from Sheets API — see FR-013 edge case). */
export function clearGoogleAccessToken(): void {
  accessToken = null;
}
