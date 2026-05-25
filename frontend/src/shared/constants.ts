import type { RuntimeState } from "./contracts";

export const BACKEND_BASE_URL = "http://127.0.0.1:8765";

export function createInitialRuntimeState(): RuntimeState {
  return {
    backendHealth: "unknown",
    runStatus: "IDLE",
    appliedCount: 0,
    skippedCount: 0,
    failedCount: 0,
    lastError: null,
    startedAt: null
  };
}
