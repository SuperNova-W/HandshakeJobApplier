import { BACKEND_BASE_URL } from "./constants";
import type {
  BackendHealth,
  BackendUser,
  CoverLetterResult,
  CreateRunResponse,
  DocumentMeta,
  DocumentType,
  JobContext,
  ApplicationStatus,
  OtherDocsResult,
  RunStatus,
  RunSummary,
  ScreeningPrefs,
  Settings,
  StoredDocument
} from "./contracts";

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BACKEND_BASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers
    }
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
    throw new Error(detail || `${init?.method ?? "GET"} ${path} failed with ${response.status}`);
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
  return requestJson<BackendUser>("/api/users/google", {
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

export function generateCoverLetter(job: JobContext) {
  return requestJson<CoverLetterResult>("/api/cover-letter", {
    method: "POST",
    body: JSON.stringify(job)
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
  const response = await fetch(`${BACKEND_BASE_URL}/api/cover-letter/pdf`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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
export function generateOtherDoc(req: {
  jobTitle: string;
  company: string;
  jobDescription: string;
  instructions: string;
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
  const response = await fetch(`${BACKEND_BASE_URL}/api/other-docs/pdf`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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

// ─── Documents ─────────────────────────────────────────────────────────────────

export function listDocuments() {
  return requestJson<DocumentMeta[]>("/api/documents");
}

// Multipart upload — must NOT set Content-Type so the browser adds the boundary,
// so this bypasses requestJson (which forces application/json).
export async function uploadDocument(
  docType: DocumentType,
  file: File,
  label?: string
): Promise<DocumentMeta> {
  const form = new FormData();
  form.append("docType", docType);
  form.append("file", file);
  if (label) form.append("label", label);

  const response = await fetch(`${BACKEND_BASE_URL}/api/documents`, {
    method: "POST",
    body: form
  });

  if (!response.ok) {
    let detail = "";
    try {
      const body = (await response.json()) as { message?: string; error?: string };
      detail = body?.message || body?.error || "";
    } catch {
      /* ignore */
    }
    throw new Error(detail || `Upload failed with ${response.status}`);
  }
  return (await response.json()) as DocumentMeta;
}

export function deleteDocument(id: string) {
  return requestJson<void>(`/api/documents/${id}`, { method: "DELETE" });
}

// Fetches the latest stored document of a given type (e.g. the user's TRANSCRIPT)
// as base64, or null if none is on file (404). Called from the background worker
// — content scripts can't reach the backend (CORS allows only the extension
// origin), and Files don't survive chrome messaging, so the bytes travel as
// base64 and the content script rebuilds the File to drop into the apply modal.
export async function documentBase64ByType(docType: DocumentType): Promise<StoredDocument | null> {
  const response = await fetch(
    `${BACKEND_BASE_URL}/api/documents/by-type/${encodeURIComponent(docType)}/content`
  );
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`Fetching the stored ${docType} document failed with ${response.status}`);
  }

  const contentType = response.headers.get("content-type") || "application/octet-stream";
  const disposition = response.headers.get("content-disposition") || "";
  const match = disposition.match(/filename="?([^"]+)"?/i);
  const filename = match?.[1] || `${docType.toLowerCase()}.pdf`;

  const buffer = await response.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return { base64: btoa(binary), filename, contentType };
}

export function documentContentUrl(id: string): string {
  return `${BACKEND_BASE_URL}/api/documents/${id}/content`;
}
