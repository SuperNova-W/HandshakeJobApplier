export type BackendHealthStatus = "unknown" | "online" | "offline";
export type PageSupportStatus = "unknown" | "supported" | "unsupported";
export type PopupRunStatus = "IDLE" | "RUNNING" | "STOPPED";

export interface RuntimeState {
  backendHealth: BackendHealthStatus;
  runStatus: PopupRunStatus;
  appliedCount: number;
  skippedCount: number;
  failedCount: number;
  lastError: string | null;
  startedAt: string | null;
}

export interface PageContext {
  support: PageSupportStatus;
  url: string | null;
}

export type ExtensionMessage =
  | { type: "runtime/get" }
  | { type: "runtime/start-placeholder" }
  | { type: "runtime/stop-placeholder" };

export type ExtensionResponse =
  | { ok: true; state: RuntimeState }
  | { ok: false; error: string };
