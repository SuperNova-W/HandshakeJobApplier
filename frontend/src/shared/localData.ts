import type {
  ApplicationStatus,
  CreateRunResponse,
  RunStatus,
  RunSummary,
  ScreeningPrefs
} from "./contracts";
import { DEFAULT_SCREENING, normalizeScreeningPrefs } from "./constants";

// User data that used to live in the backend's SQLite tables now lives here in
// chrome.storage.local, alongside the documents and resume that were always
// stored browser-side. The backend keeps nothing per-user; it only verifies
// sign-in and generates documents. Function names/shapes mirror the old
// backendApi endpoints so call sites read the same.

export const SCREENING_PREFS_KEY = "handshook:screeningPrefs";
export const RUNS_KEY = "handshook:runs";

// Replaces the old table's unbounded growth; the popup shows the 5 most recent.
const MAX_STORED_RUNS = 25;

async function readRuns(): Promise<RunSummary[]> {
  if (!globalThis.chrome?.storage?.local) return [];
  const stored = await globalThis.chrome.storage.local.get(RUNS_KEY);
  const runs = stored[RUNS_KEY];
  return Array.isArray(runs) ? (runs as RunSummary[]) : [];
}

async function writeRuns(runs: RunSummary[]): Promise<void> {
  if (!globalThis.chrome?.storage?.local) return;
  await globalThis.chrome.storage.local.set({ [RUNS_KEY]: runs.slice(0, MAX_STORED_RUNS) });
}

export async function getScreeningPrefs(): Promise<ScreeningPrefs> {
  if (!globalThis.chrome?.storage?.local) return DEFAULT_SCREENING;
  const stored = await globalThis.chrome.storage.local.get(SCREENING_PREFS_KEY);
  return normalizeScreeningPrefs(
    (stored[SCREENING_PREFS_KEY] as Partial<ScreeningPrefs> | undefined) ?? null
  );
}

export async function saveScreeningPrefs(prefs: ScreeningPrefs): Promise<ScreeningPrefs> {
  const normalized = normalizeScreeningPrefs(prefs);
  if (globalThis.chrome?.storage?.local) {
    await globalThis.chrome.storage.local.set({ [SCREENING_PREFS_KEY]: normalized });
  }
  return normalized;
}

export async function createRun(sourceUrl: string, startedAt: string): Promise<CreateRunResponse> {
  const run: RunSummary = {
    runId: crypto.randomUUID(),
    startedAt,
    endedAt: null,
    status: "RUNNING",
    sourceUrl,
    appliedCount: 0,
    skippedCount: 0,
    failedCount: 0,
    errorMessage: null
  };
  await writeRuns([run, ...(await readRuns())]);
  return { runId: run.runId, status: "RUNNING", startedAt };
}

// Upserts instead of failing when the run isn't stored anymore (e.g. storage was
// cleared mid-run): the MV3 run-adoption paths expect finalize/outcome calls to
// keep working for a run the background worker no longer holds in memory.
export async function finalizeRun(
  runId: string,
  status: Exclude<RunStatus, "RUNNING">,
  errorMessage: string | null
): Promise<RunSummary> {
  const runs = await readRuns();
  const existing = runs.find((run) => run.runId === runId);
  const finalized: RunSummary = {
    ...(existing ?? {
      runId,
      startedAt: new Date().toISOString(),
      sourceUrl: "",
      appliedCount: 0,
      skippedCount: 0,
      failedCount: 0
    }),
    status,
    endedAt: new Date().toISOString(),
    errorMessage
  };
  await writeRuns([finalized, ...runs.filter((run) => run.runId !== runId)]);
  return finalized;
}

export async function recordRunOutcome(runId: string, status: ApplicationStatus): Promise<void> {
  const runs = await readRuns();
  const existing = runs.find((run) => run.runId === runId) ?? {
    runId,
    startedAt: new Date().toISOString(),
    endedAt: null,
    status: "RUNNING" as const,
    sourceUrl: "",
    appliedCount: 0,
    skippedCount: 0,
    failedCount: 0,
    errorMessage: null
  };
  const updated: RunSummary = {
    ...existing,
    appliedCount: existing.appliedCount + (status === "APPLIED" ? 1 : 0),
    skippedCount: existing.skippedCount + (status === "SKIPPED" ? 1 : 0),
    failedCount: existing.failedCount + (status === "FAILED" ? 1 : 0)
  };
  await writeRuns([updated, ...runs.filter((run) => run.runId !== runId)]);
}

export async function getRecentRuns(limit = 5): Promise<RunSummary[]> {
  return (await readRuns()).slice(0, limit);
}
