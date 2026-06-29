import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { DocumentMeta, DocumentType } from "./contracts";
import { saveDocument } from "./localDocuments";

// pdf.js runs its parser in a Web Worker. We point it at the worker bundled into
// the extension (first-party code — no remote script), so text extraction runs
// fully locally in the options page. This module is the only one that pulls in
// pdf.js, so it must never be imported by the background worker or content script.
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

// Extracts plain text from an uploaded document for use as AI context. PDFs go
// through pdf.js; text/markdown is read directly; other formats (DOCX, images)
// yield null — matching the old server-side extractor's behavior.
export async function extractDocumentText(file: File): Promise<string | null> {
  const type = (file.type || "").toLowerCase();
  const name = (file.name || "").toLowerCase();

  if (type.includes("pdf") || name.endsWith(".pdf")) {
    try {
      const data = new Uint8Array(await file.arrayBuffer());
      const pdf = await pdfjs.getDocument({ data }).promise;
      let out = "";
      for (let page = 1; page <= pdf.numPages; page++) {
        const content = await (await pdf.getPage(page)).getTextContent();
        out += content.items.map((item) => ("str" in item ? item.str : "")).join(" ") + "\n";
      }
      return out.trim() || null;
    } catch {
      return null;
    }
  }

  if (type.startsWith("text/") || name.endsWith(".txt") || name.endsWith(".md")) {
    return (await file.text()).trim() || null;
  }

  return null;
}

// Convenience wrapper for the options page: extract the document's text, then
// persist the file + text to local storage. Keeps the upload call site identical
// to the old backend uploadDocument(docType, file, label).
export async function uploadDocument(
  docType: DocumentType,
  file: File,
  label?: string
): Promise<DocumentMeta> {
  const text = await extractDocumentText(file);
  return saveDocument(docType, file, label ?? null, text);
}
