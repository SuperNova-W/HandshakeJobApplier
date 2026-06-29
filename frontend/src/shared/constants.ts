import type { RuntimeState, ScreeningPrefs, Settings } from "./contracts";

export const BACKEND_BASE_URL = (
  import.meta.env.VITE_BACKEND_BASE_URL || "http://127.0.0.1:8765"
).replace(/\/+$/, "");

// Google OAuth *Web application* client ID, used with chrome.identity.
// launchWebAuthFlow. The legacy getAuthToken / "Chrome App" client flow was
// disabled by Google's Oct-2023 custom-URI-scheme restriction, so sign-in uses
// launchWebAuthFlow instead. The backend's GOOGLE_OAUTH_CLIENT_ID (token audience
// check) must match this value.
export const GOOGLE_OAUTH_CLIENT_ID = (import.meta.env.VITE_GOOGLE_OAUTH_CLIENT_ID || "").trim();

export const GOOGLE_OAUTH_SCOPES = [
  "openid",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile"
];
export const DEFAULT_SETTINGS: Settings = {
  applyDelayMs: 1500,
  maxPagesPerRun: 10,
  stopOnError: false
};

// Used when the backend is unreachable or hasn't stored prefs yet. Defaulting
// work-authorization to true matches the common case (a US student applying);
// no locations + not-anywhere means location questions default to "No".
export const DEFAULT_SCREENING: ScreeningPrefs = {
  usWorkAuthorized: true,
  softwareEngineeringDegree: true,
  speaksEnglish: true,
  relocateAnywhere: false,
  locations: []
};

export function normalizeScreeningPrefs(prefs?: Partial<ScreeningPrefs> | null): ScreeningPrefs {
  return {
    usWorkAuthorized: prefs?.usWorkAuthorized ?? DEFAULT_SCREENING.usWorkAuthorized,
    softwareEngineeringDegree:
      prefs?.softwareEngineeringDegree ?? DEFAULT_SCREENING.softwareEngineeringDegree,
    speaksEnglish: prefs?.speaksEnglish ?? DEFAULT_SCREENING.speaksEnglish,
    relocateAnywhere: prefs?.relocateAnywhere ?? DEFAULT_SCREENING.relocateAnywhere,
    locations: Array.isArray(prefs?.locations) ? prefs.locations : []
  };
}

export function createInitialRuntimeState(): RuntimeState {
  return {
    backendHealth: "unknown",
    backendVersion: null,
    backendDatabase: null,
    runStatus: "IDLE",
    runId: null,
    tabId: null,
    sourceUrl: null,
    appliedCount: 0,
    skippedCount: 0,
    failedCount: 0,
    lastError: null,
    startedAt: null,
    settings: DEFAULT_SETTINGS,
    recentRuns: []
  };
}
