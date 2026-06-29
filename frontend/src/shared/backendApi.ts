import { BACKEND_BASE_URL } from "./constants";
import type {
  BackendAuthSession,
  BackendHealth,
  BackendUser,
  CoverLetterResult,
  CreateRunResponse,
  JobContext,
  ApplicationStatus,
  OtherDocsResult,
  RunStatus,
  RunSummary,
  ScreeningPrefs,
  Settings
} from "./contracts";
import { readSessionToken } from "./onboarding";

export class BackendApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = "BackendApiError";
  }
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const sessionToken = await readSessionToken();
  if (sessionToken && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${sessionToken}`);
  }

  const response = await fetch(`${BACKEND_BASE_URL}${path}`, {
    ...init,
    headers
  });

  if (!response.ok) {
    // Surface the backend's structured error message (set by GlobalExceptionHandler)
    // instead of an opaque "failed with 500" — important for the cover-letter flow,
    // which returns actionable messages (no API key, no resume on file, etc.).
    let detail = "";
    try {
      const body = (await response.json()) as { message?: string; error?: string };
      detail = body?.message || body?.error || "";
    } catch {
      /* non-JSON error body */
    }
    throw new BackendApiError(
      detail || `${init?.method ?? "GET"} ${path} failed with ${response.status}`,
      response.status
    );
  }

  if (response.status === 204 || response.headers.get("content-length") === "0") {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export function getBackendHealth() {
  return requestJson<BackendHealth>("/api/health");
}

export function getSettings() {
  return requestJson<Settings>("/api/settings");
}

export function getRecentRuns(limit = 5) {
  return requestJson<RunSummary[]>(`/api/runs?limit=${limit}`);
}

export function createRun(sourceUrl: string, startedAt: string) {
  return requestJson<CreateRunResponse>("/api/runs", {
    method: "POST",
    body: JSON.stringify({ sourceUrl, startedAt })
  });
}

export function finalizeRun(
  runId: string,
  status: Exclude<RunStatus, "RUNNING">,
  errorMessage: string | null
) {
  return requestJson<RunSummary>(`/api/runs/${runId}`, {
    method: "PATCH",
    body: JSON.stringify({ status, endedAt: new Date().toISOString(), errorMessage })
  });
}

export function recordRunOutcome(runId: string, status: ApplicationStatus) {
  return requestJson<void>(`/api/runs/${runId}/outcomes`, {
    method: "POST",
    body: JSON.stringify({ status })
  });
}

export function getScreeningPrefs() {
  return requestJson<ScreeningPrefs>("/api/content/screening");
}

export function saveScreeningPrefs(prefs: ScreeningPrefs) {
  return requestJson<ScreeningPrefs>("/api/content/screening", {
    method: "PUT",
    body: JSON.stringify(prefs)
  });
}

export function authenticateGoogleUser(accessToken: string) {
  return requestJson<BackendAuthSession>("/api/users/google", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` }
  });
}

export function getCurrentUser() {
  return requestJson<BackendUser>("/api/users/current");
}

export function completeCurrentUserOnboarding() {
  return requestJson<BackendUser>("/api/users/current/onboarding", {
    method: "PUT"
  });
}

export function signOutCurrentUser() {
  return requestJson<void>("/api/users/current", {
    method: "DELETE"
  });
}

// The resume text is extracted from the user's locally stored resume and sent
// per request — the backend never stores it.
export function generateCoverLetter(job: JobContext, resumeText: string | null) {
  return requestJson<CoverLetterResult>("/api/cover-letter", {
    method: "POST",
    body: JSON.stringify({ ...job, resumeText })
  });
}

// Renders the (reviewed) letter to a PDF and returns it base64-encoded. The
// content script can't reconstruct a Blob across chrome messaging, so we ship
// the bytes as base64 and rebuild the File on the other side. Called from the
// background worker (chrome-extension origin) — a content script can't hit the
// backend directly because CORS only allows the extension origin.
export async function coverLetterPdfBase64(req: {
  coverLetter: string;
  company: string;
  jobTitle: string;
}): Promise<string> {
  const headers = await authenticatedHeaders({ "Content-Type": "application/json" });
  const response = await fetch(`${BACKEND_BASE_URL}/api/cover-letter/pdf`, {
    method: "POST",
    headers,
    body: JSON.stringify(req)
  });

  if (!response.ok) {
    let detail = "";
    try {
      const body = (await response.json()) as { message?: string; error?: string };
      detail = body?.message || body?.error || "";
    } catch {
      /* non-JSON error body */
    }
    throw new Error(detail || `Cover-letter PDF render failed with ${response.status}`);
  }

  const buffer = await response.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// ─── Other-docs RAG agent ──────────────────────────────────────────────────────

// Asks the backend agent to draft the employer-requested document from the user's
// stored materials (resume, GitHub project, other docs) plus the scraped job
// context and the employer's instructions.
// `sources` is the knowledge base (resume, GitHub project, transcript, other
// docs) the extension extracted from the user's locally stored documents and
// sends per request — the backend never stores it.
export function generateOtherDoc(req: {
  jobTitle: string;
  company: string;
  jobDescription: string;
  instructions: string;
  sources: { label: string; text: string }[];
}) {
  return requestJson<OtherDocsResult>("/api/other-docs/generate", {
    method: "POST",
    body: JSON.stringify(req)
  });
}

// Renders the (reviewed) agent document to a PDF and returns it base64-encoded,
// to attach into Handshake's "other required documents" field. Mirrors
// coverLetterPdfBase64 — bytes travel as base64 because Files don't survive
// chrome messaging, and only the extension origin is allowed by CORS.
export async function otherDocPdfBase64(req: {
  document: string;
  company: string;
  jobTitle: string;
}): Promise<string> {
  const headers = await authenticatedHeaders({ "Content-Type": "application/json" });
  const response = await fetch(`${BACKEND_BASE_URL}/api/other-docs/pdf`, {
    method: "POST",
    headers,
    body: JSON.stringify(req)
  });

  if (!response.ok) {
    let detail = "";
    try {
      const body = (await response.json()) as { message?: string; error?: string };
      detail = body?.message || body?.error || "";
    } catch {
      /* non-JSON error body */
    }
    throw new Error(detail || `Document PDF render failed with ${response.status}`);
  }

  const buffer = await response.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

async function authenticatedHeaders(initial?: HeadersInit): Promise<Headers> {
  const headers = new Headers(initial);
  const sessionToken = await readSessionToken();
  if (sessionToken) {
    headers.set("Authorization", `Bearer ${sessionToken}`);
  }
  return headers;
}
