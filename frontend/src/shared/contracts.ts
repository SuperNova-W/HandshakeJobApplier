export type BackendHealthStatus = "unknown" | "online" | "offline";
export type PageSupportStatus = "unknown" | "supported" | "unsupported";
export type PopupRunStatus = "IDLE" | "RUNNING" | "STOPPING" | "COMPLETED" | "STOPPED" | "FAILED";
export type RunStatus = "RUNNING" | "COMPLETED" | "STOPPED" | "FAILED";
export type ApplicationStatus = "APPLIED" | "SKIPPED" | "FAILED";
export type SkipReason =
  | "ALREADY_APPLIED"
  | "APPLY_EXTERNALLY"
  | "MULTI_STEP_FORM"
  | "SCREENING_QUESTIONS"
  | "NO_APPLY_BUTTON"
  | "DISABLED_BUTTON"
  | "UNSUPPORTED_PAGE"
  // Job required documents beyond the resume ("Attach other required documents").
  | "SAVED_FOR_LATER"
  | "OTHER_DOCS_REQUIRED"
  | "OTHER_DOCS_UPLOAD_FAILED"
  | "USER_STOPPED"
  // Clicking the list card never loaded its detail panel (URL never became
  // /job-search/<id>), so we couldn't read/apply to it — skipped rather than
  // mis-applying to whatever job was still showing.
  | "SELECT_FAILED"
  // The apply modal asked for a transcript but none is stored on the options
  // page (or the upload field couldn't be filled), so we can't complete it.
  | "TRANSCRIPT_REQUIRED"
  // The apply modal asked for a cover letter and the agent generated one, but the
  // user declined to submit it in the review overlay.
  | "COVER_LETTER_DECLINED"
  // Couldn't auto-generate/attach a required cover letter (agent not configured,
  // generation error, or the upload field couldn't be filled).
  | "COVER_LETTER_FAILED"
  // We clicked Apply and filled what we could, but Submit never completed — the
  // application stayed open with a disabled Submit (an unmet required field, or a
  // document Handshake never finished accepting). Skipped rather than recording a
  // false "applied".
  | "SUBMIT_INCOMPLETE";

export interface BackendHealth {
  status: "UP" | "DOWN";
  version: string;
}

export interface Settings {
  applyDelayMs: number;
  maxPagesPerRun: number;
  stopOnError: boolean;
}

export interface RunSummary {
  runId: string;
  startedAt: string;
  endedAt: string | null;
  status: RunStatus;
  sourceUrl: string;
  appliedCount: number;
  skippedCount: number;
  failedCount: number;
  errorMessage: string | null;
}

export interface CreateRunResponse {
  runId: string;
  status: "RUNNING";
  startedAt: string;
}

export interface JobResult {
  handshakeJobId: string;
  jobUrl: string;
  title: string;
  company: string;
  status: ApplicationStatus;
  skipReason?: SkipReason;
  errorMessage?: string;
}

export interface RuntimeState {
  backendHealth: BackendHealthStatus;
  backendVersion: string | null;
  runStatus: PopupRunStatus;
  runId: string | null;
  tabId: number | null;
  sourceUrl: string | null;
  appliedCount: number;
  skippedCount: number;
  failedCount: number;
  lastError: string | null;
  startedAt: string | null;
  settings: Settings;
  recentRuns: RunSummary[];
}

export interface PageContext {
  support: PageSupportStatus;
  url: string | null;
}

export interface PageDiagnostics {
  url: string;
  pageSupport: PageSupportStatus;
  route: "job-detail" | "job-search" | "supported-other";
  isOnJobDetailPage: boolean;
  selectedJobId: string | null;
  currentPage: number;
  visibleJobCardCount: number;
  cardSamples: Array<{
    id: string;
    title: string;
    isSearch: boolean;
  }>;
  currentJob: {
    title: string;
    company: string;
  };
  gates: {
    alreadyApplied: boolean;
    externalApply: boolean;
    applyButtonFound: boolean;
    applyButtonText: string | null;
    screeningQuestionsVisible: boolean;
    otherRequiredDocsVisible: boolean;
  };
  session: {
    runLoopActive: boolean;
    activeRunId: string | null;
    activeMode: "detail" | "list" | null;
    shouldStop: boolean | null;
    seenCount: number;
    processed: number | null;
  };
  counts: {
    totalButtons: number;
    totalAnchors: number;
    jobResultCardHooks: number;
  };
  buttonsSample: string[];
}

export interface JobContext {
  jobTitle: string;
  company: string;
  jobDescription: string;
}

export interface CoverLetterResult {
  coverLetter: string;
  model: string;
  generatedAt: string;
}

// Result of the RAG document agent: the drafted document the employer requested,
// the model that wrote it, and the stored materials (by label) it was grounded
// in — surfaced so the user can see what the draft drew on.
export interface OtherDocsResult {
  document: string;
  model: string;
  generatedAt: string;
  sources: string[];
}

// The user's stored answers to common Handshake screening questions, used by the
// content script to fill Yes/No radios instead of skipping the job.
// `relocateAnywhere` makes any location question answer "Yes"; otherwise a
// location question is "Yes" only when its text mentions one of `locations`.
export interface ScreeningPrefs {
  usWorkAuthorized: boolean;
  softwareEngineeringDegree: boolean;
  speaksEnglish: boolean;
  relocateAnywhere: boolean;
  locations: string[];
}

export interface GoogleUserProfile {
  backendUserId: string | null;
  id: string | null;
  email: string;
  name: string | null;
  picture: string | null;
  authenticatedAt: string;
}

// The verified Google profile returned by sign-in. Stateless backend: `id` IS
// the Google subject; nothing is stored server-side.
export interface BackendUser {
  id: string;
  googleSubject: string;
  email: string;
  displayName: string | null;
  pictureUrl: string | null;
  authenticatedAt: string;
}

export interface BackendAuthSession {
  user: BackendUser;
  token: string;
}

export interface OnboardingState {
  complete: boolean;
  completedAt: string | null;
  user: GoogleUserProfile | null;
}

// Outcome of injecting the rendered cover-letter PDF into Handshake's apply modal
// and (when possible) clicking Submit. `attached` = the file is on the cover-letter
// input; `submitted` = the Submit Application button was enabled and clicked.
export interface AttachResult {
  attached: boolean;
  submitted: boolean;
  message: string;
}

export type DocumentType = "RESUME" | "COVER_LETTER" | "TRANSCRIPT" | "GITHUB_PROJECT" | "OTHER";

export interface DocumentMeta {
  id: string;
  docType: DocumentType;
  label: string | null;
  filename: string;
  contentType: string;
  sizeBytes: number;
  uploadedAt: string;
}

// A stored document's bytes shipped across chrome messaging. Blobs/Files don't
// survive structured cloning between the background worker and content script,
// so we send the content as base64 and rebuild the File on the content side.
export interface StoredDocument {
  base64: string;
  filename: string;
  contentType: string;
}

export type ExtensionMessage =
  | { type: "runtime/get" }
  | { type: "runtime/refresh" }
  | { type: "runtime/get-onboarding" }
  | { type: "runtime/google-login" }
  | { type: "runtime/google-switch-account" }
  | { type: "runtime/google-logout" }
  | { type: "runtime/complete-onboarding" }
  | { type: "runtime/start" }
  | { type: "runtime/stop" }
  | { type: "runtime/diagnose-page" }
  | { type: "runtime/generate-cover-letter" }
  | { type: "runtime/attach-cover-letter"; coverLetter: string }
  // Sent from the content script mid-run to fetch a stored document (e.g. the
  // user's transcript) by type — the background worker proxies the backend call
  // because content scripts are blocked by CORS.
  | { type: "runtime/get-document"; docType: DocumentType }
  // Mid-run, in-page cover-letter flow: the content script (which already knows
  // the open job) asks the background worker to call the agent and render a PDF.
  | { type: "runtime/generate-cover-letter-text"; job: JobContext }
  | {
      type: "runtime/render-cover-letter-pdf";
      coverLetter: string;
      company: string;
      jobTitle: string;
    }
  // Mid-run "other required documents" flow: the content script asks the RAG
  // agent to draft the employer-requested document from the user's stored
  // materials, then to render the reviewed text to a PDF. `instructions` is the
  // employer's ask scraped from the apply modal.
  | { type: "runtime/generate-other-doc"; job: JobContext; instructions: string }
  | {
      type: "runtime/render-other-doc-pdf";
      document: string;
      company: string;
      jobTitle: string;
    }
  | { type: "content/job-processed"; runId: string; result: JobResult }
  | {
      type: "content/run-complete";
      runId: string;
      finalStatus: Exclude<RunStatus, "RUNNING">;
      errorMessage?: string | null;
    }
  | { type: "content/debug-log"; label: string; payload: unknown };

export type ContentMessage =
  | { type: "content/status" }
  | {
      type: "content/start-run";
      runId: string;
      settings: Settings;
      screening: ScreeningPrefs;
    }
  | { type: "content/diagnose-page" }
  | { type: "content/stop-run" }
  | { type: "content/scrape-job" }
  | { type: "content/attach-cover-letter"; pdfBase64: string; filename: string };

export type ContentResponse =
  | {
      ok: true;
      activeRunId: string | null;
      runActive: boolean;
    }
  | {
      ok: true;
      pageSupport: PageSupportStatus;
      discoveredJobCount: number;
    }
  | { ok: true; diagnostics: PageDiagnostics }
  | { ok: true; job: JobContext }
  | { ok: true; attach: AttachResult }
  | { ok: false; error: string };

export type ExtensionResponse =
  | { ok: true; state: RuntimeState }
  | { ok: true; onboarding: OnboardingState }
  | { ok: true; user: GoogleUserProfile }
  | { ok: true; signedOut: true }
  | { ok: true; shouldStop: boolean }
  | { ok: true; diagnostics: PageDiagnostics }
  | { ok: true; coverLetter: CoverLetterResult }
  // The RAG agent's drafted document, ready for the in-page review overlay.
  | { ok: true; otherDoc: OtherDocsResult }
  | { ok: true; attach: AttachResult }
  // `document` is null when no document of the requested type is stored.
  | { ok: true; document: StoredDocument | null }
  // A rendered PDF (base64) ready to drop into the apply modal — used by both the
  // cover-letter and other-docs flows.
  | { ok: true; pdf: { base64: string; filename: string } }
  | { ok: false; error: string };
