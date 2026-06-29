import type { DocumentMeta, DocumentType, StoredDocument } from "./contracts";

// Documents live entirely in the browser — never on the server. They are kept in
// chrome.storage.local (not a database, no IndexedDB): one array of records under
// a single key. Each record carries the file bytes (base64) plus, when we could
// read it, the extracted plain text the AI features use as grounding context.
//
// This module is intentionally free of any PDF/parsing dependency so it is safe
// to import from the background service worker. Text extraction lives in
// documentText.ts and runs only in the options page at upload time.
const STORAGE_KEY = "handshook.documents";

export interface LocalDocumentRecord extends DocumentMeta {
  base64: string;
  text: string | null;
}

// FIXED-type slots hold exactly one document each; OTHER documents accumulate.
const FIXED_TYPES: DocumentType[] = ["RESUME", "COVER_LETTER", "TRANSCRIPT", "GITHUB_PROJECT"];

async function readAll(): Promise<LocalDocumentRecord[]> {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const list = stored[STORAGE_KEY];
  return Array.isArray(list) ? (list as LocalDocumentRecord[]) : [];
}

async function writeAll(records: LocalDocumentRecord[]): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: records });
}

function toMeta(record: LocalDocumentRecord): DocumentMeta {
  return {
    id: record.id,
    docType: record.docType,
    label: record.label,
    filename: record.filename,
    contentType: record.contentType,
    sizeBytes: record.sizeBytes,
    uploadedAt: record.uploadedAt
  };
}

function byNewestFirst(a: LocalDocumentRecord, b: LocalDocumentRecord): number {
  return a.uploadedAt < b.uploadedAt ? 1 : a.uploadedAt > b.uploadedAt ? -1 : 0;
}

function latestByType(
  all: LocalDocumentRecord[],
  docType: DocumentType
): LocalDocumentRecord | null {
  return all.filter((d) => d.docType === docType).sort(byNewestFirst)[0] ?? null;
}

async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export async function listDocuments(): Promise<DocumentMeta[]> {
  const all = await readAll();
  return all.sort(byNewestFirst).map(toMeta);
}

// Persists a document to local storage. Uploading a FIXED-type document replaces
// any existing one of that type (one resume, one transcript, …); OTHER documents
// accumulate. `text` is the extracted plain text (or null) used as AI context.
export async function saveDocument(
  docType: DocumentType,
  file: File,
  label: string | null,
  text: string | null
): Promise<DocumentMeta> {
  const all = await readAll();
  const remaining = FIXED_TYPES.includes(docType)
    ? all.filter((d) => d.docType !== docType)
    : all;

  const record: LocalDocumentRecord = {
    id: crypto.randomUUID(),
    docType,
    label: label && label.trim() ? label.trim() : null,
    filename: file.name || "upload",
    contentType: file.type || "application/octet-stream",
    sizeBytes: file.size,
    uploadedAt: new Date().toISOString(),
    base64: await fileToBase64(file),
    text: text && text.trim() ? text.trim() : null
  };

  remaining.push(record);
  await writeAll(remaining);
  return toMeta(record);
}

export async function deleteDocument(id: string): Promise<void> {
  const all = await readAll();
  await writeAll(all.filter((d) => d.id !== id));
}

// The latest stored document of a type, as base64 — used by the auto-apply flow
// (via the background worker) to attach e.g. the user's transcript into the apply
// modal. Returns null when none is on file.
export async function getStoredDocumentByType(
  docType: DocumentType
): Promise<StoredDocument | null> {
  const doc = latestByType(await readAll(), docType);
  return doc ? { base64: doc.base64, filename: doc.filename, contentType: doc.contentType } : null;
}

// The resume's extracted text, sent to the cover-letter generator as context.
export async function getResumeText(): Promise<string | null> {
  const resume = latestByType(await readAll(), "RESUME");
  return resume?.text?.trim() || null;
}

// The knowledge base for the other-docs agent, mirroring the old server-side
// gather(): resume, GitHub project, transcript, then any OTHER documents. Only
// sources whose text could be extracted are included.
export async function getKnowledgeBaseSources(): Promise<{ label: string; text: string }[]> {
  const all = await readAll();
  const sources: { label: string; text: string }[] = [];

  const addFixed = (docType: DocumentType, label: string) => {
    const doc = latestByType(all, docType);
    if (doc?.text && doc.text.trim()) sources.push({ label, text: doc.text.trim() });
  };
  addFixed("RESUME", "Resume");
  addFixed("GITHUB_PROJECT", "GitHub project");
  addFixed("TRANSCRIPT", "Transcript");

  for (const doc of all.filter((d) => d.docType === "OTHER").sort(byNewestFirst)) {
    if (doc.text && doc.text.trim()) {
      const label = doc.label && doc.label.trim() ? doc.label.trim() : doc.filename;
      sources.push({ label: `Document: ${label}`, text: doc.text.trim() });
    }
  }
  return sources;
}

// Rebuilds a stored file and triggers a browser download. Replaces the old
// backend download endpoint; runs in the options page (which has DOM access).
export async function downloadDocument(id: string): Promise<void> {
  const doc = (await readAll()).find((d) => d.id === id);
  if (!doc) throw new Error("That document is no longer in local storage.");
  const bytes = Uint8Array.from(atob(doc.base64), (c) => c.charCodeAt(0));
  const blob = new Blob([bytes], { type: doc.contentType || "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = doc.filename || "document";
  anchor.click();
  URL.revokeObjectURL(url);
}
