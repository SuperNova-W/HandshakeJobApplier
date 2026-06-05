import type { RuntimeState, ScreeningPrefs, Settings } from "./contracts";

export const BACKEND_BASE_URL = "http://127.0.0.1:8765";
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
  relocateAnywhere: false,
  locations: []
};

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
