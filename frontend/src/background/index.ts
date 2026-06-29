import {
  authenticateGoogleUser,
  coverLetterPdfBase64,
  completeCurrentUserOnboarding,
  createRun,
  finalizeRun,
  generateCoverLetter as apiGenerateCoverLetter,
  generateOtherDoc as apiGenerateOtherDoc,
  getBackendHealth,
  getRecentRuns,
  getScreeningPrefs,
  getSettings,
  otherDocPdfBase64,
  recordRunOutcome,
  signOutCurrentUser
} from "../shared/backendApi";
import {
  createInitialRuntimeState,
  DEFAULT_SCREENING,
  DEFAULT_SETTINGS,
  GOOGLE_OAUTH_CLIENT_ID,
  GOOGLE_OAUTH_SCOPES,
  normalizeScreeningPrefs
} from "../shared/constants";
import {
  getKnowledgeBaseSources,
  getResumeText,
  getStoredDocumentByType
} from "../shared/localDocuments";
import { inferPageSupport } from "../shared/handshake";
import {
  clearOnboardingUser,
  markOnboardingComplete,
  markOnboardingIncomplete,
  onboardingPageUrl,
  readOnboardingState,
  saveOnboardingUser
} from "../shared/onboarding";
import type {
  ContentMessage,
  ContentResponse,
  DocumentType,
  ExtensionMessage,
  ExtensionResponse,
  GoogleUserProfile,
  JobContext,
  JobResult,
  RunStatus,
  RuntimeState
} from "../shared/contracts";

const runtimeState: RuntimeState = createInitialRuntimeState();

const LOG = "[HAA background]";
function log(...args: unknown[]): void {
  console.log(LOG, ...args);
}
function warn(...args: unknown[]): void {
  console.warn(LOG, ...args);
}

// chrome.storage.session is NOT readable/writable from content scripts by
// default — only "trusted" contexts (this worker, the popup) can touch it. The
// content script persists its job queue there across page navigations, so
// without this grant saveSession() throws "Access to storage is not allowed from
// this context" and the whole run dies before it starts. Must run on every
// service-worker startup because MV3 workers are ephemeral and the access level
// resets with them.
function grantSessionStorageToContentScripts(): void {
  chrome.storage.session
    .setAccessLevel({ accessLevel: "TRUSTED_AND_UNTRUSTED_CONTEXTS" })
    .then(() => log("storage.session access granted to content scripts"))
    .catch((e) => warn("failed to set storage.session access level", e));
}
grantSessionStorageToContentScripts();

function respond(sendResponse: (r: ExtensionResponse) => void, response: ExtensionResponse) {
  log("→ response", response);
  sendResponse(response);
}

async function getActiveHandshakeTab() {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  log("getActiveHandshakeTab: active tab", { id: activeTab?.id, url: activeTab?.url });

  if (typeof activeTab?.id !== "number" || !activeTab.url) {
    throw new Error("No active browser tab found.");
  }

  if (inferPageSupport(activeTab.url) !== "supported") {
    throw new Error("Open a supported Handshake page before starting.");
  }

  return { id: activeTab.id, url: activeTab.url };
}

async function sendContentMessage(tabId: number, message: ContentMessage): Promise<ContentResponse> {
  log(`sendContentMessage → tab ${tabId}`, message);
  try {
    const response = (await chrome.tabs.sendMessage(tabId, message)) as ContentResponse;
    log(`content script replied from tab ${tabId}`, response);
    return response;
  } catch (err) {
    // The classic failure: content script not injected on this tab (e.g. the tab
    // was already open before the extension loaded/reloaded, so it never received
    // the content script). Surface it loudly instead of failing silently.
    warn(
      `sendContentMessage to tab ${tabId} threw — the content script is probably not ` +
        `loaded on that tab. Reload the Handshake tab after (re)loading the extension.`,
      err
    );
    throw err instanceof Error ? err : new Error("Content script did not respond.");
  }
}

function resetRunCounters() {
  runtimeState.appliedCount = 0;
  runtimeState.skippedCount = 0;
  runtimeState.failedCount = 0;
}

// Google disabled the legacy getAuthToken / "Chrome App" OAuth flow (the Oct-2023
// custom-URI-scheme restriction), so sign-in uses launchWebAuthFlow against a
// Web-application OAuth client. The implicit flow returns the access token in the
// redirect URL fragment; that access token is what the backend verifies.
function getGoogleAuthToken(interactive: boolean): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!chrome.identity?.launchWebAuthFlow) {
      reject(new Error("Chrome Identity is unavailable in this browser context."));
      return;
    }
    if (!GOOGLE_OAUTH_CLIENT_ID) {
      reject(
        new Error(
          "Google sign-in is not configured. Set VITE_GOOGLE_OAUTH_CLIENT_ID in frontend/.env and rebuild."
        )
      );
      return;
    }

    const redirectUri = chrome.identity.getRedirectURL();
    const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authUrl.searchParams.set("client_id", GOOGLE_OAUTH_CLIENT_ID);
    authUrl.searchParams.set("response_type", "token");
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("scope", GOOGLE_OAUTH_SCOPES.join(" "));
    // Always show the account chooser so both first sign-in and switching accounts work.
    authUrl.searchParams.set("prompt", "select_account");

    chrome.identity.launchWebAuthFlow({ url: authUrl.toString(), interactive }, (responseUrl) => {
      const lastError = chrome.runtime.lastError;
      if (lastError || !responseUrl) {
        reject(new Error(lastError?.message || "Google sign-in was cancelled."));
        return;
      }
      const params = new URLSearchParams(new URL(responseUrl).hash.replace(/^#/, ""));
      const error = params.get("error");
      if (error) {
        reject(new Error(`Google sign-in failed: ${error}`));
        return;
      }
      const token = params.get("access_token");
      if (!token) {
        reject(new Error("Google did not return an access token."));
        return;
      }
      resolve(token);
    });
  });
}

async function clearGoogleAuthState(): Promise<void> {
  if (chrome.identity?.clearAllCachedAuthTokens) {
    await chrome.identity.clearAllCachedAuthTokens();
  }
  await clearOnboardingUser();
}

function toGoogleUser(
  storedUser: Awaited<ReturnType<typeof authenticateGoogleUser>>["user"]
): GoogleUserProfile {
  return {
    backendUserId: storedUser.id,
    id: storedUser.googleSubject,
    email: storedUser.email,
    name: storedUser.displayName,
    picture: storedUser.pictureUrl,
    authenticatedAt: storedUser.authenticatedAt
  };
}

async function loginWithGoogle(): Promise<ExtensionResponse> {
  // launchWebAuthFlow mints a fresh access token each time (no chrome.identity
  // token cache to invalidate), so there's no stale-token retry to do here.
  const token = await getGoogleAuthToken(true);
  const authSession = await authenticateGoogleUser(token);
  const user = toGoogleUser(authSession.user);
  await saveOnboardingUser(user, authSession.token);
  return { ok: true, user };
}

async function switchGoogleAccount(): Promise<ExtensionResponse> {
  await signOutCurrentUser().catch(() => undefined);
  await clearGoogleAuthState();
  return loginWithGoogle();
}

async function logoutGoogleUser(): Promise<ExtensionResponse> {
  await signOutCurrentUser().catch(() => undefined);
  await clearGoogleAuthState();
  return { ok: true, signedOut: true };
}

async function completeOnboarding(): Promise<ExtensionResponse> {
  await completeCurrentUserOnboarding();
  return { ok: true, onboarding: await markOnboardingComplete() };
}

async function refreshBackendState() {
  try {
    const health = await getBackendHealth();
    runtimeState.backendHealth = health.status === "UP" ? "online" : "offline";
    runtimeState.backendVersion = health.version;
    runtimeState.backendDatabase = health.database;
  } catch {
    runtimeState.backendHealth = "offline";
    runtimeState.backendVersion = null;
    runtimeState.backendDatabase = null;
    runtimeState.lastError = "Backend health check failed.";
    return;
  }

  try {
    runtimeState.settings = await getSettings();
  } catch {
    runtimeState.settings = DEFAULT_SETTINGS;
  }

  try {
    runtimeState.recentRuns = await getRecentRuns(5);
  } catch {
    runtimeState.recentRuns = [];
  }
}

async function startRun(): Promise<ExtensionResponse> {
  log("startRun: invoked, current status =", runtimeState.runStatus);
  if (runtimeState.runStatus === "RUNNING" || runtimeState.runStatus === "STOPPING") {
    return { ok: false, error: "A run is already active." };
  }

  const activeTab = await getActiveHandshakeTab();

  try {
    const status = await sendContentMessage(activeTab.id, { type: "content/status" });
    if (status.ok && "runActive" in status && status.runActive) {
      runtimeState.runStatus = "RUNNING";
      runtimeState.runId = status.activeRunId;
      runtimeState.tabId = activeTab.id;
      runtimeState.sourceUrl = activeTab.url;
      runtimeState.lastError = "A run is already active in this tab.";
      return { ok: false, error: runtimeState.lastError };
    }
  } catch {
    // If the content script is not reachable, the normal start path below will
    // surface the clearer sendContentMessage error after the backend run is
    // created/finalized. Avoid turning this preflight into a separate failure
    // mode while users are reloading the extension during development.
  }

  await refreshBackendState();
  log("startRun: backend health =", runtimeState.backendHealth);

  if (runtimeState.backendHealth !== "online") {
    return {
      ok: false,
      error: "HandShook's backend is unavailable. Try again in a moment."
    };
  }

  const startedAt = new Date().toISOString();
  const run = await createRun(activeTab.url, startedAt);
  log("startRun: created run in backend", run);

  runtimeState.runStatus = "RUNNING";
  runtimeState.runId = run.runId;
  runtimeState.tabId = activeTab.id;
  runtimeState.sourceUrl = activeTab.url;
  runtimeState.startedAt = run.startedAt;
  runtimeState.lastError = null;
  resetRunCounters();

  // Fetch the user's screening-question answers so the content script can fill
  // Yes/No radios mid-application. Fall back to defaults if the backend errors —
  // a missing prefs row shouldn't block the run.
  let screening = DEFAULT_SCREENING;
  try {
    screening = normalizeScreeningPrefs(await getScreeningPrefs());
  } catch {
    log("startRun: couldn't load screening prefs; using defaults.");
  }

  const contentResponse = await sendContentMessage(activeTab.id, {
    type: "content/start-run",
    runId: run.runId,
    settings: runtimeState.settings,
    screening
  });
  log("startRun: content/start-run response", contentResponse);

  if (!contentResponse.ok) {
    runtimeState.runStatus = "FAILED";
    runtimeState.lastError = contentResponse.error;
    await finalizeRun(run.runId, "FAILED", contentResponse.error);
    return { ok: false, error: contentResponse.error };
  }

  // content/start-run always replies with the page-support shape; narrow to it
  // (the ContentResponse union also covers scrape-job / attach replies).
  if (!("pageSupport" in contentResponse)) {
    const reason = "Unexpected content-script response to start-run.";
    runtimeState.runStatus = "FAILED";
    runtimeState.lastError = reason;
    await finalizeRun(run.runId, "FAILED", reason);
    return { ok: false, error: reason };
  }

  if (contentResponse.pageSupport === "unsupported") {
    const reason = "This Handshake page does not expose a supported job list or detail view.";
    runtimeState.runStatus = "FAILED";
    runtimeState.lastError = reason;
    await finalizeRun(run.runId, "FAILED", reason);
    return { ok: false, error: reason };
  }

  // No jobs discovered: finalize the run instead of leaving it RUNNING forever.
  // Previously this wedged the in-memory state so every later Start was rejected
  // with "A run is already active." Finalizing keeps Start repeatable while we
  // get the scraper selectors right.
  if (contentResponse.discoveredJobCount === 0) {
    const reason =
      "Found 0 jobs on this page. Handshake job-search renders cards without per-job URLs; " +
      "DOM diagnostics were written to the extension console so the scraper can be fixed.";
    warn(reason);
    runtimeState.runStatus = "FAILED";
    runtimeState.lastError = reason;
    await finalizeRun(run.runId, "FAILED", reason);
    try {
      runtimeState.recentRuns = await getRecentRuns(5);
    } catch {
      /* ignore */
    }
    return { ok: false, error: reason };
  }

  return { ok: true, state: runtimeState };
}

async function stopRun(): Promise<ExtensionResponse> {
  if (runtimeState.runStatus !== "RUNNING" || !runtimeState.runId) {
    // MV3 service workers are ephemeral. If Chrome recycled us mid-run, the
    // content script may still have a persisted session and active walker even
    // though runtimeState is back to IDLE. Best-effort relay Stop to the active
    // Handshake tab so the tab-local session can mark itself stopped and
    // finalize the backend run it still knows about.
    try {
      const activeTab = await getActiveHandshakeTab();
      await sendContentMessage(activeTab.id, { type: "content/stop-run" });
      runtimeState.lastError = null;
    } catch (err) {
      runtimeState.lastError =
        err instanceof Error ? err.message : "No active run found to stop.";
    }
    runtimeState.runStatus = "STOPPED";
    return { ok: true, state: runtimeState };
  }

  runtimeState.runStatus = "STOPPING";

  if (runtimeState.tabId) {
    try {
      await sendContentMessage(runtimeState.tabId, { type: "content/stop-run" });
    } catch {
      runtimeState.lastError = "Stop requested, but the content script did not respond.";
    }
  }

  return { ok: true, state: runtimeState };
}

async function diagnoseActivePage(): Promise<ExtensionResponse> {
  const activeTab = await getActiveHandshakeTab();
  const response = await sendContentMessage(activeTab.id, { type: "content/diagnose-page" });

  if (!response.ok) {
    return response;
  }

  if (!("diagnostics" in response)) {
    return { ok: false, error: "Unexpected content-script response to page diagnostic." };
  }

  return { ok: true, diagnostics: response.diagnostics };
}

async function generateCoverLetter(): Promise<ExtensionResponse> {
  const activeTab = await getActiveHandshakeTab();

  // Ask the content script to read the job currently shown on the page.
  const scraped = (await sendContentMessage(activeTab.id, {
    type: "content/scrape-job"
  })) as unknown as { ok?: boolean; job?: JobContext };

  if (!scraped?.ok || !scraped.job) {
    throw new Error("Could not read a job from this page. Open a job's detail or apply view and try again.");
  }
  log("generateCoverLetter: scraped job", {
    title: scraped.job.jobTitle,
    company: scraped.job.company,
    descriptionChars: scraped.job.jobDescription.length
  });

  const resumeText = await getResumeText();
  const result = await apiGenerateCoverLetter(scraped.job, resumeText);
  log("generateCoverLetter: generated", { model: result.model, chars: result.coverLetter.length });
  return { ok: true, coverLetter: result };
}

// Takes the (reviewed) letter text, renders it to a PDF on the backend, then has
// the content script inject that PDF into the apply modal's cover-letter "Upload
// new" file input and click Submit when the form becomes valid. This is the
// "one-click submit with cover letter" step.
async function attachCoverLetter(coverLetter: string): Promise<ExtensionResponse> {
  if (!coverLetter || !coverLetter.trim()) {
    throw new Error("Generate (or paste) a cover letter before attaching it.");
  }

  const activeTab = await getActiveHandshakeTab();

  // Re-read the open job so the file is named after the company.
  const scraped = (await sendContentMessage(activeTab.id, {
    type: "content/scrape-job"
  })) as unknown as { ok?: boolean; job?: JobContext };
  const job = scraped?.job;
  if (!scraped?.ok || !job) {
    throw new Error("Could not read the job on this page. Open the application/job view and try again.");
  }

  const pdfBase64 = await coverLetterPdfBase64({
    coverLetter,
    company: job.company,
    jobTitle: job.jobTitle
  });
  const slug = (job.company || "").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  const filename = slug ? `Cover_Letter_${slug}.pdf` : "Cover_Letter.pdf";
  log("attachCoverLetter: rendered PDF", { filename, base64Chars: pdfBase64.length });

  const response = (await sendContentMessage(activeTab.id, {
    type: "content/attach-cover-letter",
    pdfBase64,
    filename
  })) as unknown as { ok?: boolean; attach?: { attached: boolean; submitted: boolean; message: string }; error?: string };

  if (!response?.ok || !response.attach) {
    throw new Error(response?.error || "Failed to attach the cover letter to the application.");
  }
  log("attachCoverLetter: content result", response.attach);
  return { ok: true, attach: response.attach };
}

// In-run cover-letter generation on behalf of the content script. The content
// script already scraped the open job (it's looking right at it), so it passes
// the JobContext rather than us re-reading the active tab like the popup flow.
async function generateCoverLetterText(job: JobContext): Promise<ExtensionResponse> {
  try {
    const resumeText = await getResumeText();
    const result = await apiGenerateCoverLetter(job, resumeText);
    log("generateCoverLetterText: generated", { model: result.model, chars: result.coverLetter.length });
    return { ok: true, coverLetter: result };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Cover-letter generation failed."
    };
  }
}

// Renders the (reviewed) cover-letter text to a PDF and returns the base64 bytes
// plus a company-named filename, for the content script to drop into the apply
// modal's cover-letter upload field.
async function renderCoverLetterPdf(
  coverLetter: string,
  company: string,
  jobTitle: string
): Promise<ExtensionResponse> {
  try {
    const base64 = await coverLetterPdfBase64({ coverLetter, company, jobTitle });
    const slug = (company || "").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
    const filename = slug ? `Cover_Letter_${slug}.pdf` : "Cover_Letter.pdf";
    return { ok: true, pdf: { base64, filename } };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Cover-letter PDF render failed."
    };
  }
}

// Runs the RAG document agent for the open job: the backend gathers the user's
// stored materials and drafts the employer-requested document. Returns the draft
// (plus the sources it drew on) for the content script's review overlay.
async function generateOtherDoc(job: JobContext, instructions: string): Promise<ExtensionResponse> {
  try {
    const sources = await getKnowledgeBaseSources();
    const result = await apiGenerateOtherDoc({
      jobTitle: job.jobTitle,
      company: job.company,
      jobDescription: job.jobDescription,
      instructions,
      sources
    });
    log("generateOtherDoc: drafted", {
      model: result.model,
      chars: result.document.length,
      sources: result.sources
    });
    return { ok: true, otherDoc: result };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Document generation failed."
    };
  }
}

// Renders the (reviewed) agent document to a PDF and returns the base64 bytes plus
// a company-named filename, for the content script to drop into the apply modal's
// "other required documents" upload field.
async function renderOtherDocPdf(
  document: string,
  company: string,
  jobTitle: string
): Promise<ExtensionResponse> {
  try {
    const base64 = await otherDocPdfBase64({ document, company, jobTitle });
    const slug = (company || "").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
    const filename = slug ? `Document_${slug}.pdf` : "Document.pdf";
    return { ok: true, pdf: { base64, filename } };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Document PDF render failed."
    };
  }
}

// Proxies a stored-document fetch for the content script (which can't reach the
// backend directly due to CORS). Used mid-run when the apply modal asks for the
// user's transcript: the content script requests it, we fetch the bytes as
// base64, and it rebuilds the File to drop into the upload field.
async function getDocument(docType: DocumentType): Promise<ExtensionResponse> {
  try {
    const document = await getStoredDocumentByType(docType);
    return { ok: true, document };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : `Failed to fetch the ${docType} document.`
    };
  }
}

async function handleJobProcessed(
  runId: string,
  result: JobResult
): Promise<ExtensionResponse> {
  // The MV3 service worker can be evicted while a job is open (especially across a
  // Handshake page reload), which resets runtimeState (runId → null). If a content
  // script reports progress for a run we no longer hold in memory, ADOPT it — the
  // run is still RUNNING in the backend and the walker is mid-page. Telling it to
  // stop here is what produced the "applies a few, then stops/restarts" cascade.
  // Only stop when a DIFFERENT run has since taken over (the user started a newer
  // one); an explicit Stop is honored content-side via the persisted session flag.
  if (runtimeState.runId === null) {
    log("handleJobProcessed: adopting run after lost SW state", runId);
    runtimeState.runId = runId;
    runtimeState.runStatus = "RUNNING";
  } else if (runtimeState.runId !== runId) {
    return { ok: true, shouldStop: true };
  }

  if (result.status === "APPLIED") runtimeState.appliedCount++;
  else if (result.status === "SKIPPED") runtimeState.skippedCount++;
  else if (result.status === "FAILED") runtimeState.failedCount++;

  try {
    await recordRunOutcome(runId, result.status);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to update run counters.";
    runtimeState.lastError = message;
    runtimeState.runStatus = "STOPPING";
    return { ok: true, shouldStop: true };
  }

  const shouldStop =
    runtimeState.runStatus === "STOPPING" ||
    (runtimeState.settings.stopOnError && result.status === "FAILED");

  if (shouldStop) {
    runtimeState.runStatus = "STOPPING";
  }

  return { ok: true, shouldStop };
}

async function handleRunComplete(
  runId: string,
  finalStatus: Exclude<RunStatus, "RUNNING">,
  errorMessage?: string | null
): Promise<ExtensionResponse> {
  // If the MV3 worker was recycled after the last job result but before the
  // content script reported completion, runtimeState.runId is null. Adopt the
  // run long enough to finalize it; otherwise the backend row stays RUNNING
  // forever even though the tab completed the walk.
  if (runtimeState.runId === null) {
    log("handleRunComplete: adopting run after lost SW state", runId);
    runtimeState.runId = runId;
  }

  if (runtimeState.runId === runId) {
    runtimeState.runStatus = finalStatus;
    runtimeState.lastError = errorMessage ?? null;

    try {
      await finalizeRun(runId, finalStatus, errorMessage ?? null);
    } catch (err) {
      runtimeState.lastError =
        err instanceof Error ? err.message : "Failed to finalize run.";
    } finally {
      try {
        runtimeState.recentRuns = await getRecentRuns(5);
      } catch {
        /* ignore */
      }
      runtimeState.runId = null;
      runtimeState.tabId = null;
      runtimeState.sourceUrl = null;
      runtimeState.startedAt = null;
    }
  } else {
    log("handleRunComplete: ignoring completion for stale run", {
      activeRunId: runtimeState.runId,
      completedRunId: runId,
      finalStatus
    });
    try {
      runtimeState.recentRuns = await getRecentRuns(5);
    } catch {
      /* ignore */
    }
  }

  return { ok: true, state: runtimeState };
}

chrome.runtime.onInstalled.addListener((details) => {
  console.log("[background] Extension installed", details.reason);
  if (details.reason === "install") {
    void markOnboardingIncomplete()
      .then(() => chrome.tabs.create({ url: onboardingPageUrl() }))
      .catch((err) => warn("failed to open onboarding after install", err));
  }
});

chrome.runtime.onStartup.addListener(() => {
  console.log("[background] Service worker started");
});

chrome.runtime.onMessage.addListener((message: ExtensionMessage, sender, sendResponse) => {
  log("← message", message.type, "from", sender.tab ? `tab ${sender.tab.id}` : "popup/extension");
  void (async () => {
    try {
      switch (message.type) {
        case "runtime/get":
          respond(sendResponse, { ok: true, state: runtimeState });
          return;

        case "runtime/refresh":
          await refreshBackendState();
          respond(sendResponse, { ok: true, state: runtimeState });
          return;

        case "runtime/get-onboarding":
          respond(sendResponse, { ok: true, onboarding: await readOnboardingState() });
          return;

        case "runtime/google-login":
          respond(sendResponse, await loginWithGoogle());
          return;

        case "runtime/google-switch-account":
          respond(sendResponse, await switchGoogleAccount());
          return;

        case "runtime/google-logout":
          respond(sendResponse, await logoutGoogleUser());
          return;

        case "runtime/complete-onboarding":
          respond(sendResponse, await completeOnboarding());
          return;

        case "runtime/start":
          respond(sendResponse, await startRun());
          return;

        case "runtime/stop":
          respond(sendResponse, await stopRun());
          return;

        case "runtime/diagnose-page":
          respond(sendResponse, await diagnoseActivePage());
          return;

        case "runtime/generate-cover-letter":
          respond(sendResponse, await generateCoverLetter());
          return;

        case "runtime/attach-cover-letter":
          respond(sendResponse, await attachCoverLetter(message.coverLetter));
          return;

        case "runtime/get-document": {
          // Don't route through respond() — it logs the whole response, and the
          // base64 document bytes would flood the service-worker console.
          const docResponse = await getDocument(message.docType);
          log(
            "→ get-document response",
            docResponse.ok && "document" in docResponse
              ? { ok: true, type: message.docType, found: !!docResponse.document, filename: docResponse.document?.filename }
              : docResponse
          );
          sendResponse(docResponse);
          return;
        }

        case "runtime/generate-cover-letter-text": {
          const textResponse = await generateCoverLetterText(message.job);
          log(
            "→ generate-cover-letter-text response",
            textResponse.ok && "coverLetter" in textResponse
              ? { ok: true, model: textResponse.coverLetter.model, chars: textResponse.coverLetter.coverLetter.length }
              : textResponse
          );
          sendResponse(textResponse);
          return;
        }

        case "runtime/render-cover-letter-pdf": {
          // Trim the log — the base64 PDF would otherwise flood the SW console.
          const pdfResponse = await renderCoverLetterPdf(
            message.coverLetter,
            message.company,
            message.jobTitle
          );
          log(
            "→ render-cover-letter-pdf response",
            pdfResponse.ok && "pdf" in pdfResponse
              ? { ok: true, filename: pdfResponse.pdf.filename, base64Chars: pdfResponse.pdf.base64.length }
              : pdfResponse
          );
          sendResponse(pdfResponse);
          return;
        }

        case "runtime/generate-other-doc": {
          const docResponse = await generateOtherDoc(message.job, message.instructions);
          log(
            "→ generate-other-doc response",
            docResponse.ok && "otherDoc" in docResponse
              ? {
                  ok: true,
                  model: docResponse.otherDoc.model,
                  chars: docResponse.otherDoc.document.length,
                  sources: docResponse.otherDoc.sources
                }
              : docResponse
          );
          sendResponse(docResponse);
          return;
        }

        case "runtime/render-other-doc-pdf": {
          const pdfResponse = await renderOtherDocPdf(
            message.document,
            message.company,
            message.jobTitle
          );
          log(
            "→ render-other-doc-pdf response",
            pdfResponse.ok && "pdf" in pdfResponse
              ? { ok: true, filename: pdfResponse.pdf.filename, base64Chars: pdfResponse.pdf.base64.length }
              : pdfResponse
          );
          sendResponse(pdfResponse);
          return;
        }

        case "content/job-processed":
          respond(sendResponse, await handleJobProcessed(message.runId, message.result));
          return;

        case "content/run-complete":
          respond(
            sendResponse,
            await handleRunComplete(message.runId, message.finalStatus, message.errorMessage)
          );
          return;

        case "content/debug-log":
          log(`client-log [${message.label}]`, message.payload);
          respond(sendResponse, { ok: true, state: runtimeState });
          return;

        default:
          respond(sendResponse, { ok: false, error: "Unknown message type" });
      }
    } catch (error) {
      const messageText =
        error instanceof Error ? error.message : "Unexpected extension error.";
      runtimeState.lastError = messageText;
      respond(sendResponse, { ok: false, error: messageText });
    }
  })();

  return true;
});
