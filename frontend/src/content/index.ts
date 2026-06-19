import type {
  ContentMessage,
  ContentResponse,
  DocumentType,
  JobContext,
  JobResult,
  PageDiagnostics,
  RunStatus,
  ScreeningPrefs,
  Settings,
  StoredDocument
} from "../shared/contracts";
import { normalizeScreeningPrefs } from "../shared/constants";
import { inferPageSupport } from "../shared/handshake";

// The user's screening-question answers, pushed from the background worker on
// content/start-run. Defaults match the options page until a run sets them.
let screeningPrefs: ScreeningPrefs = {
  usWorkAuthorized: true,
  softwareEngineeringDegree: true,
  speaksEnglish: true,
  relocateAnywhere: false,
  locations: []
};

// ─── Debug logging ──────────────────────────────────────────────────────────────
// Everything is prefixed so it's easy to filter the Handshake page console by
// "HAA". Toggle verbosity by flipping DEBUG. Logs are intentionally chatty —
// this content script is the part we understand least (Handshake's live DOM),
// so we trace every decision while bringing the automation up.

const DEBUG = true;
const LOG = "[HAA content]";

function log(...args: unknown[]): void {
  if (DEBUG) console.log(LOG, ...args);
}
function warn(...args: unknown[]): void {
  if (DEBUG) console.warn(LOG, ...args);
}
function group(label: string): void {
  if (DEBUG) console.groupCollapsed(`${LOG} ${label}`);
}
function groupEnd(): void {
  if (DEBUG) console.groupEnd();
}

// Dumps what anchors actually exist on the page, bucketed by their first two
// path segments. This is how we discover Handshake's real job-link pattern
// (e.g. /jobs/123 vs /postings/123 vs /job-search/123) without guessing.
function dumpAnchorDiagnostics(): void {
  if (!DEBUG) return;
  const anchors = Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]"));
  const buckets = new Map<string, { count: number; sample: string }>();
  for (const a of anchors) {
    let pathHead = "(unparseable)";
    try {
      const segs = new URL(a.href).pathname.split("/").filter(Boolean);
      pathHead = "/" + segs.slice(0, 2).join("/");
    } catch {
      /* ignore */
    }
    const existing = buckets.get(pathHead);
    if (existing) existing.count++;
    else buckets.set(pathHead, { count: 1, sample: a.href });
  }
  group(`anchor diagnostics — ${anchors.length} total <a href> on page`);
  const rows = Array.from(buckets.entries())
    .sort((x, y) => y[1].count - x[1].count)
    .map(([pathHead, info]) => ({ pathHead, count: info.count, sample: info.sample }));
  console.table(rows);
  groupEnd();
}

// Lists the visible text of every button so we can see what "apply" control
// Handshake actually renders when our selectors miss.
function dumpButtonTexts(): string[] {
  return Array.from(document.querySelectorAll<HTMLButtonElement>("button"))
    .filter(isElementVisible)
    .map((b) => (b.textContent ?? "").trim())
    .filter((t) => t.length > 0);
}

// A short trail of an element's nearest data-hook / data-testid / aria-label
// ancestors — lets us see which apply-modal section a file input belongs to.
function ancestryHooks(el: HTMLElement): string[] {
  const out: string[] = [];
  let node: HTMLElement | null = el;
  for (let i = 0; i < 8 && node; i++, node = node.parentElement) {
    const hook = node.getAttribute("data-hook");
    const testid = node.getAttribute("data-testid");
    const aria = node.getAttribute("aria-label");
    if (hook || testid || aria) {
      const key = hook ? `hook=${hook}` : testid ? `testid=${testid}` : `aria=${aria}`;
      out.push(`${node.tagName.toLowerCase()}[${key.slice(0, 60)}]`);
    }
  }
  return out;
}

// Snapshot the apply modal's upload widgets in the extension console so we can see how
// Handshake really wires its cover-letter/transcript uploads (their structure is
// the thing we understand least). Captures every file input (name/id/accept/
// hidden/disabled/files + which section it sits in), the cover-letter and
// transcript section markup, and the Submit button's disabled state.
function dumpUploadWidgets(note: string): void {
  const sectionInfo = (kind: "cover" | "transcript") => {
    const sec = kind === "cover" ? coverLetterSection() : transcriptSection();
    return {
      found: !!sec,
      tag: sec?.tagName ?? null,
      fileInputs: sec ? sec.querySelectorAll('input[type="file"]').length : 0,
      uploadButtons: sec
        ? Array.from(sec.querySelectorAll("button")).filter((b) => /upload/i.test(b.textContent ?? "")).length
        : 0,
      html: sec ? sec.outerHTML.replace(/\s+/g, " ").slice(0, 1400) : null
    };
  };
  const inputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="file"]')).map(
    (inp, idx) => ({
      idx,
      name: inp.name || null,
      id: inp.id || null,
      accept: inp.getAttribute("accept"),
      hidden: inp.offsetParent === null,
      disabled: inp.disabled,
      files: inp.files?.length ?? 0,
      cls: typeof inp.className === "string" ? inp.className.slice(0, 80) : null,
      ancestry: ancestryHooks(inp)
    })
  );
  const submit = findButtonByText(["submit application", "submit"]);
  const payload = {
    note,
    url: window.location.href,
    fileInputCount: inputs.length,
    inputs,
    cover: sectionInfo("cover"),
    transcript: sectionInfo("transcript"),
    submitDisabled: submit ? submit.disabled : null,
    buttons: dumpButtonTexts().slice(0, 30)
  };
  log("upload-widgets", payload);
  void chrome.runtime
    .sendMessage({ type: "content/debug-log", label: "upload-widgets", payload })
    .catch(() => {});
}

// Handshake's job-search is a master-detail SPA: job cards are non-anchor
// elements and selecting one swaps a detail panel without changing the URL, so
// the href-based scraper finds nothing. This dump surfaces the structural
// attributes (data-hook / data-testid / aria) and sample markup we need to
// derive real click selectors for cards and the apply control. It emits ONE
// JSON blob (DOM_DIAGNOSTICS_JSON) that's easy to copy out of the console.
function dumpDomDiagnostics(): void {
  if (!DEBUG) return;

  const countAttr = (attr: string): Record<string, number> => {
    const counts: Record<string, number> = {};
    document.querySelectorAll<HTMLElement>(`[${attr}]`).forEach((el) => {
      const v = el.getAttribute(attr) ?? "";
      counts[v] = (counts[v] ?? 0) + 1;
    });
    return counts;
  };

  // Likely job-card containers: anything whose data-hook/class hints at a job
  // result/card, or list items inside the results region.
  const cardCandidates = Array.from(
    document.querySelectorAll<HTMLElement>(
      '[data-hook*="job" i],[data-hook*="card" i],[data-hook*="result" i],' +
        '[class*="JobCard" i],[class*="job-card" i],[class*="JobResult" i],' +
        '[role="listitem"],li[class*="result" i]'
    )
  ).slice(0, 4);

  const summary = {
    url: window.location.href,
    dataHookCounts: countAttr("data-hook"),
    dataTestIdCounts: countAttr("data-testid"),
    totalAnchors: document.querySelectorAll("a[href]").length,
    totalButtons: document.querySelectorAll("button").length,
    buttonTextsSample: dumpButtonTexts().slice(0, 25),
    cardCandidateCount: cardCandidates.length,
    cardCandidates: cardCandidates.map((el) => ({
      tag: el.tagName,
      dataHook: el.getAttribute("data-hook"),
      dataTestId: el.getAttribute("data-testid"),
      role: el.getAttribute("role"),
      className: typeof el.className === "string" ? el.className.slice(0, 160) : null,
      innerHref: el.querySelector("a[href]")?.getAttribute("href") ?? null,
      text: (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 120),
      html: el.outerHTML.slice(0, 500)
    }))
  };

  group("DOM diagnostics (expand to view table)");
  console.table(
    Object.entries(summary.dataHookCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([hook, count]) => ({ "data-hook": hook, count }))
  );
  groupEnd();

  // Single copy-friendly blob — right-click this line in the console and
  // "Copy string contents", then paste it back.
  console.log(`${LOG} DOM_DIAGNOSTICS_JSON\n` + JSON.stringify(summary, null, 2));

  // Also ship it to the background worker's console. It is intentionally not
  // persisted by the backend because job-level diagnostics can contain identity.
  void chrome.runtime
    .sendMessage({ type: "content/debug-log", label: "dom-diagnostics", payload: summary })
    .catch(() => {
      /* background may be asleep; the console blob above is the fallback */
    });
}

// ─── Session state ────────────────────────────────────────────────────────────
// Persisted in chrome.storage.session so it survives full-page navigations
// (Handshake's SPA uses client-side routing, but some flows force hard reloads).

const SESSION_KEY = "haa_run_session";

let extensionContextInvalidated = false;

function isExtensionContextInvalidated(err: unknown): boolean {
  return err instanceof Error && /extension context invalidated/i.test(err.message);
}

function noteExtensionContextInvalidated(err: unknown): boolean {
  if (!isExtensionContextInvalidated(err)) return false;
  if (!extensionContextInvalidated) {
    warn("Extension context invalidated; stopping this stale content-script run. Reload the Handshake tab after reloading the extension.");
  }
  extensionContextInvalidated = true;
  inPlaceStop = true;
  return true;
}

interface RunSession {
  runId: string;
  settings: Settings;
  shouldStop: boolean;
  // "detail" = process the currently-open job detail once, without navigation.
  // "list" = the in-place list walker. The list walker holds its progress in page
  // memory, so Handshake force-reloading the search page mid-run would otherwise
  // wipe it and restart from the top (re-applying). These fields persist the
  // walk so we can resume the SAME run after a reload instead of restarting.
  mode?: "detail" | "list";
  screening?: ScreeningPrefs;
  // User-selected handling for "other required documents". This belongs to the
  // run session (not only this page's JS memory) so "remember my choice" keeps
  // working after Handshake route changes or hard reloads.
  otherDocsRemembered?: OtherDocsAction | null;
  // Job ids already handled this run (applied/skipped). Marked seen BEFORE we
  // apply, so a reload mid-application skips that job rather than re-submitting it.
  seenIds?: string[];
  processed?: number;
  // The page the run started on. The page limit (maxPagesPerRun) is enforced as
  // currentPage - startPage + 1, which survives the page-nav reloads (a local
  // counter would reset on each reload and never hit the limit).
  startPage?: number;
}

async function getSession(): Promise<RunSession | null> {
  try {
    const result = await chrome.storage.session.get(SESSION_KEY);
    return (result[SESSION_KEY] as RunSession | undefined) ?? null;
  } catch (err) {
    if (noteExtensionContextInvalidated(err)) return null;
    throw err;
  }
}

async function saveSession(s: RunSession): Promise<void> {
  try {
    await chrome.storage.session.set({ [SESSION_KEY]: s });
  } catch (err) {
    if (noteExtensionContextInvalidated(err)) return;
    throw err;
  }
}

async function clearSession(): Promise<void> {
  try {
    await chrome.storage.session.remove(SESSION_KEY);
  } catch (err) {
    if (noteExtensionContextInvalidated(err)) return;
    throw err;
  }
}

// Persist the in-place walker's progress so it survives a Handshake hard reload.
// Merges into the existing session row (keeps runId/settings/screening). Cheap —
// chrome.storage.session is in-memory.
async function persistListProgress(seen: Set<string>, processed: number): Promise<void> {
  try {
    const session = await getSession();
    if (!session || session.mode !== "list") return;
    await saveSession({ ...session, seenIds: Array.from(seen), processed });
  } catch (err) {
    // A storage hiccup must never kill the walk — resume is best-effort.
    warn("persistListProgress failed (continuing)", err);
  }
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function pathnameFor(url: string): string {
  try {
    return new URL(url, window.location.origin).pathname;
  } catch {
    return url;
  }
}

function extractJobId(url: string): string | null {
  const m = pathnameFor(url).match(/\/(?:jobs|postings|job-search)\/(\d+)(?:\/|$)/);
  return m?.[1] ?? null;
}

function isOnJobDetailPage(): boolean {
  return /\/(?:jobs|postings)\/\d+(?:\/|$)/.test(pathnameFor(window.location.href));
}

// ─── DOM helpers ──────────────────────────────────────────────────────────────
// Handshake uses data-hook attributes on key interactive elements.
// These selectors should be stable across visual redesigns.
// If Handshake changes their markup, update the selectors in each helper below.

function isElementVisible(el: HTMLElement): boolean {
  if (el.closest("[hidden],[aria-hidden='true']")) return false;
  const style = window.getComputedStyle(el);
  if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") {
    return false;
  }
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function visibleButtons(root: ParentNode = document): HTMLButtonElement[] {
  return Array.from(root.querySelectorAll<HTMLButtonElement>("button")).filter(isElementVisible);
}

function findButtonByText(candidates: string[]): HTMLButtonElement | null {
  return (
    visibleButtons().find((b) => {
      const t = (b.textContent ?? "").trim().toLowerCase();
      return candidates.some((c) => t === c || t.startsWith(c));
    }) ?? null
  );
}

function buttonByTextWithin(root: ParentNode, candidates: string[]): HTMLButtonElement | null {
  return (
    visibleButtons(root).find((b) => {
      const t = (b.textContent ?? "").trim().toLowerCase();
      return candidates.some((c) => t === c || t.startsWith(c));
    }) ?? null
  );
}

function findApplyButton(): HTMLButtonElement | null {
  const hooked = document.querySelector<HTMLButtonElement>(
    '[data-hook="apply-button"],[data-hook="easy-apply-button"],[data-hook="1-click-apply-button"]'
  );
  if (hooked && isElementVisible(hooked) && !hooked.disabled) return hooked;

  const byText = findButtonByText(["easy apply", "apply now", "1-click apply", "quick apply"]);
  if (byText && !byText.disabled) return byText;

  // Last resort: any enabled button with "apply" in its text that isn't "Apply Externally"
  return (
    visibleButtons().find((b) => {
      const t = (b.textContent ?? "").trim().toLowerCase();
      return t.includes("apply") && !t.includes("externally") && !b.disabled;
    }) ?? null
  );
}

function isAlreadyApplied(): boolean {
  const badge = document.querySelector<HTMLElement>(
    '[data-hook="applied-badge"],[aria-label="Applied"],[class*="applied-badge" i]'
  );
  if (badge && isElementVisible(badge)) return true;

  return !!findButtonByText(["applied", "application submitted", "withdraw application"]);
}

function isExternalApply(): boolean {
  const hooked = document.querySelector<HTMLElement>('[data-hook="apply-externally-button"]');
  if (hooked && isElementVisible(hooked)) return true;
  return !!findButtonByText(["apply externally", "apply on company site", "external application"]);
}

function hasScreeningQuestions(): boolean {
  const section = document.querySelector<HTMLElement>(
    '[data-hook="screening-questions"],[data-hook="application-questions"],[class*="ScreeningQuestion" i]'
  );
  if (section && isElementVisible(section)) return true;
  return !!findShortTextEl(/screening questions/i, 40);
}

// Short text node that labels a section in the apply modal (e.g. the
// "Attach other required documents" heading). Capped length so we match the
// label, not a big container that happens to contain the words.
function findShortTextEl(re: RegExp, maxLen = 80, root: ParentNode = document): HTMLElement | null {
  return (
    Array.from(
      root.querySelectorAll<HTMLElement>("h1,h2,h3,h4,h5,h6,label,div,span,p,strong")
    ).find((el) => {
      if (!isElementVisible(el)) return false;
      const t = (el.textContent ?? "").trim();
      return t.length > 0 && t.length < maxLen && re.test(t);
    }) ?? null
  );
}

// The apply modal asks for documents beyond the resume that we can't auto-fill
// ("Attach other required documents" — e.g. a video pitch, writing sample). This
// is the case we hand to the user via an overlay prompt.
function hasOtherRequiredDocs(): boolean {
  return !!findShortTextEl(/other required documents/i);
}

// Best-effort grab of the employer's instructions for the extra document, shown
// in the prompt so the user knows what's being asked.
function extractOtherDocsInstructions(): string {
  const el = Array.from(document.querySelectorAll<HTMLElement>("div,p,span,li")).find((e) =>
    /instructions from employer/i.test(e.textContent ?? "")
  );
  return (el?.textContent ?? "").replace(/\s+/g, " ").replace(/^instructions from employer:?/i, "").trim().slice(0, 300);
}

function extractJobMeta(): { title: string; company: string } {
  // Scope the title to the detail panel so we don't accidentally read the
  // document <title> ("Jobs") via a stray top-level h1.
  const title =
    document.querySelector<HTMLElement>('[data-hook="job-title"]')?.textContent?.trim() ||
    document
      .querySelector<HTMLElement>(
        '[data-hook="right-content"] h1,[data-hook="details-page"] h1,main h1'
      )
      ?.textContent?.trim() ||
    "Unknown Title";

  // Handshake renders the employer as <a href="/e/<id>" aria-label="<Company>">
  // (logo link) in the detail header — that aria-label is the most reliable
  // company signal; the old class-name selectors are stale ("Unknown Company").
  const company =
    document
      .querySelector<HTMLElement>('[data-hook="employer-name"],[data-hook="company-name"]')
      ?.textContent?.trim() ||
    document
      .querySelector<HTMLAnchorElement>('[data-hook="right-content"] a[href^="/e/"][aria-label]')
      ?.getAttribute("aria-label")
      ?.trim() ||
    document
      .querySelector<HTMLAnchorElement>('a[href^="/e/"][aria-label]')
      ?.getAttribute("aria-label")
      ?.trim() ||
    "Unknown Company";

  return { title, company };
}

// Scrapes the currently-displayed job's title, company, and description text for
// the cover-letter generator. Works on both the job detail page and the
// master-detail panel. Description is a best-effort innerText grab of the detail
// region, capped so we don't ship the entire page to the backend.
function scrapeJobContext(): JobContext {
  const { title, company } = extractJobMeta();

  const region =
    document.querySelector<HTMLElement>(
      '[data-hook="job-details"],[class*="JobDetail" i],[class*="job-detail" i],main,[role="main"]'
    ) ?? document.body;

  let description = (region.innerText ?? "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (description.length > 6000) {
    description = description.slice(0, 6000);
  }

  log("scrapeJobContext", { title, company, descriptionChars: description.length });
  return { jobTitle: title, company, jobDescription: description };
}

// ─── Apply logic ──────────────────────────────────────────────────────────────

async function processCurrentJobPage(jobUrl: string, explicitId?: string): Promise<JobResult> {
  const jobId = explicitId ?? extractJobId(jobUrl) ?? extractJobId(window.location.href) ?? "unknown";
  const { title, company } = extractJobMeta();
  const base = { handshakeJobId: jobId, jobUrl, title, company };
  const finish = (result: JobResult, decision: string): JobResult => {
    sendDebugLog("job-decision", {
      decision,
      result,
      currentUrl: window.location.href,
      selectedJobId: extractJobId(window.location.href),
      route: routeKind()
    });
    return result;
  };

  const alreadyApplied = isAlreadyApplied();
  const externalApply = isExternalApply();
  const screeningQuestions = hasScreeningQuestions();
  const applyBtn = findApplyButton();
  const gates = {
    alreadyApplied,
    externalApply,
    screeningQuestions,
    applyButtonFound: !!applyBtn,
    applyButtonText: applyBtn?.textContent?.trim() || null,
    applyButtonDisabled: applyBtn?.disabled ?? null,
    totalButtonsOnPage: document.querySelectorAll("button").length,
    visibleButtonsSample: dumpButtonTexts().slice(0, 20)
  };
  group(`processCurrentJobPage: ${title} @ ${company} (job ${jobId})`);
  log("url", window.location.href);
  log("gates", gates);
  groupEnd();
  sendDebugLog("job-gates", {
    jobId,
    jobUrl,
    currentUrl: window.location.href,
    title,
    company,
    gates
  });

  if (alreadyApplied) {
    return finish({ ...base, status: "SKIPPED", skipReason: "ALREADY_APPLIED" }, "already-applied-dom");
  }
  if (externalApply) {
    return finish({ ...base, status: "SKIPPED", skipReason: "APPLY_EXTERNALLY" }, "external-apply");
  }
  // NOTE: screening questions are no longer a pre-apply skip — they live INSIDE
  // the apply modal, so we click Apply first, then answer them below.

  if (!applyBtn) {
    warn("No apply button matched. Button texts on page:", dumpButtonTexts());
    return finish({ ...base, status: "SKIPPED", skipReason: "NO_APPLY_BUTTON" }, "no-apply-button");
  }
  if (applyBtn.disabled) {
    return finish({ ...base, status: "SKIPPED", skipReason: "DISABLED_BUTTON" }, "disabled-apply-button");
  }

  // Scrape the job NOW (before the apply modal opens) so the cover-letter agent
  // gets a clean job description, not the modal's text.
  const job = scrapeJobContext();

  try {
    log(`clicking apply button: "${(applyBtn.textContent ?? "").trim()}"`);
    sendDebugLog("apply-click", {
      jobId,
      title,
      company,
      buttonText: (applyBtn.textContent ?? "").trim(),
      currentUrl: window.location.href
    });
    applyBtn.click();
    // Proceed as soon as the apply modal renders, not after a fixed guess.
    await waitForApplyModal(6000);

    // If the modal asks for a transcript, attach the user's stored one. If a
    // transcript is required but none is on file (or the field can't be filled),
    // skip the job rather than submitting an incomplete application.
    const transcriptOutcome = await attachStoredTranscript();
    if (transcriptOutcome === "no-transcript-on-file" || transcriptOutcome === "failed") {
      dismissOpenDialog();
      return finish(
        { ...base, status: "SKIPPED", skipReason: "TRANSCRIPT_REQUIRED" },
        `transcript-${transcriptOutcome}`
      );
    }

    // The apply modal may require documents beyond the resume that we can't
    // auto-fill ("Attach other required documents"). Hand control to the user
    // (or a remembered choice) instead of silently failing.
    if (hasOtherRequiredDocs()) {
      return finish(await handleOtherRequiredDocs(base, job), "other-required-docs");
    }

    // Screening questions (Yes/No radios) live in the apply modal. Answer them
    // from the user's stored prefs; if any question can't be confidently
    // answered, skip the job rather than submitting a wrong/partial form.
    if (hasScreeningQuestions()) {
      const outcome = answerScreeningQuestions();
      if (!outcome.ok) {
        log(`screening questions unanswerable (${outcome.reason}); skipping job.`);
        dismissOpenDialog();
        return finish(
          { ...base, status: "SKIPPED", skipReason: "SCREENING_QUESTIONS" },
          `screening-${outcome.reason ?? "unanswerable"}`
        );
      }
      log(`answered ${outcome.answered} screening question(s).`);
      await sleep(600);
    }

    // Cover letter: if the modal asks for one, auto-generate it, let the user
    // review/approve in an overlay, then attach + submit. This branch owns the
    // submit (it's the user's "ok to submit" gate), so it returns a terminal
    // result rather than falling through to the generic submit below.
    if (hasCoverLetterUpload()) {
      return finish(await handleCoverLetterRequest(base, job), "cover-letter-flow");
    }

    // Submit the application. Handshake's document upload can take a moment to
    // finalize and it sometimes renders a secondary confirmation step, so this
    // waits for an enabled Submit, clicks it, and handles any confirm step. Only
    // record APPLIED if it actually completed — otherwise the modal stayed open
    // with a disabled Submit (an unmet required field), so skip rather than log a
    // false "applied".
    const outcome = await clickSubmitAndConfirm("apply");
    if (outcome === "duplicate") {
      dismissOpenDialog();
      return finish({ ...base, status: "SKIPPED", skipReason: "ALREADY_APPLIED" }, "submit-duplicate");
    }
    if (outcome === "incomplete") {
      dismissOpenDialog();
      return finish({ ...base, status: "SKIPPED", skipReason: "SUBMIT_INCOMPLETE" }, "submit-incomplete");
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unexpected error clicking apply";
    return finish({ ...base, status: "FAILED", errorMessage }, "apply-error");
  }

  return finish({ ...base, status: "APPLIED" }, "submitted");
}

// ─── Screening questions ──────────────────────────────────────────────────────
// Handshake's apply modal can include a "Screening Questions" section of Yes/No
// radios (e.g. "Are you authorized to work in the United States?", "Are you
// located in or willing to relocate to Miami?"). We answer them from the user's
// stored prefs. We only handle questions we can answer with confidence (work
// authorization, software/technical degree, English, and location/relocation);
// anything else makes us skip the job rather than guess.

interface ScreeningOutcome {
  ok: boolean;
  answered: number;
  reason?: string;
}

interface AnswerGroup {
  questionText: string;
  yesEl: HTMLElement | null;
  noEl: HTMLElement | null;
}

// Scope the search to the screening section so we don't pick up unrelated
// radios. Falls back to the whole document (the apply modal is the only thing
// with Yes/No screening radios on screen at this point).
function screeningSection(): HTMLElement {
  const byHook = document.querySelector<HTMLElement>(
    '[data-hook="screening-questions"],[data-hook="application-questions"]'
  );
  if (byHook) return byHook;
  const root = findApplyModalRoot() ?? document.body;
  const heading = findShortTextEl(/screening questions/i, 40, root);
  if (!heading) return root;

  let node: HTMLElement | null = heading;
  for (let hops = 0; hops < 8 && node; hops++, node = node.parentElement) {
    const text = (node.textContent ?? "").replace(/\s+/g, " ");
    if (text.includes("?") && collectYesNoOptions(node).length >= 2) return node;
  }
  return heading.parentElement?.parentElement ?? heading.parentElement ?? root;
}

// The human-readable label for a Yes/No control — used to tell the two apart.
function optionLabel(el: HTMLElement): string {
  if (el instanceof HTMLInputElement) {
    if (el.id) {
      const forLabel = document.querySelector<HTMLElement>(`label[for="${CSS.escape(el.id)}"]`);
      if (forLabel?.textContent?.trim()) return forLabel.textContent.trim();
    }
    const wrap = el.closest("label");
    if (wrap?.textContent?.trim()) return wrap.textContent.trim();
    if (el.value) return el.value;
    const sib = el.nextElementSibling;
    if (sib?.textContent?.trim()) return sib.textContent.trim();
    return (el.parentElement?.textContent ?? "").trim();
  }
  return (el.textContent ?? "").trim();
}

function classifyOption(label: string): "yes" | "no" | null {
  const t = label.trim().toLowerCase();
  if (t === "yes" || t.startsWith("yes")) return "yes";
  if (t === "no" || t.startsWith("no")) return "no";
  return null;
}

// Find the Yes/No controls in the section. Prefers real radio inputs; falls back
// to role=radio / clickable labels/buttons whose text is exactly Yes or No.
function collectYesNoOptions(section: HTMLElement): Array<{ value: "yes" | "no"; el: HTMLElement }> {
  const out: Array<{ value: "yes" | "no"; el: HTMLElement }> = [];

  const radios = Array.from(section.querySelectorAll<HTMLInputElement>('input[type="radio"]'));
  for (const r of radios) {
    const v = classifyOption(optionLabel(r));
    if (v) out.push({ value: v, el: r });
  }
  if (out.length > 0) return out;

  const customs = Array.from(
    section.querySelectorAll<HTMLElement>('[role="radio"],label,button')
  );
  for (const c of customs) {
    const text = (c.textContent ?? "").trim();
    if (text.length > 4) continue; // "Yes"/"No" only — skip longer labels
    const v = classifyOption(text);
    if (v) out.push({ value: v, el: c });
  }
  return out;
}

// Pair each question (text ending in "?") with the Yes/No controls that follow
// it, using DOM order. Returns groups with whichever of yes/no we located.
function buildAnswerGroups(section: HTMLElement): AnswerGroup[] {
  const order = new Map<Element, number>();
  let i = 0;
  const walker = document.createTreeWalker(section, NodeFilter.SHOW_ELEMENT);
  for (let n: Node | null = walker.currentNode; n; n = walker.nextNode()) {
    order.set(n as Element, i++);
  }

  // Leaf-most elements whose text is a question (ends with "?"), excluding any
  // whose child also ends with "?" (so we take the actual question line, not a
  // wrapping container).
  const questionEls = Array.from(section.querySelectorAll<HTMLElement>("*")).filter((el) => {
    const t = (el.textContent ?? "").replace(/\s+/g, " ").trim();
    if (!t.endsWith("?") || t.length > 240) return false;
    return !Array.from(el.children).some((c) => (c.textContent ?? "").trim().endsWith("?"));
  });

  const items = [
    ...questionEls.map((el) => ({
      kind: "q" as const,
      ord: order.get(el) ?? 0,
      text: (el.textContent ?? "").replace(/\s+/g, " ").trim()
    })),
    ...collectYesNoOptions(section).map((o) => ({
      kind: "o" as const,
      ord: order.get(o.el) ?? 0,
      value: o.value,
      el: o.el
    }))
  ].sort((a, b) => a.ord - b.ord);

  const groups: AnswerGroup[] = [];
  let current: AnswerGroup | null = null;
  for (const it of items) {
    if (it.kind === "q") {
      current = { questionText: it.text, yesEl: null, noEl: null };
      groups.push(current);
    } else if (current) {
      if (it.value === "yes" && !current.yesEl) current.yesEl = it.el;
      if (it.value === "no" && !current.noEl) current.noEl = it.el;
    }
  }
  return groups.filter((g) => g.yesEl || g.noEl);
}

// Decide Yes/No for a question from the user's prefs, or null if we don't
// recognize it (→ skip the job rather than guess).
function decideScreeningAnswer(questionText: string): "yes" | "no" | null {
  const q = questionText.toLowerCase();

  // Sponsorship is NOT the inverse of work authorization (OPT/CPT holders are
  // authorized yet still need future sponsorship), so we never auto-answer it.
  if (/sponsor/.test(q)) return null;

  // Work authorization / eligibility to work.
  if (/(authoriz|eligib)\w*\s+to\s+work|work\s+(authoriz|eligib)|legally\s+(authoriz|able|eligib)\w*\s+to\s+work|authorized\s+to\s+work/.test(q)) {
    return screeningPrefs.usWorkAuthorized ? "yes" : "no";
  }

  // Degree / major questions in software engineering or closely related
  // technical programs. Keep this narrow so we don't answer unrelated degree
  // requirements (business, design, nursing, etc.) with the software-engineering
  // preference.
  if (
    /(degree|major|minor|stud(y|ying)|pursu(e|ing)|enrolled|student|bachelor|master|phd|graduate)/.test(q) &&
    /(software engineering|computer science|\bcs\b|computer engineering|data science|information systems|informatics|software|computing|computer|engineering)/.test(q)
  ) {
    return screeningPrefs.softwareEngineeringDegree ? "yes" : "no";
  }

  // English-language ability.
  if (
    /(speak|read|write|communicat|fluen|proficien|language).{0,80}english|english.{0,80}(speak|read|write|communicat|fluen|proficien|language)/.test(
      q
    )
  ) {
    return screeningPrefs.speaksEnglish ? "yes" : "no";
  }

  // Location / relocation / commute.
  if (/reloca|located\s+in|location|commut|willing\s+to\s+(relocate|travel|work|move)|based\s+(in|out)|work\s+(on-?site|onsite|in[\s-]person)/.test(q)) {
    if (screeningPrefs.relocateAnywhere) return "yes";
    const matched = screeningPrefs.locations.some(
      (loc) => loc.trim() && q.includes(loc.trim().toLowerCase())
    );
    return matched ? "yes" : "no";
  }

  return null;
}

// Check a radio / click a custom option, firing the events React listens for.
function clickScreeningOption(el: HTMLElement): void {
  if (el instanceof HTMLInputElement) {
    el.checked = true;
    el.click();
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return;
  }
  el.click();
}

function dumpScreening(section: HTMLElement, note: string): void {
  void chrome.runtime
    .sendMessage({
      type: "content/debug-log",
      label: "screening-questions",
      payload: {
        note,
        url: window.location.href,
        radioInputs: section.querySelectorAll('input[type="radio"]').length,
        roleRadios: section.querySelectorAll('[role="radio"]').length,
        html: section.outerHTML.slice(0, 1500)
      }
    })
    .catch(() => {});
}

function answerScreeningQuestions(): ScreeningOutcome {
  const section = screeningSection();
  const groups = buildAnswerGroups(section);
  log(`screening: found ${groups.length} question group(s).`);
  const decisions: Array<{ question: string; decision: "yes" | "no" | null; hasTarget: boolean }> = [];

  if (groups.length === 0) {
    dumpScreening(section, "no-question-groups-found");
    return { ok: false, answered: 0, reason: "no-questions-detected" };
  }

  const unanswered: string[] = [];
  let answered = 0;
  for (const g of groups) {
    const decision = decideScreeningAnswer(g.questionText);
    const target = decision === "yes" ? g.yesEl : decision === "no" ? g.noEl : null;
    decisions.push({ question: g.questionText, decision, hasTarget: !!target });
    if (!decision || !target) {
      unanswered.push(g.questionText);
      continue;
    }
    log(`screening: "${g.questionText.slice(0, 70)}" → ${decision.toUpperCase()}`);
    clickScreeningOption(target);
    answered++;
  }

  sendDebugLog("screening-answers", {
    answered,
    total: groups.length,
    decisions: decisions.map((d) => ({
      question: d.question.slice(0, 180),
      decision: d.decision,
      hasTarget: d.hasTarget
    }))
  });

  if (unanswered.length > 0) {
    dumpScreening(section, `unanswered: ${unanswered.join(" | ").slice(0, 400)}`);
    return { ok: false, answered, reason: "unrecognized-question" };
  }
  return { ok: true, answered };
}

// ─── Background communication ─────────────────────────────────────────────────

function sendDebugLog(label: string, payload: unknown): void {
  log(label, payload);
  void chrome.runtime
    .sendMessage({ type: "content/debug-log", label, payload })
    .catch((err) => {
      noteExtensionContextInvalidated(err);
    });
}

async function reportJobResult(runId: string, result: JobResult): Promise<boolean> {
  sendDebugLog("job-result-report", {
    runId,
    result,
    currentUrl: window.location.href
  });
  try {
    const response = await chrome.runtime.sendMessage({
      type: "content/job-processed",
      runId,
      result
    });
    if (response && typeof response === "object" && "shouldStop" in response) {
      const shouldStop = (response as { shouldStop: boolean }).shouldStop;
      sendDebugLog("job-result-report-response", {
        runId,
        handshakeJobId: result.handshakeJobId,
        shouldStop,
        response
      });
      return !shouldStop;
    }
    sendDebugLog("job-result-report-response", {
      runId,
      handshakeJobId: result.handshakeJobId,
      shouldStop: false,
      response
    });
    return true;
  } catch (err) {
    noteExtensionContextInvalidated(err);
    sendDebugLog("job-result-report-error", {
      runId,
      handshakeJobId: result.handshakeJobId,
      error: err instanceof Error ? err.message : String(err)
    });
    return false;
  }
}

async function reportRunComplete(
  runId: string,
  finalStatus: Exclude<RunStatus, "RUNNING">,
  errorMessage?: string
): Promise<void> {
  try {
    await chrome.runtime.sendMessage({
      type: "content/run-complete",
      runId,
      finalStatus,
      errorMessage
    });
  } catch (err) {
    noteExtensionContextInvalidated(err);
    // Background may have restarted; nothing to do here
  }
}

async function runCurrentDetailOnce(runId: string, settings: Settings): Promise<void> {
  const session = await getSession();
  if (session?.shouldStop) {
    await clearSession();
    await reportRunComplete(runId, "STOPPED");
    return;
  }

  await waitForJobDetailReady(Math.max(2000, settings.applyDelayMs));
  const result = await processCurrentJobPage(window.location.href);
  log("single detail job result", result);
  const shouldContinue = await reportJobResult(runId, result);
  dismissOpenDialog();
  await clearSession();
  await reportRunComplete(runId, shouldContinue ? "COMPLETED" : "STOPPED");
}

// ─── Session-based run continuation ──────────────────────────────────────────
// Called on every page load. List sessions resume the in-place walker; detail
// sessions process the current detail once. The old queue/navigation path was
// intentionally removed because it hard-reloaded between jobs via location.href.

async function continueSessionRun(): Promise<void> {
  const session = await getSession();
  if (!session) {
    log("continueSessionRun: no active session on this page load — idle.");
    return;
  }

  // In-place list walk: Handshake hard-reloaded the search page mid-run. Resume
  // the SAME run where we left off (skipping already-seen jobs) instead of letting
  // the page-memory walker stay dead — and without creating a new backend run.
  if (session.mode === "list") {
    if (session.shouldStop) {
      log("continueSessionRun: list run was stopped; finalizing.");
      await clearSession();
      await reportRunComplete(session.runId, "STOPPED");
      return;
    }
    if (pageSupport !== "supported" || isOnJobDetailPage()) {
      log("continueSessionRun: list session present but not on a search-list page — idle.");
      return;
    }
    log(
      `continueSessionRun: resuming in-place list run ${session.runId} ` +
        `(${session.seenIds?.length ?? 0} seen, ${session.processed ?? 0} processed).`
    );
    if (session.screening) screeningPrefs = normalizeScreeningPrefs(session.screening);
    inPlaceStop = false;
    otherDocsRemembered = session.otherDocsRemembered ?? null;
    setTimeout(
      () =>
        void runListInPlace(session.runId, session.settings, {
          seenIds: session.seenIds ?? [],
          processed: session.processed ?? 0,
          startPage: session.startPage
        }),
      400
    );
    return;
  }

  if (session.mode === "detail") {
    if (session.shouldStop) {
      log("continueSessionRun: detail run was stopped; finalizing.");
      await clearSession();
      await reportRunComplete(session.runId, "STOPPED");
      return;
    }
    if (!isOnJobDetailPage()) {
      log("continueSessionRun: detail session present but current page is not a job detail — clearing.");
      await clearSession();
      await reportRunComplete(session.runId, "FAILED", "Detail run resumed away from a job detail page.");
      return;
    }
    if (session.screening) screeningPrefs = normalizeScreeningPrefs(session.screening);
    otherDocsRemembered = session.otherDocsRemembered ?? null;
    setTimeout(() => void runCurrentDetailOnce(session.runId, session.settings), 400);
    return;
  }

  warn("continueSessionRun: removing stale legacy queue session.");
  await clearSession();
  await reportRunComplete(session.runId, "FAILED", "Removed stale legacy queue session.");
}

// ─── In-place list walker ────────────────────────────────────────────────────
// Instead of hard-navigating to each /jobs/<id> page, walk DOWN the left job
// list: click each card so it loads in the right detail panel (the URL stays on
// /job-search/...), apply there, then move to the next card. This runs entirely
// in one page context — Handshake selects jobs via SPA routing with no reload —
// so it doesn't use the session-storage queue; Stop is a module-level flag.

let inPlaceStop = false;

// Per-page-context singleton for the run orchestration. The background worker
// also rejects a start while a run is active, but its state lives in the MV3
// service worker, which Chrome recycles freely — when it does, that guard is lost
// while this tab's walker keeps running, so a fresh Start would wave through. The
// durable guard therefore has to live here, in the tab. Held by runListInPlace
// for the duration of a walk and checked before starting another, so a duplicate
// start-run (or a duplicate content-script injection) can't spin up a second
// walker that fights the first over the same DOM: double card-selects, double
// pagination, and clobbered session progress.
let runLoopActive = false;

interface JobCard {
  id: string;
  title: string;
  el: HTMLElement;
  isSearch: boolean;
}

// Collect the job cards in the LEFT search-results list. Confirmed via live DOM
// dump: each card is a <div data-hook="job-result-card | <jobId>"> inside
// data-hook="left-content" (NOT an anchor — selection is a click handler, no
// href). The "| <id>" suffix carries the job id. We deliberately key off this
// hook rather than /jobs/<id> anchors because those anchors only exist in the
// right detail panel's "Similar Jobs" section — walking them made the bot apply
// to unrelated jobs. The X dismiss is data-hook="job-hide-button-<id>", the
// bookmark is "favorite-action | …", and the section footer is
// "job-result-card-footer" (excluded by the regex requiring "| <digits>").
function collectJobCards(options?: { quiet?: boolean }): JobCard[] {
  const cards: JobCard[] = [];
  const seen = new Set<string>();
  for (const el of Array.from(
    document.querySelectorAll<HTMLElement>('[data-hook^="job-result-card"]')
  )) {
    const hook = el.getAttribute("data-hook") ?? "";
    const m = hook.match(/^job-result-card\s*\|\s*(\d+)/);
    if (!m) continue; // skips "job-result-card-footer" and any non-id variant
    // Defensive: never walk a card that somehow renders inside the detail panel.
    if (el.closest('[data-hook="right-content"]')) continue;
    const id = m[1];
    if (seen.has(id)) continue;
    seen.add(id);
    const title = (el.textContent ?? "").replace(/\s+/g, " ").trim();
    cards.push({ id, title: title.slice(0, 140), el, isSearch: true });
  }
  if (!options?.quiet) {
    log(`collectJobCards: ${cards.length} left-list cards (job-result-card hooks)`);
  }
  return cards;
}

// Cheap fingerprint of what the detail panel currently shows, to detect a swap.
function detailSignature(): string {
  const { title, company } = extractJobMeta();
  const apply = findApplyButton();
  return `${title}|${company}|${(apply?.textContent ?? "").trim()}`;
}

function waitFor(predicate: () => boolean, timeoutMs: number, intervalMs = 150): Promise<boolean> {
  return new Promise((resolve) => {
    const start = Date.now();
    const tick = () => {
      if (predicate()) return resolve(true);
      if (Date.now() - start >= timeoutMs) return resolve(false);
      setTimeout(tick, intervalMs);
    };
    tick();
  });
}

// After a DOM-changing click (apply, card select, navigation) we used to wait a
// fixed guess (e.g. sleep(1500)) for React to hydrate. These helpers instead poll
// for the thing we're actually waiting on and return the moment it's there — so a
// fast page proceeds in ~200ms instead of always paying the worst case. A short
// settle after the condition lets the final frame paint before we read the DOM,
// which preserves the reliability the old fixed waits were protecting.
const SETTLE_MS = 200;

// Resolves once the apply modal has rendered after clicking Apply: the dialog, a
// submit/confirm control, an upload section (cover letter / other docs), screening
// questions, or an already-applied/closed state all count.
async function waitForApplyModal(timeoutMs = 6000): Promise<void> {
  await waitFor(
    () =>
      !!findApplyModalRoot() ||
      !!findSubmitOrConfirm() ||
      hasCoverLetterUpload() ||
      hasOtherRequiredDocs() ||
      hasScreeningQuestions() ||
      isAlreadyApplied(),
    timeoutMs
  );
  await sleep(SETTLE_MS);
}

// Resolves once a job's detail view has hydrated enough to read/act on: an apply
// control, an applied badge, or the job-title element is present.
async function waitForJobDetailReady(timeoutMs = 6000): Promise<void> {
  await waitFor(
    () =>
      !!findApplyButton() ||
      isAlreadyApplied() ||
      isExternalApply() ||
      !!document.querySelector('[data-hook="job-title"]'),
    timeoutMs
  );
  await sleep(SETTLE_MS);
}

// Close any application modal/dialog that's open so the next card's detail shows.
function dismissOpenDialog(): void {
  const applyModal = findApplyModalRoot();
  const closeBtn = (applyModal ?? document).querySelector<HTMLElement>(
    '[data-hook="modal-close"],[aria-label="Close"],[aria-label="close"],button[class*="close" i]'
  );
  if (closeBtn) {
    closeBtn.click();
    return;
  }
  document.body.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true })
  );
}

// One-time dump of the first few cards' structure to the extension console so we can
// verify Handshake's real list markup and refine click selectors if needed.
function dumpListCards(cards: JobCard[]): void {
  const sample = cards.slice(0, 8).map((c) => {
    const row = c.el.closest('li,[role="listitem"],article,[data-hook]') as HTMLElement | null;
    return {
      id: c.id,
      title: c.title.slice(0, 60),
      anchorHref: c.el.getAttribute("href"),
      anchorTarget: c.el.getAttribute("target"),
      isSearchLink: c.isSearch,
      rowTag: row?.tagName ?? null,
      rowRole: row?.getAttribute("role") ?? null,
      rowHook: row?.getAttribute("data-hook") ?? null,
      rowClass: typeof row?.className === "string" ? row.className.slice(0, 160) : null
    };
  });
  log("list cards", sample);
  void chrome.runtime
    .sendMessage({
      type: "content/debug-log",
      label: "list-cards",
      payload: { url: window.location.href, count: cards.length, sample }
    })
    .catch(() => {});
}

function isScrollableY(el: HTMLElement): boolean {
  const oy = getComputedStyle(el).overflowY;
  return (oy === "auto" || oy === "scroll") && el.scrollHeight > el.clientHeight + 20;
}

// Find the scrollable list container so we can load more virtualized cards.
// Handshake's list virtualization does not always put the scroller as an
// ancestor of the individual card; sometimes the scrollable element is a sibling
// wrapper under left-content. Look both around the card and inside the left pane
// before falling back to the document scroller.
function findScrollContainer(el: HTMLElement | null): HTMLElement | null {
  let node: HTMLElement | null = el?.parentElement ?? null;
  while (node) {
    if (isScrollableY(node)) return node;
    node = node.parentElement;
  }

  const leftPane = document.querySelector<HTMLElement>('[data-hook="left-content"]');
  const paneCandidates = leftPane
    ? [leftPane, ...Array.from(leftPane.querySelectorAll<HTMLElement>("*"))]
    : [];
  const bestPaneScroller =
    paneCandidates
      .filter(isScrollableY)
      .sort((a, b) => b.scrollHeight - a.scrollHeight)[0] ?? null;
  if (bestPaneScroller) return bestPaneScroller;

  const doc = document.scrollingElement;
  return doc instanceof HTMLElement && doc.scrollHeight > doc.clientHeight + 20 ? doc : null;
}

function isNearScrollBottom(el: HTMLElement): boolean {
  return el.scrollTop + el.clientHeight >= el.scrollHeight - 24;
}

// When selecting a card fails, dump the card's DOM so we can see where the select
// handler actually lives (tag/hook/role/class of the card and its first few
// descendants, plus its outerHTML head).
function dumpSelectMiss(card: JobCard): void {
  const describe = (node: HTMLElement) => ({
    tag: node.tagName,
    hook: node.getAttribute("data-hook"),
    role: node.getAttribute("role"),
    cls: typeof node.className === "string" ? node.className.slice(0, 90) : null
  });
  void chrome.runtime
    .sendMessage({
      type: "content/debug-log",
      label: "select-card-miss",
      payload: {
        id: card.id,
        url: window.location.href,
        card: describe(card.el),
        children: Array.from(card.el.children)
          .filter((c): c is HTMLElement => c instanceof HTMLElement)
          .slice(0, 6)
          .map(describe),
        html: card.el.outerHTML.slice(0, 600)
      }
    })
    .catch(() => {});
}

// Select a card so its detail loads in the right panel. The reliable success
// signal is the URL: Handshake routes an in-panel selection to /job-search/<id>
// (no reload — the id just lands in the address bar; the run's sourceUrl proves
// this). The card is a <div data-hook="job-result-card | <id>"> whose click
// handler selects the job. We click the card BODY (a content child, skipping the
// footer that holds the bookmark + X "hide" buttons), then the card root, then
// climb a couple ancestors — checking the URL after each — so we hit the select
// handler wherever React put it without tripping the hide/save controls. Returns
// whether the card actually became selected.
async function selectCard(card: JobCard): Promise<boolean> {
  const onThisCard = () => window.location.href.includes(`/job-search/${card.id}`);

  // First card is pre-selected on load — already showing, nothing to click.
  if (onThisCard()) {
    log(`card ${card.id} already selected (URL match); processing without a click.`);
    sendDebugLog("card-select", {
      id: card.id,
      title: card.title,
      selected: true,
      alreadySelected: true,
      currentUrl: window.location.href
    });
    return true;
  }

  try {
    card.el.scrollIntoView({ block: "center" });
  } catch {
    /* element may have been recycled by the virtual list */
  }
  await sleep(250);

  // Elements we must NOT click — they'd hide/bookmark the job instead of opening it.
  const footer = card.el.querySelector<HTMLElement>('[data-hook="job-result-card-footer"]');
  const hideBtn = card.el.querySelector<HTMLElement>('[data-hook^="job-hide-button"]');
  const fav = card.el.querySelector<HTMLElement>('[data-hook^="favorite-action"]');
  const isInteractive = (node: HTMLElement | null) =>
    !!node &&
    ((footer && footer.contains(node)) ||
      (hideBtn && hideBtn.contains(node)) ||
      (fav && fav.contains(node)));

  // A content child of the card (not the footer/buttons): clicking it bubbles up
  // through every wrapper between it and the card root, so it hits the select
  // handler whatever level holds it.
  const body =
    Array.from(card.el.children).find(
      (c): c is HTMLElement => c instanceof HTMLElement && !isInteractive(c)
    ) ?? null;

  const candidates: HTMLElement[] = [];
  if (body) candidates.push(body);
  candidates.push(card.el);
  let anc = card.el.parentElement;
  for (let i = 0; i < 2 && anc; i++, anc = anc.parentElement) candidates.push(anc);

  for (const target of candidates) {
    if (isInteractive(target)) continue;
    target.click();
    if (await waitFor(onThisCard, 1200)) {
      log(
        `card ${card.id} "${card.title.slice(0, 50)}" selected via ` +
          `<${target.tagName.toLowerCase()}${target.getAttribute("data-hook") ? ` data-hook=${target.getAttribute("data-hook")}` : ""}>.`
      );
      sendDebugLog("card-select", {
        id: card.id,
        title: card.title,
        selected: true,
        alreadySelected: false,
        targetTag: target.tagName,
        targetHook: target.getAttribute("data-hook"),
        currentUrl: window.location.href
      });
      return true;
    }
  }

  warn(`could not select card ${card.id}: URL never became /job-search/${card.id}. Dumping its DOM.`);
  sendDebugLog("card-select", {
    id: card.id,
    title: card.title,
    selected: false,
    currentUrl: window.location.href
  });
  dumpSelectMiss(card);
  return false;
}

// ─── Pagination ───────────────────────────────────────────────────────────────
// When the current results page is exhausted, advance to the next page of search
// results. Handshake's job search carries the page in the URL (?page=N&per_page=…)
// and renders the next page in place (React Router, no full reload), so we detect
// success by the page param incrementing or the visible card set changing.

function currentPageNumber(): number {
  const p = new URLSearchParams(window.location.search).get("page");
  const n = p ? parseInt(p, 10) : 1;
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function isJobSearchUrl(url = window.location.href): boolean {
  try {
    return new URL(url).pathname.includes("/job-search");
  } catch {
    return false;
  }
}

function isDisabledEl(el: HTMLElement): boolean {
  if ((el as HTMLButtonElement).disabled) return true;
  if (el.getAttribute("aria-disabled") === "true") return true;
  if (el.hasAttribute("disabled")) return true;
  return false;
}

function isVisibleEl(el: HTMLElement): boolean {
  return el.getClientRects().length > 0;
}

function paginationRoot(): HTMLElement | null {
  const explicit = Array.from(
    document.querySelectorAll<HTMLElement>(
      '[aria-label*="pagination" i],[data-hook*="pagination" i]'
    )
  ).find((el) => el.querySelector('a[href*="page="],a[href*="job-search"],button,[role="button"]'));
  if (explicit) return explicit;

  const pageLink = Array.from(
    document.querySelectorAll<HTMLAnchorElement>('a[href*="page="][href*="job-search"]')
  ).find(isVisibleEl);
  if (!pageLink) return null;

  let node: HTMLElement | null = pageLink.parentElement;
  for (let hops = 0; hops < 6 && node; hops++, node = node.parentElement) {
    const numberedControls = Array.from(node.querySelectorAll<HTMLElement>('a,button,[role="button"]'))
      .filter(isVisibleEl)
      .filter((el) => pageNumberForControl(el) !== null);
    if (numberedControls.length >= 2) return node;
  }

  return pageLink.parentElement;
}

function pageNumberForControl(el: HTMLElement): number | null {
  const text = (el.textContent ?? "").trim();
  if (/^\d+$/.test(text)) {
    const n = parseInt(text, 10);
    return Number.isFinite(n) ? n : null;
  }

  const aria = el.getAttribute("aria-label") ?? "";
  const labelledPage = aria.match(/\bpage\s+(\d+)\b/i);
  if (labelledPage) {
    const n = parseInt(labelledPage[1], 10);
    return Number.isFinite(n) ? n : null;
  }

  return null;
}

function findNextPageControl(): HTMLElement | null {
  const nextPage = currentPageNumber() + 1;
  const root = paginationRoot();
  if (!root) {
    dumpWalker("next-page-no-pagination-root", { page: currentPageNumber() });
    return null;
  }

  // 1. Explicit "next" aria-label / data-hook on a button or link.
  const byAria = Array.from(
    root.querySelectorAll<HTMLElement>(
      'a[aria-label*="next" i],button[aria-label*="next" i],[data-hook*="next" i]'
    )
  ).find((el) => !isDisabledEl(el) && isVisibleEl(el));
  if (byAria) return byAria;

  // 2. A pagination link that points at page N+1.
  const byHref = Array.from(
    root.querySelectorAll<HTMLAnchorElement>('a[href*="page="]')
  ).find((a) => {
    if (!/\/job-search/.test(a.pathname)) return false;
    const ap = new URLSearchParams(a.search).get("page");
    return ap !== null && parseInt(ap, 10) === nextPage;
  });
  if (byHref && !isDisabledEl(byHref) && isVisibleEl(byHref)) return byHref;

  // 3. A button/link whose visible text is the next page number, or "Next" / a
  //    next-arrow glyph.
  const orderedCandidates = Array.from(
    root.querySelectorAll<HTMLElement>('a,button,[role="button"]')
  ).filter(isVisibleEl);
  const candidates = orderedCandidates.filter((el) => !isDisabledEl(el));
  const byNumber = candidates.find(
    (el) => pageNumberForControl(el) === nextPage
  );
  if (byNumber) return byNumber;
  const byText = candidates.find((el) => {
    const t = (el.textContent ?? "").trim().toLowerCase();
    return t === "next" || t === "next page" || t === "›" || t === ">" || t === "→";
  });
  if (byText) return byText;

  // 4. Icon-only pagination, like:
  //    <<  <  1  ...  3  4  ...  400  >  >>
  // The "5" control is not visible, and the single-chevron button may have no
  // text/aria label. In that case, find the current page in the pagination row
  // and click the first enabled non-number control after it. That is the single
  // next-page arrow; the second such control is the jump-to-last arrow.
  const currentPage = currentPageNumber();
  const currentIdx = orderedCandidates.findIndex((el) => {
    const ariaCurrent = el.getAttribute("aria-current");
    return ariaCurrent === "page" || ariaCurrent === "true" || pageNumberForControl(el) === currentPage;
  });
  if (currentIdx >= 0) {
    const afterCurrent = orderedCandidates.slice(currentIdx + 1).find((el) => {
      const t = (el.textContent ?? "").trim();
      if (isDisabledEl(el) || pageNumberForControl(el) !== null || t === "..." || t === "…") {
        return false;
      }
      if (el instanceof HTMLAnchorElement) {
        const href = el.getAttribute("href") ?? "";
        return href === "" || /\/job-search/.test(el.pathname);
      }
      return true;
    });
    if (afterCurrent) return afterCurrent;
  }

  return null;
}

function dumpNextPageMiss(): void {
  const root = paginationRoot();
  const payload = {
    url: window.location.href,
    currentPage: currentPageNumber(),
    paginationOuterHtml: root ? root.outerHTML.slice(0, 1500) : null,
    pageLinks: Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href*="page="]'))
      .slice(0, 12)
      .map((a) => ({ text: (a.textContent ?? "").trim().slice(0, 20), href: a.getAttribute("href") })),
    controls: Array.from((root ?? document).querySelectorAll<HTMLElement>('a,button,[role="button"]'))
      .slice(0, 20)
      .map((el) => ({
        tag: el.tagName,
        text: (el.textContent ?? "").trim().slice(0, 20),
        ariaLabel: el.getAttribute("aria-label"),
        ariaCurrent: el.getAttribute("aria-current"),
        dataHook: el.getAttribute("data-hook"),
        disabled: isDisabledEl(el),
        visible: isVisibleEl(el)
      }))
  };
  log("next-page miss", payload);
  void chrome.runtime
    .sendMessage({ type: "content/debug-log", label: "next-page-miss", payload })
    .catch(() => {});
}

// The highest page number shown in the pagination (e.g. 400 in "1 2 3 … 400"), so
// we know when we're on the last page. null if not found.
function lastPageNumber(): number | null {
  const root = paginationRoot();
  if (!root) return null;
  const nums = Array.from(root.querySelectorAll<HTMLElement>('a,button,[role="button"]'))
    .map((el) => parseInt((el.textContent ?? "").trim(), 10))
    .filter((n) => Number.isFinite(n) && n > 0);
  return nums.length ? Math.max(...nums) : null;
}

// Advance to the next results page by CLICKING the pager (the "›"/numbered
// control). Stays inside Handshake's SPA — no full-page reload — so the walk
// continues seamlessly in one context. Returns false (→ finish gracefully) when
// we're already on the last page or the click doesn't take, rather than forcing a
// jarring reload.
async function goToNextPage(): Promise<boolean> {
  const beforePage = currentPageNumber();
  const beforeUrl = window.location.href;

  if (!isJobSearchUrl(beforeUrl)) {
    dumpWalker("next-page-not-on-search", { page: beforePage });
    return false;
  }

  const last = lastPageNumber();
  if (last !== null && beforePage >= last) {
    dumpWalker("next-page-end", { page: beforePage, lastPage: last });
    return false;
  }

  const beforeIds = collectJobCards()
    .map((c) => c.id)
    .join(",");
  const control = findNextPageControl();
  if (!control) {
    dumpNextPageMiss();
    dumpWalker("next-page-no-control", { page: beforePage });
    return false;
  }

  log(`Clicking next page (from page ${beforePage}).`);
  if (control instanceof HTMLAnchorElement && !isJobSearchUrl(control.href)) {
    dumpWalker("next-page-rejected-non-search-link", {
      page: beforePage,
      href: control.getAttribute("href")
    });
    return false;
  }
  if (control instanceof HTMLAnchorElement && control.target === "_blank") {
    control.target = "_self";
  }
  control.scrollIntoView({ block: "center" });
  control.click();

  // Success = the URL page advanced OR the visible card set changed.
  const advanced = await waitFor(() => {
    if (!isJobSearchUrl()) return true;
    if (currentPageNumber() > beforePage) return true;
    const nowIds = collectJobCards()
      .map((c) => c.id)
      .join(",");
    return nowIds !== "" && nowIds !== beforeIds;
  }, 8000);

  if (!isJobSearchUrl()) {
    // The pager click navigated us off the search page (e.g. a stray link opened a
    // job detail). Do NOT force window.location back to the list: a hard reload
    // here is exactly the jarring "page restart" this in-place walk exists to
    // avoid, and because a list run resumes itself from session storage, the
    // reloaded page would re-enter the walk and could loop. End this page's walk
    // gracefully instead and let the caller finalize the run.
    dumpWalker("next-page-left-search", { from: beforeUrl, to: window.location.href });
    return false;
  }

  if (!advanced) {
    dumpWalker("next-page-failed", { page: beforePage });
    return false;
  }
  await sleep(1000); // let the new page hydrate
  dumpWalker("next-page-clicked", { from: beforePage, to: currentPageNumber() });
  return true;
}

// Forward a walker decision to the background worker's console. These diagnostics
// remain local to Chrome and are not persisted by the backend.
function dumpWalker(event: string, payload: Record<string, unknown>): void {
  log(`walker:${event}`, payload);
  void chrome.runtime
    .sendMessage({
      type: "content/debug-log",
      label: "walker",
      payload: { event, url: window.location.href, ...payload }
    })
    .catch(() => {});
}

// Public entry for the in-place walker. Enforces the run-loop singleton (see
// runLoopActive): if a walk is already running in this context we ignore the
// duplicate start rather than launch a second walker against the same list. The
// flag is released in finally so an unexpected throw can't wedge it true and
// block every future run. The actual walk lives in runListInPlaceWalk.
async function runListInPlace(
  runId: string,
  settings: Settings,
  resume?: { seenIds: string[]; processed: number; startPage?: number }
): Promise<void> {
  if (runLoopActive) {
    warn("runListInPlace: a walker is already active in this context; ignoring duplicate start.");
    return;
  }
  runLoopActive = true;
  try {
    await runListInPlaceWalk(runId, settings, resume);
  } finally {
    runLoopActive = false;
  }
}

async function runListInPlaceWalk(
  runId: string,
  settings: Settings,
  resume?: { seenIds: string[]; processed: number; startPage?: number }
): Promise<void> {
  const maxPages = Math.max(1, settings.maxPagesPerRun);
  const cap = Math.max(25, maxPages * 25);
  const seen = new Set<string>(resume?.seenIds ?? []);
  let processed = resume?.processed ?? 0;
  let staleScrolls = 0;
  // Pages visited counts from the run's start page so the page limit holds across
  // the reloads a URL page-nav causes (a local counter would reset each reload).
  const startPage = resume?.startPage ?? currentPageNumber();
  const pagesVisited = () => currentPageNumber() - startPage + 1;
  let scroller: HTMLElement | null = null;

  log(
    `runListInPlace: walking the list in place, cap ${cap}, up to ${maxPages} page(s)` +
      (resume ? ` (resumed: ${seen.size} already seen, ${processed} processed).` : ".")
  );

  while (!inPlaceStop && processed < cap) {
    let fresh = collectJobCards().filter((c) => !seen.has(c.id));

    // The left list briefly goes EMPTY right after we apply to a job and dismiss
    // its modal (Handshake re-renders it). That transient empty is not end-of-page
    // — misreading it as "scroll/advance" was the cause of the stalls and skipped
    // jobs. When the list reads empty, wait a moment for it to repopulate before
    // deciding anything. (Only when truly empty — a full-but-all-seen list falls
    // straight through to the scroll-for-more path below.)
    if (fresh.length === 0 && collectJobCards().length === 0) {
      const repopulated = await waitFor(() => collectJobCards().length > 0, 3000);
      if (repopulated) {
        fresh = collectJobCards().filter((c) => !seen.has(c.id));
      }
    }

    if (fresh.length === 0) {
      const all = collectJobCards();
      // Virtualized list — only a handful of cards are in the DOM at once. Render
      // the NEXT batch by scrolling the last rendered card into view: that advances
      // by exactly the rendered height, so the next cards load contiguously (a
      // fixed scrollBy can overshoot unrendered rows, skipping jobs, or hit the
      // wrong container and do nothing — the likely "stops after ~5 jobs" cause).
      if (staleScrolls >= 6) {
        dumpWalker("scroll-exhausted", {
          processed,
          seen: seen.size,
          rendered: all.length,
          page: currentPageNumber(),
          pagesVisited: pagesVisited(),
          scrollerFound: !!scroller,
          scrollerAtBottom: scroller ? isNearScrollBottom(scroller) : null,
          scrollTop: scroller?.scrollTop ?? null,
          scrollHeight: scroller?.scrollHeight ?? null,
          clientHeight: scroller?.clientHeight ?? null
        });

        // If the visible list is virtualized and the scroller is not at the
        // bottom yet, the current DOM batch is exhausted but the current page is
        // not. Force one larger nudge; only advance pages if the scroller itself
        // refuses to move.
        if (scroller && !isNearScrollBottom(scroller)) {
          const beforeForceTop = scroller.scrollTop;
          scroller.scrollBy({ top: Math.round(scroller.clientHeight * 1.5), behavior: "auto" });
          await sleep(700);
          const afterForceTop = scroller.scrollTop;
          dumpWalker("scroll-force", {
            beforeForceTop,
            afterForceTop,
            moved: afterForceTop !== beforeForceTop,
            scrollerAtBottom: isNearScrollBottom(scroller)
          });
          if (afterForceTop !== beforeForceTop) {
            staleScrolls = 0;
            continue;
          }
        }

        if (pagesVisited() >= maxPages) {
          dumpWalker("page-limit-reached", { maxPages, page: currentPageNumber(), processed });
          break;
        }
        const advanced = await goToNextPage();
        if (!advanced) {
          dumpWalker("next-page-failed", { page: currentPageNumber(), processed });
          break;
        }
        staleScrolls = 0;
        scroller = null; // re-acquire the scroll container on the new page
        await sleep(600);
        continue;
      }
      const last = all[all.length - 1] ?? null;
      scroller =
        scroller ??
        findScrollContainer(last?.el ?? document.querySelector('[data-hook^="job-result-card"]'));
      const beforeTop = scroller?.scrollTop ?? null;
      try {
        last?.el.scrollIntoView({ block: "end", behavior: "auto" });
      } catch {
        /* card may have been recycled by the virtual list */
      }
      // Nudge the container/window too, in case the last card was already in view.
      if (scroller) {
        scroller.scrollBy({ top: Math.round(scroller.clientHeight * 0.9) });
      } else {
        window.scrollBy(0, Math.round(window.innerHeight * 0.9));
      }
      staleScrolls++;
      dumpWalker("scroll", {
        attempt: staleScrolls,
        rendered: all.length,
        seen: seen.size,
        scrollerFound: !!scroller,
        scrollTopBefore: beforeTop,
        scrollTopAfter: scroller?.scrollTop ?? null,
        scrollerAtBottom: scroller ? isNearScrollBottom(scroller) : null
      });
      await sleep(900);
      continue;
    }

    staleScrolls = 0;
    for (const card of fresh) {
      if (inPlaceStop || processed >= cap) break;
      seen.add(card.id);
      // Persist BEFORE applying: if Handshake hard-reloads mid-application, the
      // resumed walker skips this job rather than re-submitting it.
      await persistListProgress(seen, processed);
      try {
        const selected = await selectCard(card);
        if (!selected) {
          // The detail panel never switched to this job. Record a skip and move
          // on — DO NOT process, or we'd apply to / read "already applied" from
          // whatever job is still showing (the bug that made the bot look stuck).
          processed++;
          const { company } = extractJobMeta();
          await reportJobResult(runId, {
            handshakeJobId: card.id,
            jobUrl: window.location.href,
            title: card.title.slice(0, 80),
            company,
            status: "SKIPPED",
            skipReason: "SELECT_FAILED"
          });
          await sleep(300);
          continue;
        }
        await waitForJobDetailReady(Math.max(2000, settings.applyDelayMs)); // let the detail hydrate
        const result = await processCurrentJobPage(window.location.href, card.id);
        if (!result.title || result.title === "Unknown Title") result.title = card.title.slice(0, 80);
        log("job result", result);
        processed++;
        await persistListProgress(seen, processed);
        const shouldContinue = await reportJobResult(runId, result);
        dismissOpenDialog();
        await sleep(300);
        scroller = scroller ?? findScrollContainer(card.el);
        if (!shouldContinue) {
          dumpWalker("background-stop", { processed, lastJob: card.id });
          await clearSession();
          await reportRunComplete(runId, "STOPPED");
          return;
        }
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : "Unexpected error processing job card.";
        warn(`error processing card ${card.id}`, err);
        processed++;
        await persistListProgress(seen, processed);
        const { company } = extractJobMeta();
        const shouldContinue = await reportJobResult(runId, {
          handshakeJobId: card.id,
          jobUrl: window.location.href,
          title: card.title.slice(0, 80) || "Unknown Title",
          company,
          status: "FAILED",
          errorMessage
        });
        dismissOpenDialog();
        if (!shouldContinue) {
          dumpWalker("background-stop-after-error", { processed, lastJob: card.id, errorMessage });
          await clearSession();
          await reportRunComplete(runId, "STOPPED");
          return;
        }
        await sleep(300);
      }
    }
  }

  dumpWalker("finalize", {
    processed,
    reason: inPlaceStop ? "stopped-flag" : processed >= cap ? "cap-reached" : "loop-exited",
    cap
  });
  await clearSession();
  await reportRunComplete(runId, inPlaceStop ? "STOPPED" : "COMPLETED");
}

// ─── Cover-letter attach & submit ─────────────────────────────────────────────
// The apply modal's cover-letter field is a document picker ("Search your cover
// letters" or "Upload new"), NOT a text box — so a generated letter has to be
// attached as a file. The background worker renders the letter to a PDF and ships
// the bytes here as base64; we rebuild a File, set it on the cover-letter file
// input via DataTransfer (the only way to programmatically fill a file input),
// fire the input/change events React listens for, then click Submit once the
// form validates.

function base64ToUint8Array(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// Locate the file input that belongs to the cover-letter section. Handshake
// renders a hidden <input type="file"> behind the "Upload new" button; the resume
// section has its own (already populated) input, so we must not target that one.
function findCoverLetterFileInput(): HTMLInputElement | null {
  const root = findApplyModalRoot() ?? document;
  const inputs = Array.from(root.querySelectorAll<HTMLInputElement>('input[type="file"]'));
  if (inputs.length === 0) return null;

  // Handshake gives this input a stable semantic name such as
  // "file-Cover Letter". Prefer that over positional guesses because React can
  // leave hidden inputs from a previous/remounted modal in the document.
  const named = inputs.find(inputLooksLikeCoverLetter);
  if (named) return named;

  // 1) Anchor on the "cover letter" heading and take the nearest file input within
  //    its surrounding container.
  const heading = Array.from(root.querySelectorAll<HTMLElement>("h1,h2,h3,h4,h5,label,div,span,p")).find(
    (el) => /attach your cover letter|cover letter/i.test((el.textContent ?? "").trim()) &&
      (el.textContent ?? "").trim().length < 60
  );
  if (heading) {
    let container: HTMLElement | null = heading;
    for (let hops = 0; hops < 5 && container; hops++) {
      const candidates = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="file"]'));
      const afterHeading = candidates.filter((candidate) =>
        !!(heading.compareDocumentPosition(candidate) & Node.DOCUMENT_POSITION_FOLLOWING)
      );
      const candidate =
        afterHeading.find((i) => !i.files || i.files.length === 0) ??
        afterHeading[0] ??
        null;
      if (candidate) return candidate;
      container = container.parentElement;
    }
  }

  // 2) Otherwise prefer an EMPTY input (the resume one usually already holds a file).
  const empty = inputs.find((i) => !i.files || i.files.length === 0);
  if (empty) return empty;

  // 3) Last resort: the last file input — the cover-letter section sits below the
  //    resume section in the modal.
  return inputs[inputs.length - 1];
}

function inputLooksLikeCoverLetter(input: HTMLInputElement): boolean {
  const fingerprint = [
    input.name,
    input.id,
    input.getAttribute("aria-label"),
    input.getAttribute("data-hook"),
    input.getAttribute("data-testid")
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
  return fingerprint.includes("coverletter");
}

function setFileOnInput(input: HTMLInputElement, file: File): void {
  const dt = new DataTransfer();
  dt.items.add(file);
  input.files = dt.files;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

// Re-query each tick — the submit button may be re-rendered as the form validates.
async function waitForEnabledSubmit(timeoutMs: number): Promise<HTMLButtonElement | null> {
  const findSubmit = () => findButtonByText(["submit application", "submit & continue", "submit"]);
  await waitFor(() => {
    const b = findSubmit();
    return !!b && !b.disabled;
  }, timeoutMs);
  const btn = findSubmit();
  return btn && !btn.disabled ? btn : null;
}

// Find the apply modal's submit/confirm button. Kept broad because Handshake's
// final button is labelled "Submit Application" but a secondary confirmation step
// can render a plain "Submit" or "Confirm".
function findApplyModalRoot(): HTMLElement | null {
  const dialogs = Array.from(
    document.querySelectorAll<HTMLElement>('[role="dialog"],[aria-modal="true"]')
  );
  const dialog =
    dialogs.find((candidate) => {
      const text = (candidate.innerText ?? candidate.textContent ?? "").replace(/\s+/g, " ").toLowerCase();
      if (/it.?s better on the app|everything the website does/i.test(text)) return false;
      return (
        /submit application|cover letter|transcript|screening questions|application questions|other required documents/.test(
          text
        ) || !!buttonByTextWithin(candidate, ["submit application", "submit & continue"])
      );
    }) ?? null;
  if (dialog) return dialog;

  // Some Handshake releases mount the application as a form without dialog
  // semantics. Recover its root from a distinctive document picker and require a
  // visible submit control so a hidden, stale picker from a closed modal does not
  // masquerade as the active application.
  const picker = Array.from(
    document.querySelectorAll<HTMLElement>(
      '[data-hook="apply-modal-document-search"],input[type="file"],input[placeholder]'
    )
  ).find((el) => {
    if (el instanceof HTMLInputElement && inputLooksLikeCoverLetter(el)) return true;
    return /cover letter|transcript/i.test(
      `${el.getAttribute("placeholder") ?? ""} ${el.textContent ?? ""}`
    );
  });
  let node: HTMLElement | null = picker ?? null;
  for (let hops = 0; hops < 10 && node; hops++, node = node.parentElement) {
    if (buttonByTextWithin(node, ["submit application", "submit & continue"])) return node;
  }
  return null;
}

function findSubmitOrConfirm(): HTMLButtonElement | null {
  const root = findApplyModalRoot() ?? document;
  return buttonByTextWithin(root, [
    "submit application",
    "submit & continue",
    "submit",
    "confirm application",
    "complete application",
    "confirm"
  ]);
}

// True once the application has actually gone through. The DECISIVE signal is the
// apply modal itself: while it's open with an ENABLED Submit/Confirm button the
// application is NOT submitted — no matter what "applied"-looking text sits on the
// page behind it (a previously-applied job card, an "N applied to this job" blurb,
// the search-result count). Trusting that stray page text was the bug: it made
// clickSubmitAndConfirm conclude the application was already in and SKIP clicking
// Submit, recording APPLIED for applications still sitting in a filled, open modal
// (the cover-letter PDF attached but never submitted). The two positive checks are
// now scoped to the modal so background text can't trip them.
function applicationLooksSubmitted(afterSubmitClick = false): boolean {
  const modal = findApplyModalRoot();
  const submit = findSubmitOrConfirm();
  const successText =
    /application submitted|successfully applied|you have applied|application sent|application received|thanks for applying|your application (?:has been |was )?(?:submitted|sent|received)/i;

  // Positive confirmation, scoped to the modal when one is open. If the modal is
  // gone, body-level success text only counts after a submit/confirm click; before
  // that, it could be a stale toast or unrelated page text.
  const scope = modal ?? document.body;
  if (
    (modal || afterSubmitClick) &&
    findShortTextEl(successText, 90, scope)
  )
    return true;
  if (
    modal &&
    (modal.querySelector(
      '[data-hook="applied-badge"],[aria-label="Applied"],[class*="applied-badge" i]'
    ) ||
      buttonByTextWithin(modal, ["applied", "application submitted", "withdraw application"]))
  )
    return true;

  // Handshake currently leaves the filled apply modal mounted after a successful
  // submission while changing the current job action to "Withdraw application".
  // Once this helper has actually clicked Submit, that job-level state is
  // authoritative even if the stale modal still contains an enabled button.
  // Do not trust a body-level success toast here because a previous job's toast
  // can remain visible briefly while the next job opens.
  if (afterSubmitClick && isAlreadyApplied()) return true;

  // Open modal with an actionable submit/confirm → not submitted yet. This check
  // intentionally comes AFTER the scoped applied/withdraw checks above: Handshake
  // can render "Applied on <date> / Withdraw application" inside the apply modal
  // while still leaving a Submit button enabled. In that state, clicking Submit
  // triggers "User cannot have multiple open applications on the same job."
  if (modal && submit && !submit.disabled) return false;

  // The apply modal has closed and no submit/confirm control remains → the flow
  // finished, but only after this submit helper actually clicked a submit/confirm
  // control. Before the click, "no modal and no submit" can also mean our apply
  // modal selector missed Handshake's DOM, or the modal never opened; counting that
  // as success would create a false APPLIED record.
  if (afterSubmitClick && !modal && !submit) return true;

  return false;
}

function visibleSnippet(el: HTMLElement | null, max = 220): string | null {
  const text = (el?.innerText ?? el?.textContent ?? "").replace(/\s+/g, " ").trim();
  return text ? text.slice(0, max) : null;
}

// Handshake rejects a second application to a job the user already has an OPEN
// application for, surfacing a top-level toast: "User cannot have multiple open
// applications on the same job." It renders OUTSIDE the apply modal, so the
// modal-scoped applicationLooksSubmitted()/submitBlockingMessages() never see it —
// and clickSubmitAndConfirm would otherwise keep clicking Submit, each click
// stacking another error toast. The submit helper snapshots pre-existing alerts
// so a stale toast from the previous job cannot block the current job.
function duplicateApplicationAlertElements(): HTMLElement[] {
  const re =
    /multiple open applications|cannot apply to one job multiple times|one job multiple times|already have an open application|you (?:have )?already applied|already applied to this|application already exists/i;
  return Array.from(
    document.querySelectorAll<HTMLElement>('[role="alert"],[aria-live]')
  ).filter((el) => isElementVisible(el) && re.test(el.textContent ?? ""));
}

function submitBlockingMessages(): string[] {
  const dialog = findApplyModalRoot() ?? document.body;
  const selectors = [
    '[role="alert"]',
    '[aria-live]',
    '[data-status]',
    '[class*="error" i]',
    '[class*="warning" i]',
    '[class*="invalid" i]'
  ].join(",");
  const messages = Array.from(dialog.querySelectorAll<HTMLElement>(selectors))
    .map((el) => visibleSnippet(el, 180))
    .filter((text): text is string => !!text);
  // Handshake's submit-rejection toasts (e.g. "multiple open applications")
  // render OUTSIDE the modal, so also sweep top-level alert/live regions when a
  // modal is open — otherwise the decisive error never reaches the diagnostics.
  if (dialog !== document.body) {
    for (const el of Array.from(
      document.querySelectorAll<HTMLElement>('[role="alert"],[aria-live]')
    )) {
      const text = visibleSnippet(el, 180);
      if (text) messages.push(text);
    }
  }
  return Array.from(new Set(messages)).slice(0, 8);
}

function dumpSubmitState(
  label: string,
  submitted: boolean,
  clicked: boolean,
  duplicate = false
): void {
  const applyModal = findApplyModalRoot();
  const payload = {
    label,
    submitted,
    clicked,
    duplicateApplication: duplicate,
    url: window.location.href,
    applyModalPresent: !!applyModal,
    dialogs: Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"],[aria-modal="true"]'))
      .slice(0, 4)
      .map((dialog) => visibleSnippet(dialog, 180)),
    appliedState: isAlreadyApplied(),
    submitButtons: Array.from((applyModal ?? document).querySelectorAll<HTMLButtonElement>("button"))
      .filter((b) => /submit|confirm|apply/i.test(b.textContent ?? ""))
      .slice(0, 10)
      .map((b) => ({ text: (b.textContent ?? "").trim().slice(0, 40), disabled: b.disabled })),
    blockingMessages: submitBlockingMessages(),
    dialogText: visibleSnippet(applyModal, 700)
  };
  sendDebugLog("submit-state", payload);
}

// Submit the open apply modal robustly. Handshake's document upload can take a
// moment to finalize before Submit enables, and it sometimes renders a SECOND
// confirmation step ("Submit"/"Confirm") after the first click — so we wait for an
// enabled submit, click it, then re-query and click any remaining enabled
// submit/confirm button a couple more times, stopping as soon as the modal closes.
// Returns "submitted" ONLY if the application actually went through (the modal
// closed after a submit click, or a scoped success/applied state appeared) — NOT
// merely if we clicked an enabled Submit.
// Clicking alone produced false "applied" records: Handshake can re-validate
// after the click and re-disable Submit (e.g. a document still finishing), leaving
// the modal open. Dumps the post-submit DOM for diagnosis.
// "submitted" — the application went through. "duplicate" — Handshake already
// has an open application for this job (already applied; do NOT keep clicking).
// "incomplete" — we clicked Submit but it never completed (an unmet field).
type SubmitOutcome = "submitted" | "duplicate" | "incomplete";

async function clickSubmitAndConfirm(label: string): Promise<SubmitOutcome> {
  let everClicked = false;
  // Handshake leaves success/error toasts from prior jobs mounted in the page.
  // Only a duplicate-application alert that appears after this helper starts can
  // describe the current submit attempt.
  const preexistingDuplicateAlerts = new Set(duplicateApplicationAlertElements());
  const clearedPreexistingAlerts = new Set<HTMLElement>();
  const hasNewDuplicateError = () => {
    const currentAlerts = new Set(duplicateApplicationAlertElements());
    for (const alert of preexistingDuplicateAlerts) {
      if (!currentAlerts.has(alert)) clearedPreexistingAlerts.add(alert);
    }
    return Array.from(currentAlerts).some(
      (alert) =>
        !preexistingDuplicateAlerts.has(alert) ||
        clearedPreexistingAlerts.has(alert)
    );
  };

  for (let attempt = 0; attempt < 4; attempt++) {
    // Wait for an enabled submit/confirm. The first wait is generous because a
    // freshly-uploaded document can take many seconds to finish processing before
    // Handshake enables Submit.
    await waitFor(() => {
      const b = findSubmitOrConfirm();
      return applicationLooksSubmitted(everClicked) || (!!b && !b.disabled);
    }, attempt === 0 ? 20000 : 6000);

    if (applicationLooksSubmitted(everClicked)) {
      if (!everClicked) {
        log(`[${label}] Handshake already shows an applied/open application state; not clicking Submit.`);
        dumpSubmitState(label, false, everClicked, true);
        return "duplicate";
      }
      log(`[${label}] application appears submitted before another click was needed.`);
      break;
    }

    const btn = findSubmitOrConfirm();
    if (!btn || btn.disabled) break;

    log(`[${label}] submit attempt ${attempt + 1}: clicking "${(btn.textContent ?? "").trim()}"`);
    btn.click();
    everClicked = true;
    // Handshake can accept the click, disable Submit while it finalizes, then
    // close the modal several seconds later. Wait for that settled state (or a
    // duplicate-application rejection) instead of treating the immediate disabled
    // button as a failed application.
    await waitFor(
      () => applicationLooksSubmitted(everClicked) || hasNewDuplicateError(),
      attempt === 0 ? 12000 : 8000
    );

    if (hasNewDuplicateError()) {
      log(`[${label}] "multiple open applications" rejection after clicking Submit — already applied; stopping.`);
      dumpSubmitState(label, false, everClicked, true);
      return "duplicate";
    }
    if (applicationLooksSubmitted(everClicked)) {
      log(`[${label}] application appears submitted (modal closed / applied state).`);
      break;
    }
  }

  if (everClicked && !applicationLooksSubmitted(everClicked)) {
    await waitFor(() => applicationLooksSubmitted(everClicked) || hasNewDuplicateError(), 8000);
    if (hasNewDuplicateError()) {
      log(`[${label}] "multiple open applications" rejection observed while settling — already applied.`);
      dumpSubmitState(label, false, everClicked, true);
      return "duplicate";
    }
  }

  const submitted = applicationLooksSubmitted(everClicked);
  if (everClicked && !submitted) {
    warn(`[${label}] clicked Submit but the application did not complete (modal still open / Submit re-disabled).`);
  }
  dumpSubmitState(label, submitted, everClicked, false);
  if (submitted) {
    dismissOpenDialog();
  }
  return submitted ? "submitted" : "incomplete";
}

interface AttachResult {
  attached: boolean;
  submitted: boolean;
  message: string;
}

async function attachCoverLetterAndSubmit(pdfBase64: string, filename: string): Promise<AttachResult> {
  group(`attachCoverLetterAndSubmit: ${filename}`);
  const attached = await attachCoverLetterFile(pdfBase64, filename);
  if (!attached) {
    groupEnd();
    return {
      attached: false,
      submitted: false,
      message:
        "The cover-letter PDF was generated, but Handshake did not mark the cover-letter field complete. Check the cover-letter-upload-state logs for the exact field/picker state."
    };
  }

  const outcome = await clickSubmitAndConfirm("cover-letter-popup");
  groupEnd();
  if (outcome === "submitted") {
    return { attached: true, submitted: true, message: "Cover letter attached and application submitted." };
  }
  if (outcome === "duplicate") {
    return {
      attached: true,
      submitted: false,
      message: "Handshake says this job already has an open application, so the bot did not submit again."
    };
  }
  return {
    attached: true,
    submitted: false,
    message:
      "Cover letter attached, but Submit did not complete. Check submit-state and cover-letter-upload-state logs for the remaining blocker."
  };
}

// ─── Transcript upload ────────────────────────────────────────────────────────
// Some apply modals ask for a transcript ("Attach your transcript" with a
// "Search your transcripts" / "Upload new" control). Unlike the resume (which
// Handshake pre-fills from the user's profile), the transcript field starts
// empty, so when we see a transcript section we upload the user's stored
// TRANSCRIPT document. The bytes are fetched from the backend by the background
// worker (content scripts can't hit the backend — CORS allows only the extension
// origin) and rebuilt into a File here.

// The container that holds the transcript heading plus its upload control.
// Anchored on a short "transcript" label and climbed up until it also contains an
// upload/search control, so we can scope the file-input search to it.
function transcriptSection(): HTMLElement | null {
  const root = findApplyModalRoot() ?? document;
  const heading = findShortTextEl(/transcript/i, 60, root);
  if (!heading) return null;
  let node: HTMLElement | null = heading;
  for (let i = 0; i < 6 && node; i++, node = node.parentElement) {
    const hasControl =
      node.querySelector('input[type="file"]') ||
      Array.from(node.querySelectorAll("button")).some((b) => /upload/i.test(b.textContent ?? "")) ||
      Array.from(node.querySelectorAll("input")).some((i) =>
        /transcript/i.test(i.getAttribute("placeholder") ?? "")
      );
    if (hasControl) return node;
  }
  return heading.parentElement;
}

// True when the apply modal is asking for a transcript upload (a transcript label
// sitting next to an upload/search control), as opposed to merely mentioning the
// word somewhere.
function hasTranscriptUpload(): boolean {
  const section = transcriptSection();
  if (!section) return false;
  return (
    !!section.querySelector('input[type="file"]') ||
    Array.from(section.querySelectorAll("button")).some((b) => /upload/i.test(b.textContent ?? "")) ||
    Array.from(section.querySelectorAll("input")).some((i) =>
      /transcript/i.test(i.getAttribute("placeholder") ?? "")
    )
  );
}

// Ask the background worker for a stored document's bytes (it proxies the backend
// because content scripts are blocked by CORS). Returns null if none is stored.
async function fetchStoredDocument(docType: DocumentType): Promise<StoredDocument | null> {
  try {
    const resp = (await chrome.runtime.sendMessage({ type: "runtime/get-document", docType })) as
      | { ok?: boolean; document?: StoredDocument | null }
      | undefined;
    if (resp?.ok && resp.document) return resp.document;
    return null;
  } catch (err) {
    warn("failed to fetch stored document from background", err);
    return null;
  }
}

type TranscriptOutcome = "attached" | "not-requested" | "no-transcript-on-file" | "failed";

// If the apply modal asks for a transcript, drop the user's stored transcript
// into its upload field. Returns "not-requested" when there's no transcript
// section, so callers can ignore it for the common case.
async function attachStoredTranscript(): Promise<TranscriptOutcome> {
  if (!hasTranscriptUpload()) return "not-requested";
  log("apply modal asks for a transcript — attaching the stored TRANSCRIPT document.");

  const doc = await fetchStoredDocument("TRANSCRIPT");
  if (!doc) {
    warn(
      "No TRANSCRIPT document is stored. Upload one on the extension's options page " +
        "(Documents) so the bot can attach it."
    );
    return "no-transcript-on-file";
  }

  const section = transcriptSection();
  let input = (section ?? document).querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) {
    // Handshake hides the file input behind an "Upload new" button; click it to
    // reveal the input, then look again (it may render outside the section).
    const uploadBtn = Array.from(
      (section ?? document).querySelectorAll<HTMLButtonElement>("button")
    ).find((b) => /upload/i.test(b.textContent ?? ""));
    if (uploadBtn) {
      log("clicking the transcript section's 'Upload new' to reveal its file input.");
      uploadBtn.click();
      await sleep(600);
    }
    input =
      (section ?? document).querySelector<HTMLInputElement>('input[type="file"]') ??
      findSectionFileInput(/transcript/i);
  }
  if (!input) {
    warn("Could not find the transcript file input in the apply modal.");
    dumpUploadWidgets("transcript-no-input");
    return "failed";
  }

  try {
    const file = new File([base64ToUint8Array(doc.base64) as BlobPart], doc.filename || "transcript.pdf", {
      type: doc.contentType || "application/pdf"
    });
    setFileOnInput(input, file);
    log(`attached stored transcript "${doc.filename}" (${file.size} bytes) to the apply modal.`);
  } catch (err) {
    warn("failed to attach the transcript file", err);
    return "failed";
  }

  // Give Handshake time to process the upload and re-validate the form, then
  // confirm it actually took (the section should reach the green "positive"
  // state). If it never does, treat it as a failure rather than pressing on to a
  // Submit that will stay disabled.
  const accepted = await waitForSectionAccepted(transcriptSection, doc.filename || "transcript.pdf");
  dumpUploadWidgets(accepted ? "transcript-accepted" : "transcript-not-accepted");
  if (!accepted) {
    warn("Transcript attached but Handshake never confirmed it (no accepted state) — treating as failed.");
    return "failed";
  }
  return "attached";
}

// True when a modal upload section shows Handshake's fully-ACCEPTED state for a
// document. Handshake renders a status alert per upload: while the file is still
// uploading/scanning it shows a blue "info" alert (data-status="info") that ALSO
// displays the filename, and only once the document is committed does it flip to
// a green "positive" alert (data-status="positive") — which is what actually
// enables Submit. A remove/replace control likewise only renders once committed.
// Confirmed from live DOM dumps: a freshly-attached cover letter sat at
// data-status="info" with Submit disabled, while an accepted transcript showed
// data-status="positive". So matching the filename text alone is NOT acceptance.
function sectionShowsAccepted(section: HTMLElement, filenameLower?: string): boolean {
  const sectionText = (section.textContent ?? "").toLowerCase();
  const filenameStem = filenameLower?.replace(/\.pdf$/i, "");
  const sectionMatchesFile =
    !filenameLower ||
    sectionText.includes(filenameLower) ||
    (!!filenameStem && sectionText.includes(filenameStem));
  const positive =
    sectionMatchesFile &&
    !!section.querySelector(
      '[data-status="positive"],[data-status="success"],[role="status"][aria-label*="positive" i]'
    );
  if (positive) return true;

  const removeControls = Array.from(
    section.querySelectorAll<HTMLElement>(
      '[aria-label*="remove" i],[aria-label*="delete" i],[aria-label*="replace" i]'
    )
  );
  return sectionMatchesFile && removeControls.length > 0;
}

// Wait for Handshake to fully accept an uploaded file before we rely on Submit
// enabling. We re-resolve the section each tick because Handshake REPLACES the
// section's DOM as the upload transitions (info → positive), so a node captured
// at attach time goes stale. Acceptance requires the "positive" state (see
// sectionShowsAccepted); only when a section renders no status element at all
// (unknown/older markup) do we fall back to the filename-present heuristic so we
// don't hang forever. The timeout is generous because document processing can
// take many seconds.
async function waitForSectionAccepted(
  getSection: () => HTMLElement | null,
  filename: string,
  timeoutMs = 30000
): Promise<boolean> {
  const lower = filename.toLowerCase();
  return waitFor(() => {
    const sec = getSection() ?? document.body;
    if (sectionShowsAccepted(sec, lower)) return true;
    const hasStatusEl = !!sec.querySelector('[data-status],[role="status"]');
    if (!hasStatusEl) return (sec.textContent ?? "").toLowerCase().includes(lower);
    return false;
  }, timeoutMs);
}

// ─── Cover-letter auto-compose & review ───────────────────────────────────────
// When the apply modal asks for a cover letter ("Attach your cover letter" /
// "Search your cover letters" / "Upload new"), we auto-generate one with the
// agent (from the open job + stored resume), show the user an in-page overlay to
// review/edit it, and — only on their approval — render it to a PDF, attach it,
// and submit. The background worker runs the agent + PDF render (content scripts
// can't reach the backend due to CORS).

// The container holding the cover-letter heading and its upload/search control.
function coverLetterSection(): HTMLElement | null {
  const root = findApplyModalRoot() ?? document;
  const heading = findShortTextEl(/cover letter/i, 60, root);
  if (heading) {
    let node: HTMLElement | null = heading;
    for (let i = 0; i < 6 && node; i++, node = node.parentElement) {
      const hasControl =
        node.querySelector('input[type="file"]') ||
        Array.from(node.querySelectorAll("button")).some((b) => /upload/i.test(b.textContent ?? "")) ||
        Array.from(node.querySelectorAll("input")).some((i) =>
          /cover letter/i.test(i.getAttribute("placeholder") ?? "")
        );
      if (hasControl) return node;
    }
    return heading.parentElement;
  }

  // Handshake sometimes omits a visible heading but keeps a uniquely named
  // hidden file input for this document type. Normalize its semantic attributes
  // rather than relying on one exact selector ("file-Cover Letter", underscores,
  // generated ids, and casing have all appeared).
  const namedInput = Array.from(
    root.querySelectorAll<HTMLInputElement>('input[type="file"]')
  ).find(inputLooksLikeCoverLetter);
  const structuralSection = namedInput?.closest<HTMLElement>(
    'fieldset,section,[role="group"]'
  );
  return (
    structuralSection ??
    namedInput?.closest<HTMLElement>('[data-hook="apply-modal-document-search"]') ??
    namedInput?.parentElement ??
    null
  );
}

function hasCoverLetterUpload(): boolean {
  const section = coverLetterSection();
  if (!section) return false;
  return (
    !!section.querySelector('input[type="file"]') ||
    Array.from(section.querySelectorAll("button")).some((b) => /upload/i.test(b.textContent ?? "")) ||
    Array.from(section.querySelectorAll("input")).some((i) =>
      /cover letter/i.test(i.getAttribute("placeholder") ?? "")
    )
  );
}

// Cover-letter generation/review can take long enough for Handshake to remount
// or close its apply form. Before attaching the finished PDF, make sure the same
// job's live form is still present. If it disappeared, reopen it and restore the
// transcript/screening prerequisites that normally run before cover-letter
// handling.
async function ensureCoverLetterFormReady(expectedJobId?: string): Promise<boolean> {
  if (coverLetterSection() && findSubmitOrConfirm()) return true;

  const currentJobId = extractJobId(window.location.href);
  if (expectedJobId && currentJobId && currentJobId !== expectedJobId) {
    warn(
      `Cover-letter form disappeared after the selected job changed ` +
        `(${expectedJobId} → ${currentJobId}); refusing to attach to the wrong job.`
    );
    return false;
  }

  const applyBtn = findApplyButton();
  if (!applyBtn || applyBtn.disabled) {
    warn("Cover-letter form disappeared and the current job has no enabled Apply button to reopen it.");
    return false;
  }

  log("Cover-letter form was remounted/closed while generating; reopening the current job application.");
  applyBtn.click();
  await waitForApplyModal(8000);

  const transcriptOutcome = await attachStoredTranscript();
  if (transcriptOutcome === "no-transcript-on-file" || transcriptOutcome === "failed") {
    warn(`Could not restore the reopened cover-letter form (${transcriptOutcome}).`);
    return false;
  }

  if (hasScreeningQuestions()) {
    const screening = answerScreeningQuestions();
    if (!screening.ok) {
      warn(`Could not restore screening answers in the reopened cover-letter form (${screening.reason}).`);
      return false;
    }
    await sleep(400);
  }

  const ready = !!coverLetterSection() && !!findSubmitOrConfirm();
  if (!ready) {
    dumpCoverLetterUploadState("reopen-form-not-ready");
  }
  return ready;
}

function fileInputAfterHeading(section: HTMLElement, headingRe: RegExp): HTMLInputElement | null {
  const heading = findShortTextEl(headingRe, 80, section);
  const inputs = Array.from(section.querySelectorAll<HTMLInputElement>('input[type="file"]'));
  if (inputs.length === 0) return null;
  if (!heading) return inputs.find((i) => !i.files || i.files.length === 0) ?? inputs[inputs.length - 1];
  const afterHeading = inputs.filter((input) =>
    !!(heading.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING)
  );
  return afterHeading.find((i) => !i.files || i.files.length === 0) ?? afterHeading[0] ?? null;
}

function dumpCoverLetterUploadState(note: string, filename?: string, input?: HTMLInputElement | null): void {
  const section = coverLetterSection();
  const submit = findSubmitOrConfirm();
  sendDebugLog("cover-letter-upload-state", {
    note,
    filename: filename ?? null,
    url: window.location.href,
    sectionFound: !!section,
    sectionText: visibleSnippet(section, 500),
    sectionHtml: section?.outerHTML.replace(/\s+/g, " ").slice(0, 2200) ?? null,
    chosenInput: input
      ? {
          name: input.name || null,
          id: input.id || null,
          accept: input.getAttribute("accept"),
          hidden: !isElementVisible(input),
          disabled: input.disabled,
          files: input.files?.length ?? 0,
          ancestry: ancestryHooks(input)
        }
      : null,
    allFileInputs: Array.from((findApplyModalRoot() ?? document).querySelectorAll<HTMLInputElement>('input[type="file"]')).map(
      (candidate, idx) => ({
        idx,
        name: candidate.name || null,
        id: candidate.id || null,
        accept: candidate.getAttribute("accept"),
        hidden: !isElementVisible(candidate),
        disabled: candidate.disabled,
        files: candidate.files?.length ?? 0,
        ancestry: ancestryHooks(candidate)
      })
    ),
    submit: submit ? { text: (submit.textContent ?? "").trim(), disabled: submit.disabled } : null,
    blockingMessages: submitBlockingMessages()
  });
}

function submitIsEnabled(): boolean {
  const submit = findSubmitOrConfirm();
  return !!submit && !submit.disabled;
}

function clickableUploadChoiceTarget(candidate: HTMLElement): HTMLElement {
  const actionableSelector =
    'button,[role="button"],[role="option"],[role="menuitem"],label,a,[tabindex]:not([tabindex="-1"])';
  const actionableSelf = candidate.closest<HTMLElement>(actionableSelector);
  if (actionableSelf && isElementVisible(actionableSelf)) return actionableSelf;

  const row =
    candidate.closest<HTMLElement>('li,[role="option"],[role="menuitem"],[data-testid],[class*="option" i],[class*="item" i],[class*="row" i]') ??
    candidate.parentElement;
  const rowAction = row
    ? Array.from(row.querySelectorAll<HTMLElement>(actionableSelector)).find(isElementVisible)
    : null;
  return rowAction ?? row ?? candidate;
}

async function selectUploadedCoverLetterIfNeeded(filename: string): Promise<void> {
  if (submitIsEnabled()) return;

  const section = coverLetterSection();
  if (!section) {
    dumpCoverLetterUploadState("select-uploaded-no-section", filename);
    return;
  }

  const lower = filename.toLowerCase();
  const stem = lower.replace(/\.pdf$/i, "");
  const candidates = Array.from(
    section.querySelectorAll<HTMLElement>('button,[role="option"],[role="menuitem"],li,label,div,span')
  )
    .filter(isElementVisible)
    .filter((el) => {
      const text = (el.textContent ?? "").replace(/\s+/g, " ").trim().toLowerCase();
      if (!text || (!text.includes(lower) && !text.includes(stem))) return false;
      if (/remove|delete|replace|upload|search/.test(text)) return false;
      if (el.closest('[aria-label*="remove" i],[aria-label*="delete" i]')) return false;
      return true;
    });

  sendDebugLog("cover-letter-select-uploaded", {
    filename,
    candidateCount: candidates.length,
    candidates: candidates.slice(0, 6).map((el) => ({
      tag: el.tagName,
      role: el.getAttribute("role"),
      text: (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 160),
      ariaLabel: el.getAttribute("aria-label")
    }))
  });

  for (const candidate of candidates.slice(0, 4)) {
    const target = clickableUploadChoiceTarget(candidate);
    sendDebugLog("cover-letter-select-click", {
      filename,
      candidateText: (candidate.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 180),
      targetTag: target.tagName,
      targetRole: target.getAttribute("role"),
      targetText: (target.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 180),
      targetAriaLabel: target.getAttribute("aria-label")
    });
    target.click();
    await sleep(700);
    if (submitIsEnabled()) {
      dumpCoverLetterUploadState("select-uploaded-enabled-submit", filename);
      return;
    }
  }

  const search = Array.from(section.querySelectorAll<HTMLInputElement>("input")).find((input) =>
    /cover letter/i.test(input.getAttribute("placeholder") ?? "")
  );
  if (search) {
    search.focus();
    search.value = filename;
    search.dispatchEvent(new Event("input", { bubbles: true }));
    search.dispatchEvent(new Event("change", { bubbles: true }));
    await sleep(900);
    const options = Array.from(
      (findApplyModalRoot() ?? document).querySelectorAll<HTMLElement>('[role="option"],[role="menuitem"],li,button')
    ).filter((el) => {
      const text = (el.textContent ?? "").replace(/\s+/g, " ").trim().toLowerCase();
      return isElementVisible(el) && (text.includes(lower) || text.includes(stem));
    });
    sendDebugLog("cover-letter-search-options", {
      filename,
      optionCount: options.length,
      options: options.slice(0, 6).map((el) => ({
        tag: el.tagName,
        role: el.getAttribute("role"),
        text: (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 160)
      }))
    });
    if (options[0]) {
      const target = clickableUploadChoiceTarget(options[0]);
      sendDebugLog("cover-letter-select-click", {
        filename,
        candidateText: (options[0].textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 180),
        targetTag: target.tagName,
        targetRole: target.getAttribute("role"),
        targetText: (target.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 180),
        targetAriaLabel: target.getAttribute("aria-label")
      });
      target.click();
      await sleep(900);
    }
  }

  if (!submitIsEnabled()) {
    await waitFor(() => submitIsEnabled(), 3000);
  }

  dumpCoverLetterUploadState(
    submitIsEnabled() ? "select-uploaded-final-submit-enabled" : "select-uploaded-final-submit-disabled",
    filename
  );
}

// Ask the background worker to run the agent for the open job. Returns the
// generated text or an error string.
async function composeCoverLetterText(job: JobContext): Promise<{ coverLetter: string } | { error: string }> {
  try {
    const resp = (await chrome.runtime.sendMessage({
      type: "runtime/generate-cover-letter-text",
      job
    })) as { ok?: boolean; coverLetter?: { coverLetter: string }; error?: string } | undefined;
    if (resp?.ok && resp.coverLetter) return { coverLetter: resp.coverLetter.coverLetter };
    return { error: resp?.error ?? "Cover-letter generation failed." };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Cover-letter generation failed." };
  }
}

// Ask the background worker to render the (reviewed) text to a PDF.
async function renderCoverLetterPdf(
  coverLetter: string,
  company: string,
  jobTitle: string
): Promise<{ base64: string; filename: string } | null> {
  try {
    const resp = (await chrome.runtime.sendMessage({
      type: "runtime/render-cover-letter-pdf",
      coverLetter,
      company,
      jobTitle
    })) as { ok?: boolean; pdf?: { base64: string; filename: string } } | undefined;
    return resp?.ok && resp.pdf ? resp.pdf : null;
  } catch (err) {
    warn("failed to render cover-letter PDF", err);
    return null;
  }
}

// Drop a rendered cover-letter PDF into the apply modal's cover-letter upload
// field (no submit). Scopes to the cover-letter section so we don't grab the
// resume/transcript inputs; clicks "Upload new" first if the input is hidden.
// Returns true only when Handshake fully ACCEPTS the upload (reaches the green
// "positive" state) — not merely when we set the file — because Submit stays
// disabled until then.
async function attachCoverLetterFile(
  pdfBase64: string,
  filename: string,
  expectedJobId?: string
): Promise<boolean> {
  if (!(await ensureCoverLetterFormReady(expectedJobId))) {
    dumpCoverLetterUploadState("form-not-ready-before-attach", filename);
    return false;
  }
  const section = coverLetterSection();
  dumpCoverLetterUploadState("before-attach", filename);
  if (!section) {
    warn("Could not find the cover-letter section in the apply modal.");
    dumpUploadWidgets("coverletter-no-section");
    return false;
  }

  let input =
    fileInputAfterHeading(section, /cover letter/i) ??
    findCoverLetterFileInput();
  if (!input) {
    const uploadBtn = Array.from(
      section.querySelectorAll<HTMLButtonElement>("button")
    ).find((b) => /upload/i.test(b.textContent ?? ""));
    if (uploadBtn) {
      log("clicking the cover-letter section's 'Upload new' to reveal its file input.");
      dumpCoverLetterUploadState("before-upload-button-click", filename);
      uploadBtn.click();
      await sleep(600);
    }
    input =
      (coverLetterSection() ? fileInputAfterHeading(coverLetterSection() as HTMLElement, /cover letter/i) : null) ??
      findCoverLetterFileInput();
  }
  if (!input) {
    warn("Could not find the cover-letter file input in the apply modal.");
    dumpUploadWidgets("coverletter-no-input");
    dumpCoverLetterUploadState("no-input", filename);
    return false;
  }
  try {
    const file = new File([base64ToUint8Array(pdfBase64) as BlobPart], filename, {
      type: "application/pdf"
    });
    setFileOnInput(input, file);
    log(`attached cover letter "${filename}" (${file.size} bytes) to the apply modal.`);
    dumpCoverLetterUploadState("after-set-file", filename, input);
  } catch (err) {
    warn("failed to attach the cover-letter file", err);
    dumpCoverLetterUploadState("set-file-error", filename, input);
    return false;
  }
  await sleep(800); // brief settle before polling for the accepted state
  const accepted = await waitForSectionAccepted(coverLetterSection, filename);
  dumpCoverLetterUploadState(accepted ? "accepted" : "not-accepted", filename, input);
  dumpUploadWidgets(accepted ? "coverletter-accepted" : "coverletter-not-accepted");
  if (accepted) {
    await selectUploadedCoverLetterIfNeeded(filename);
  }
  return accepted;
}

// A lightweight, dismiss-proof "working…" overlay shown while the agent runs.
// Returns a function that removes it.
function showLoadingOverlay(message: string): () => void {
  const backdrop = document.createElement("div");
  Object.assign(backdrop.style, {
    position: "fixed",
    inset: "0",
    background: "rgba(15, 23, 42, 0.45)",
    zIndex: "2147483647",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
  });
  const card = document.createElement("div");
  Object.assign(card.style, {
    background: "#fff",
    color: "#0f172a",
    padding: "18px 22px",
    borderRadius: "12px",
    boxShadow: "0 24px 64px rgba(0,0,0,0.32)",
    fontSize: "15px",
    fontWeight: "600"
  });
  card.textContent = message;
  backdrop.appendChild(card);
  (document.body ?? document.documentElement).appendChild(backdrop);
  return () => backdrop.remove();
}

type CoverLetterAction = "submit" | "regenerate" | "skip" | "stop";

// Overlay: show the drafted cover letter (editable) and ask the user whether to
// submit. Resolves with their choice plus the (possibly edited) final text.
function promptCoverLetterReview(
  title: string,
  company: string,
  initialText: string
): Promise<{ action: CoverLetterAction; coverLetter: string }> {
  return new Promise((resolve) => {
    const Z = "2147483647";
    const backdrop = document.createElement("div");
    Object.assign(backdrop.style, {
      position: "fixed",
      inset: "0",
      background: "rgba(15, 23, 42, 0.55)",
      zIndex: Z,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    });

    const card = document.createElement("div");
    Object.assign(card.style, {
      background: "#fff",
      color: "#0f172a",
      width: "min(620px, 94vw)",
      borderRadius: "14px",
      boxShadow: "0 24px 64px rgba(0,0,0,0.32)",
      padding: "22px 22px 18px",
      boxSizing: "border-box",
      display: "flex",
      flexDirection: "column"
    });

    const h = document.createElement("div");
    h.textContent = "Review cover letter";
    Object.assign(h.style, { fontSize: "18px", fontWeight: "700", marginBottom: "6px" });

    const sub = document.createElement("div");
    sub.textContent = `${title || "This job"}${company ? " · " + company : ""}`;
    Object.assign(sub.style, { fontSize: "13px", color: "#475569", marginBottom: "12px" });

    const note = document.createElement("div");
    note.textContent = "The agent drafted this from your résumé and the job. Edit if you like, then submit.";
    Object.assign(note.style, { fontSize: "12px", color: "#64748b", marginBottom: "10px" });

    const textarea = document.createElement("textarea");
    textarea.value = initialText;
    Object.assign(textarea.style, {
      width: "100%",
      height: "260px",
      boxSizing: "border-box",
      resize: "vertical",
      borderRadius: "10px",
      border: "1px solid #cbd5e1",
      padding: "12px 14px",
      fontSize: "13px",
      lineHeight: "1.5",
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      color: "#0f172a",
      marginBottom: "14px"
    });

    const btnWrap = document.createElement("div");
    Object.assign(btnWrap.style, { display: "flex", flexWrap: "wrap", gap: "8px", justifyContent: "flex-end" });

    const buttons: Array<{ label: string; action: CoverLetterAction; kind: "primary" | "neutral" | "danger" }> = [
      { label: "Stop run", action: "stop", kind: "danger" },
      { label: "Skip this job", action: "skip", kind: "neutral" },
      { label: "Regenerate", action: "regenerate", kind: "neutral" },
      { label: "Approve & submit", action: "submit", kind: "primary" }
    ];

    function close(action: CoverLetterAction) {
      const text = textarea.value;
      backdrop.remove();
      document.removeEventListener("keydown", onKey, true);
      resolve({ action, coverLetter: text });
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close("skip");
      }
    }

    for (const b of buttons) {
      const btn = document.createElement("button");
      btn.textContent = b.label;
      btn.type = "button";
      const palette =
        b.kind === "primary"
          ? { bg: "#2348e3", fg: "#fff", border: "#2348e3" }
          : b.kind === "danger"
            ? { bg: "#fff", fg: "#b91c1c", border: "#fecaca" }
            : { bg: "#fff", fg: "#0f172a", border: "#cbd5e1" };
      Object.assign(btn.style, {
        appearance: "none",
        border: `1px solid ${palette.border}`,
        background: palette.bg,
        color: palette.fg,
        borderRadius: "9px",
        padding: "11px 16px",
        fontSize: "14px",
        fontWeight: "600",
        cursor: "pointer"
      });
      btn.addEventListener("click", () => close(b.action));
      btnWrap.appendChild(btn);
    }

    card.append(h, sub, note, textarea, btnWrap);
    backdrop.appendChild(card);
    document.addEventListener("keydown", onKey, true);
    (document.body ?? document.documentElement).appendChild(backdrop);
    textarea.focus();
  });
}

// Entry point from processCurrentJobPage when the modal asks for a cover letter.
// Generates → user-reviews → (on approval) renders + attaches + submits. Returns
// the JobResult to record (this branch owns the submit, so it always returns a
// terminal result rather than falling through to the generic submit).
async function handleCoverLetterRequest(
  base: { handshakeJobId: string; jobUrl: string; title: string; company: string },
  job: JobContext
): Promise<JobResult> {
  // Generate (with a working-overlay), regenerating if the user asks.
  let removeLoading = showLoadingOverlay("Writing your cover letter…");
  let gen = await composeCoverLetterText(job);
  removeLoading();
  if ("error" in gen) {
    warn(`cover-letter generation failed: ${gen.error}`);
    dismissOpenDialog();
    return { ...base, status: "SKIPPED", skipReason: "COVER_LETTER_FAILED" };
  }

  // Review loop — the user can edit, regenerate, skip, stop, or approve.
  let text = gen.coverLetter;
  for (;;) {
    const decision = await promptCoverLetterReview(base.title, base.company, text);
    text = decision.coverLetter;

    if (decision.action === "regenerate") {
      removeLoading = showLoadingOverlay("Rewriting your cover letter…");
      gen = await composeCoverLetterText(job);
      removeLoading();
      if ("error" in gen) {
        warn(`cover-letter regeneration failed: ${gen.error}`);
        // Keep the current text and let the user decide again.
        continue;
      }
      text = gen.coverLetter;
      continue;
    }

    if (decision.action === "skip") {
      dismissOpenDialog();
      return { ...base, status: "SKIPPED", skipReason: "COVER_LETTER_DECLINED" };
    }
    if (decision.action === "stop") {
      inPlaceStop = true;
      dismissOpenDialog();
      return { ...base, status: "SKIPPED", skipReason: "USER_STOPPED" };
    }
    break; // submit
  }

  // Approved — render the (possibly edited) letter, attach it, and submit.
  const pdf = await renderCoverLetterPdf(text, base.company, base.title);
  if (!pdf) {
    warn("Cover-letter PDF render failed.");
    dismissOpenDialog();
    return { ...base, status: "SKIPPED", skipReason: "COVER_LETTER_FAILED" };
  }
  const accepted = await attachCoverLetterFile(
    pdf.base64,
    pdf.filename,
    base.handshakeJobId
  );
  if (!accepted) {
    warn("Cover letter uploaded but Handshake never accepted it (stuck in the processing state).");
    dumpUploadWidgets("coverletter-never-accepted");
    dismissOpenDialog();
    return { ...base, status: "SKIPPED", skipReason: "COVER_LETTER_FAILED" };
  }

  const outcome = await clickSubmitAndConfirm("cover-letter");
  if (outcome === "duplicate") {
    warn("Handshake already has an open application for this job — recording as already applied, not resubmitting.");
    dismissOpenDialog();
    return { ...base, status: "SKIPPED", skipReason: "ALREADY_APPLIED" };
  }
  if (outcome === "incomplete") {
    warn("Cover letter accepted but Submit never completed — other required fields remain.");
    dumpUploadWidgets("submit-stayed-disabled");
    return { ...base, status: "SKIPPED", skipReason: "SUBMIT_INCOMPLETE" };
  }
  return { ...base, status: "APPLIED" };
}

// ─── "Other required documents" gate ──────────────────────────────────────────
// Some jobs require a document beyond the resume that we can't generate (a video
// pitch, writing sample, etc.). When the apply modal shows "Attach other required
// documents", we pause the run and ask the user — via an overlay injected onto the
// Handshake page — what to do. A "remember for this run" checkbox lets the choice
// repeat without re-prompting.

type OtherDocsAction = "agent" | "save" | "blank" | "skip" | "stop";

// Remembered choice for the current run (set when the user ticks "remember").
// Also persisted in RunSession so it survives page reloads and route changes.
let otherDocsRemembered: OtherDocsAction | null = null;

async function rememberOtherDocsAction(action: OtherDocsAction): Promise<void> {
  otherDocsRemembered = action;
  try {
    const session = await getSession();
    if (!session || session.shouldStop) return;
    await saveSession({ ...session, otherDocsRemembered: action });
  } catch (err) {
    // Keep the in-memory behavior working even if session persistence fails.
    warn(`Could not persist remembered other-documents choice "${action}".`, err);
  }
}

// A verified minimal valid 1-page blank PDF (see commit notes). Used for the
// "submit with a blank PDF" option so we don't need a backend round-trip
// mid-run.
const BLANK_PDF_BASE64 =
  "JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCA2MTIgNzkyXSAvUmVzb3VyY2VzIDw8ID4+ID4+CmVuZG9iagp4cmVmCjAgNAowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMDkgMDAwMDAgbiAKMDAwMDAwMDA1OCAwMDAwMCBuIAowMDAwMDAwMTE1IDAwMDAwIG4gCnRyYWlsZXIKPDwgL1NpemUgNCAvUm9vdCAxIDAgUiA+PgpzdGFydHhyZWYKMjAzCiUlRU9G";

// Generic: the file input that belongs to a labelled section of the apply modal.
// Anchors on the section heading, then prefers an empty input (the resume's is
// already filled), then the last input.
function findSectionFileInput(labelRe: RegExp): HTMLInputElement | null {
  const root = findApplyModalRoot() ?? document;
  const inputs = Array.from(root.querySelectorAll<HTMLInputElement>('input[type="file"]'));
  if (inputs.length === 0) return null;

  const heading = findShortTextEl(labelRe, 80, root);
  if (heading) {
    let container: HTMLElement | null = heading;
    for (let hops = 0; hops < 6 && container; hops++) {
      const candidates = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="file"]'));
      const afterHeading = candidates.filter((candidate) =>
        !!(heading.compareDocumentPosition(candidate) & Node.DOCUMENT_POSITION_FOLLOWING)
      );
      const candidate =
        afterHeading.find((i) => !i.files || i.files.length === 0) ??
        afterHeading[0] ??
        null;
      if (candidate) return candidate;
      container = container.parentElement;
    }
  }
  const empty = inputs.find((i) => !i.files || i.files.length === 0);
  return empty ?? inputs[inputs.length - 1];
}

function findOtherDocsFileInput(): HTMLInputElement | null {
  return findSectionFileInput(/other required documents|other documents/i);
}

// The left-list card for a SPECIFIC job id. Each card is
// <div data-hook="job-result-card | <id>"> and carries that job's own bookmark
// (favorite-action), so this is how we save the EXACT job — not whatever is in
// the detail panel or the top of the list.
function findJobCardById(jobId: string): HTMLElement | null {
  return (
    Array.from(document.querySelectorAll<HTMLElement>('[data-hook^="job-result-card"]')).find(
      (el) => (el.getAttribute("data-hook") ?? "").match(/^job-result-card\s*\|\s*(\d+)/)?.[1] === jobId
    ) ?? null
  );
}

// The bookmark/save control inside a card or panel. Handshake renders
// <... data-hook="favorite-action | unsaved"> (flips to "| saved" once saved).
function favoriteActionIn(root: ParentNode): HTMLElement | null {
  return root.querySelector<HTMLElement>('[data-hook^="favorite-action"]');
}

// Whether a favorite-action currently shows the SAVED state. The state lives in
// the data-hook suffix ("favorite-action | saved" vs "... | unsaved"); we also
// check aria-pressed / aria-label as a backstop. We must read this BEFORE
// clicking, because the control is a TOGGLE — clicking an already-saved job
// would UN-save it (the likely cause of "toast said saved but it's not there":
// re-running over a previously-saved job toggled it back off).
function favoriteIsSaved(el: HTMLElement): boolean {
  const hook = (el.getAttribute("data-hook") ?? "").toLowerCase();
  if (/unsaved/.test(hook)) return false;
  if (/\bsaved\b/.test(hook)) return true;
  if (el.getAttribute("aria-pressed") === "true") return true;
  const aria = (el.getAttribute("aria-label") ?? "").toLowerCase();
  return /remove from saved|unsave|saved\b/.test(aria);
}

// Ship what the save attempt did to the background worker's console so the flow
// can be inspected without persisting job-level details in the backend.
function dumpSaveJob(jobId: string, el: HTMLElement | null, note: string): void {
  void chrome.runtime
    .sendMessage({
      type: "content/debug-log",
      label: "save-job",
      payload: {
        note,
        jobId,
        url: window.location.href,
        clicked: el
          ? {
              tag: el.tagName,
              hook: el.getAttribute("data-hook"),
              aria: el.getAttribute("aria-label"),
              pressed: el.getAttribute("aria-pressed"),
              text: (el.textContent ?? "").trim().slice(0, 40)
            }
          : null,
        favoriteHooks: Array.from(document.querySelectorAll<HTMLElement>('[data-hook^="favorite-action"]'))
          .map((e) => e.getAttribute("data-hook"))
          .slice(0, 30)
      }
    })
    .catch(() => {});
}

// Save (bookmark) a specific job for the user to finish later. Prefers that
// job's own left-card favorite-action (reliable + state-aware), falling back to
// the detail panel's save control. Returns whether the job ended up saved.
async function saveJobForLater(jobId: string): Promise<boolean> {
  const card = findJobCardById(jobId);
  const fav = card ? favoriteActionIn(card) : null;

  if (fav) {
    if (favoriteIsSaved(fav)) {
      log(`job ${jobId} is already saved — leaving it (clicking again would un-save it).`);
      dumpSaveJob(jobId, fav, "already-saved");
      return true;
    }
    // The actual clickable may be a button/svg inside the favorite-action wrapper.
    const clickTarget = fav.querySelector<HTMLElement>('button,[role="button"]') ?? fav;
    log(`saving job ${jobId} via its card's favorite-action.`);
    clickTarget.click();
    const ok = await waitFor(() => {
      const f = favoriteActionIn(findJobCardById(jobId) ?? document);
      return !!f && favoriteIsSaved(f);
    }, 4000);
    dumpSaveJob(jobId, favoriteActionIn(findJobCardById(jobId) ?? document) ?? fav, ok ? "saved" : "click-did-not-flip");
    if (!ok) warn(`clicked save for job ${jobId} but its state never flipped to saved.`);
    return ok;
  }

  // Fallback: detail-panel save control (a standalone /jobs/<id> page has no
  // left list). Kept narrow — NOT a broad aria-label*="save" which would match
  // "saved search" / "save to..." controls.
  const panel = document.querySelector<HTMLElement>(
    '[data-hook="right-content"],[data-hook="details-page"]'
  );
  const scope: ParentNode = panel ?? document;
  const panelBtn =
    favoriteActionIn(scope) ??
    scope.querySelector<HTMLElement>(
      '[data-hook="bookmark-button"],[data-hook="save-job-button"],[aria-label*="save job" i],[aria-label*="bookmark" i]'
    ) ??
    Array.from(scope.querySelectorAll<HTMLButtonElement>("button")).find((b) => {
      const t = (b.textContent ?? "").trim().toLowerCase();
      return t === "save" || t === "save job" || t === "save for later";
    }) ??
    null;

  if (panelBtn) {
    if (panelBtn.matches('[data-hook^="favorite-action"]') && favoriteIsSaved(panelBtn)) {
      dumpSaveJob(jobId, panelBtn, "already-saved-panel");
      return true;
    }
    log(`saving job ${jobId} via the detail-panel save control (no left card found).`);
    panelBtn.click();
    await sleep(800);
    dumpSaveJob(jobId, panelBtn, "saved-via-panel");
    return true;
  }

  dumpSaveJob(jobId, null, "no-save-control-found");
  warn(`no save control found for job ${jobId}.`);
  return false;
}

// Inject an overlay onto the Handshake page asking what to do with a job that
// needs other documents. Resolves with the chosen action and whether to remember
// it. Styles are set programmatically (not via a <style> tag) to avoid tripping
// Handshake's CSP. Sits above Handshake's own modal via a max z-index.
function promptOtherDocsDecision(
  title: string,
  company: string,
  instructions: string
): Promise<{ action: OtherDocsAction; remember: boolean }> {
  return new Promise((resolve) => {
    const Z = "2147483647";
    const backdrop = document.createElement("div");
    Object.assign(backdrop.style, {
      position: "fixed",
      inset: "0",
      background: "rgba(15, 23, 42, 0.55)",
      zIndex: Z,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    });

    const card = document.createElement("div");
    Object.assign(card.style, {
      background: "#fff",
      color: "#0f172a",
      width: "min(460px, 92vw)",
      borderRadius: "14px",
      boxShadow: "0 24px 64px rgba(0,0,0,0.32)",
      padding: "22px 22px 18px",
      boxSizing: "border-box"
    });

    const h = document.createElement("div");
    h.textContent = "This job needs other documents";
    Object.assign(h.style, { fontSize: "18px", fontWeight: "700", marginBottom: "6px" });

    const sub = document.createElement("div");
    sub.textContent = `${title || "This job"}${company ? " · " + company : ""}`;
    Object.assign(sub.style, { fontSize: "13px", color: "#475569", marginBottom: "12px" });

    const instr = document.createElement("div");
    instr.textContent = instructions
      ? `Employer asks: ${instructions}`
      : "The application requires a document the bot can't auto-fill.";
    Object.assign(instr.style, {
      fontSize: "13px",
      lineHeight: "1.45",
      background: "#f1f5f9",
      borderRadius: "8px",
      padding: "10px 12px",
      marginBottom: "16px"
    });

    const btnWrap = document.createElement("div");
    Object.assign(btnWrap.style, { display: "flex", flexDirection: "column", gap: "8px" });

    const buttons: Array<{ label: string; action: OtherDocsAction; kind: "primary" | "neutral" | "danger" }> = [
      { label: "Generate it from my documents (AI)", action: "agent", kind: "primary" },
      { label: "Save job & go to next", action: "save", kind: "neutral" },
      { label: "Submit with a blank PDF", action: "blank", kind: "neutral" },
      { label: "Skip (don't save)", action: "skip", kind: "neutral" },
      { label: "Stop the run", action: "stop", kind: "danger" }
    ];

    const rememberRow = document.createElement("label");
    Object.assign(rememberRow.style, {
      display: "flex",
      alignItems: "center",
      gap: "8px",
      fontSize: "13px",
      color: "#334155",
      margin: "14px 2px 4px",
      cursor: "pointer"
    });
    const remember = document.createElement("input");
    remember.type = "checkbox";
    const rememberText = document.createElement("span");
    rememberText.textContent = "Remember my choice for the rest of this run";
    rememberRow.append(remember, rememberText);

    function close(action: OtherDocsAction) {
      const rememberChecked = remember.checked;
      backdrop.remove();
      document.removeEventListener("keydown", onKey, true);
      resolve({ action, remember: rememberChecked });
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close("skip");
      }
    }

    for (const b of buttons) {
      const btn = document.createElement("button");
      btn.textContent = b.label;
      btn.type = "button";
      const palette =
        b.kind === "primary"
          ? { bg: "#2348e3", fg: "#fff", border: "#2348e3" }
          : b.kind === "danger"
            ? { bg: "#fff", fg: "#b91c1c", border: "#fecaca" }
            : { bg: "#fff", fg: "#0f172a", border: "#cbd5e1" };
      Object.assign(btn.style, {
        appearance: "none",
        border: `1px solid ${palette.border}`,
        background: palette.bg,
        color: palette.fg,
        borderRadius: "9px",
        padding: "11px 14px",
        fontSize: "14px",
        fontWeight: "600",
        cursor: "pointer",
        textAlign: "left"
      });
      btn.addEventListener("click", () => close(b.action));
      btnWrap.appendChild(btn);
    }

    card.append(h, sub, instr, btnWrap, rememberRow);
    backdrop.appendChild(card);
    // Clicking the dim backdrop (outside the card) skips, like Escape.
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) close("skip");
    });
    document.addEventListener("keydown", onKey, true);
    (document.body ?? document.documentElement).appendChild(backdrop);
  });
}

// Upload the embedded blank PDF into the "other documents" field and submit.
async function submitWithBlankPdf(base: {
  handshakeJobId: string;
  jobUrl: string;
  title: string;
  company: string;
}): Promise<JobResult> {
  let input = findOtherDocsFileInput();
  if (!input) {
    const uploadBtn = findButtonByText(["upload new", "upload"]);
    if (uploadBtn) {
      uploadBtn.click();
      await sleep(600);
    }
    input = findOtherDocsFileInput();
  }
  if (!input) {
    warn("Could not find the 'other documents' file input to attach a blank PDF.");
    return { ...base, status: "SKIPPED", skipReason: "OTHER_DOCS_UPLOAD_FAILED" };
  }

  try {
    const file = new File([base64ToUint8Array(BLANK_PDF_BASE64) as BlobPart], "document.pdf", {
      type: "application/pdf"
    });
    setFileOnInput(input, file);
    log("attached a blank PDF to the other-documents field.");
  } catch (err) {
    warn("failed to attach blank PDF", err);
    return { ...base, status: "SKIPPED", skipReason: "OTHER_DOCS_UPLOAD_FAILED" };
  }

  await sleep(1500);
  const submitBtn = await waitForEnabledSubmit(6000);
  if (!submitBtn) {
    warn("Blank PDF attached but Submit stayed disabled — other requirements remain.");
    return { ...base, status: "SKIPPED", skipReason: "OTHER_DOCS_UPLOAD_FAILED" };
  }
  log(`submitting with blank PDF via "${(submitBtn.textContent ?? "").trim()}"`);
  submitBtn.click();
  await sleep(1200);
  return { ...base, status: "APPLIED" };
}

// ─── "Other required documents" RAG agent ─────────────────────────────────────
// When the user picks "Generate it from my documents", we ask the backend agent
// to draft the employer-requested document from their stored materials (resume,
// GitHub project, other uploads) + the job context, let them review/edit it in an
// overlay, then render it to a PDF, attach it to the other-docs field, and submit.

// The container holding the "other required documents" heading and its upload
// control — used to detect when Handshake has accepted our uploaded file.
function otherDocsSection(): HTMLElement | null {
  const root = findApplyModalRoot() ?? document;
  const heading = findShortTextEl(/other required documents|other documents/i, 60, root);
  if (!heading) return null;
  let node: HTMLElement | null = heading;
  for (let i = 0; i < 6 && node; i++, node = node.parentElement) {
    const hasControl =
      node.querySelector('input[type="file"]') ||
      Array.from(node.querySelectorAll("button")).some((b) => /upload/i.test(b.textContent ?? ""));
    if (hasControl) return node;
  }
  return heading.parentElement;
}

// Ask the background worker to run the RAG agent for the open job. Returns the
// drafted text + the sources it drew on, or an error string.
async function generateOtherDocText(
  job: JobContext,
  instructions: string
): Promise<{ document: string; sources: string[] } | { error: string }> {
  try {
    const resp = (await chrome.runtime.sendMessage({
      type: "runtime/generate-other-doc",
      job,
      instructions
    })) as
      | { ok?: boolean; otherDoc?: { document: string; sources: string[] }; error?: string }
      | undefined;
    if (resp?.ok && resp.otherDoc) {
      return { document: resp.otherDoc.document, sources: resp.otherDoc.sources ?? [] };
    }
    return { error: resp?.error ?? "Document generation failed." };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Document generation failed." };
  }
}

// Ask the background worker to render the (reviewed) document text to a PDF.
async function renderOtherDocPdf(
  document: string,
  company: string,
  jobTitle: string
): Promise<{ base64: string; filename: string } | null> {
  try {
    const resp = (await chrome.runtime.sendMessage({
      type: "runtime/render-other-doc-pdf",
      document,
      company,
      jobTitle
    })) as { ok?: boolean; pdf?: { base64: string; filename: string } } | undefined;
    return resp?.ok && resp.pdf ? resp.pdf : null;
  } catch (err) {
    warn("failed to render document PDF", err);
    return null;
  }
}

// Drop a rendered document PDF into the apply modal's "other required documents"
// upload field. Mirrors attachCoverLetterFile: clicks "Upload new" to reveal a
// hidden input if needed, then waits for Handshake to fully ACCEPT the file
// (Submit stays disabled until then).
async function attachOtherDocFile(pdfBase64: string, filename: string): Promise<boolean> {
  let input = findOtherDocsFileInput();
  if (!input) {
    const section = otherDocsSection();
    const uploadBtn = Array.from(
      (section ?? document).querySelectorAll<HTMLButtonElement>("button")
    ).find((b) => /upload/i.test(b.textContent ?? ""));
    if (uploadBtn) {
      log("clicking the other-docs section's 'Upload new' to reveal its file input.");
      uploadBtn.click();
      await sleep(600);
    }
    input = findOtherDocsFileInput();
  }
  if (!input) {
    warn("Could not find the other-documents file input in the apply modal.");
    dumpUploadWidgets("otherdocs-no-input");
    return false;
  }
  try {
    const file = new File([base64ToUint8Array(pdfBase64) as BlobPart], filename, {
      type: "application/pdf"
    });
    setFileOnInput(input, file);
    log(`attached document "${filename}" (${file.size} bytes) to the other-docs field.`);
  } catch (err) {
    warn("failed to attach the document file", err);
    return false;
  }
  await sleep(800); // brief settle before polling for the accepted state
  const accepted = await waitForSectionAccepted(otherDocsSection, filename);
  dumpUploadWidgets(accepted ? "otherdocs-accepted" : "otherdocs-not-accepted");
  return accepted;
}

// Overlay: show the agent-drafted document (editable) plus the sources it drew
// on, and ask whether to submit. Resolves with the choice + (possibly edited) text.
function promptAgentDocReview(
  title: string,
  company: string,
  initialText: string,
  sources: string[]
): Promise<{ action: CoverLetterAction; document: string }> {
  return new Promise((resolve) => {
    const Z = "2147483647";
    const backdrop = document.createElement("div");
    Object.assign(backdrop.style, {
      position: "fixed",
      inset: "0",
      background: "rgba(15, 23, 42, 0.55)",
      zIndex: Z,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    });

    const card = document.createElement("div");
    Object.assign(card.style, {
      background: "#fff",
      color: "#0f172a",
      width: "min(620px, 94vw)",
      borderRadius: "14px",
      boxShadow: "0 24px 64px rgba(0,0,0,0.32)",
      padding: "22px 22px 18px",
      boxSizing: "border-box",
      display: "flex",
      flexDirection: "column"
    });

    const h = document.createElement("div");
    h.textContent = "Review generated document";
    Object.assign(h.style, { fontSize: "18px", fontWeight: "700", marginBottom: "6px" });

    const sub = document.createElement("div");
    sub.textContent = `${title || "This job"}${company ? " · " + company : ""}`;
    Object.assign(sub.style, { fontSize: "13px", color: "#475569", marginBottom: "12px" });

    const note = document.createElement("div");
    note.textContent = sources.length
      ? `Drafted from: ${sources.join(", ")}. Edit if you like, then submit.`
      : "The agent drafted this from your stored documents. Edit if you like, then submit.";
    Object.assign(note.style, { fontSize: "12px", color: "#64748b", marginBottom: "10px" });

    const textarea = document.createElement("textarea");
    textarea.value = initialText;
    Object.assign(textarea.style, {
      width: "100%",
      height: "260px",
      boxSizing: "border-box",
      resize: "vertical",
      borderRadius: "10px",
      border: "1px solid #cbd5e1",
      padding: "12px 14px",
      fontSize: "13px",
      lineHeight: "1.5",
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      color: "#0f172a",
      marginBottom: "14px"
    });

    const btnWrap = document.createElement("div");
    Object.assign(btnWrap.style, { display: "flex", flexWrap: "wrap", gap: "8px", justifyContent: "flex-end" });

    const buttons: Array<{ label: string; action: CoverLetterAction; kind: "primary" | "neutral" | "danger" }> = [
      { label: "Stop run", action: "stop", kind: "danger" },
      { label: "Skip this job", action: "skip", kind: "neutral" },
      { label: "Regenerate", action: "regenerate", kind: "neutral" },
      { label: "Approve & submit", action: "submit", kind: "primary" }
    ];

    function close(action: CoverLetterAction) {
      const text = textarea.value;
      backdrop.remove();
      document.removeEventListener("keydown", onKey, true);
      resolve({ action, document: text });
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close("skip");
      }
    }

    for (const b of buttons) {
      const btn = document.createElement("button");
      btn.textContent = b.label;
      btn.type = "button";
      const palette =
        b.kind === "primary"
          ? { bg: "#2348e3", fg: "#fff", border: "#2348e3" }
          : b.kind === "danger"
            ? { bg: "#fff", fg: "#b91c1c", border: "#fecaca" }
            : { bg: "#fff", fg: "#0f172a", border: "#cbd5e1" };
      Object.assign(btn.style, {
        appearance: "none",
        border: `1px solid ${palette.border}`,
        background: palette.bg,
        color: palette.fg,
        borderRadius: "9px",
        padding: "11px 16px",
        fontSize: "14px",
        fontWeight: "600",
        cursor: "pointer"
      });
      btn.addEventListener("click", () => close(b.action));
      btnWrap.appendChild(btn);
    }

    card.append(h, sub, note, textarea, btnWrap);
    backdrop.appendChild(card);
    document.addEventListener("keydown", onKey, true);
    (document.body ?? document.documentElement).appendChild(backdrop);
    textarea.focus();
  });
}

// The "Generate it from my documents" branch: draft → review → attach → submit.
// Owns the submit (it's the user's "ok to submit" gate), so it returns a terminal
// JobResult rather than falling back to a generic submit.
async function handleOtherDocsAgent(
  base: { handshakeJobId: string; jobUrl: string; title: string; company: string },
  job: JobContext,
  instructions: string
): Promise<JobResult> {
  let removeLoading = showLoadingOverlay("Drafting your document from your files…");
  let gen = await generateOtherDocText(job, instructions);
  removeLoading();
  if ("error" in gen) {
    warn(`document generation failed: ${gen.error}`);
    dismissOpenDialog();
    return { ...base, status: "SKIPPED", skipReason: "OTHER_DOCS_UPLOAD_FAILED" };
  }

  let text = gen.document;
  let sources = gen.sources;
  for (;;) {
    const decision = await promptAgentDocReview(base.title, base.company, text, sources);
    text = decision.document;

    if (decision.action === "regenerate") {
      removeLoading = showLoadingOverlay("Redrafting your document…");
      gen = await generateOtherDocText(job, instructions);
      removeLoading();
      if ("error" in gen) {
        warn(`document regeneration failed: ${gen.error}`);
        continue; // keep current text, let the user decide again
      }
      text = gen.document;
      sources = gen.sources;
      continue;
    }
    if (decision.action === "skip") {
      dismissOpenDialog();
      return { ...base, status: "SKIPPED", skipReason: "OTHER_DOCS_REQUIRED" };
    }
    if (decision.action === "stop") {
      inPlaceStop = true;
      dismissOpenDialog();
      return { ...base, status: "SKIPPED", skipReason: "USER_STOPPED" };
    }
    break; // submit
  }

  const pdf = await renderOtherDocPdf(text, base.company, base.title);
  if (!pdf) {
    warn("Document PDF render failed.");
    dismissOpenDialog();
    return { ...base, status: "SKIPPED", skipReason: "OTHER_DOCS_UPLOAD_FAILED" };
  }
  const accepted = await attachOtherDocFile(pdf.base64, pdf.filename);
  if (!accepted) {
    warn("Document uploaded but Handshake never accepted it.");
    dismissOpenDialog();
    return { ...base, status: "SKIPPED", skipReason: "OTHER_DOCS_UPLOAD_FAILED" };
  }

  const outcome = await clickSubmitAndConfirm("other-docs");
  if (outcome === "duplicate") {
    warn("Handshake already has an open application for this job — recording as already applied.");
    dismissOpenDialog();
    return { ...base, status: "SKIPPED", skipReason: "ALREADY_APPLIED" };
  }
  if (outcome === "incomplete") {
    warn("Document accepted but Submit never completed — other required fields remain.");
    return { ...base, status: "SKIPPED", skipReason: "SUBMIT_INCOMPLETE" };
  }
  return { ...base, status: "APPLIED" };
}

// Entry point from processCurrentJobPage when the modal shows "Attach other
// required documents". Uses the remembered choice if set, else prompts the user.
async function handleOtherRequiredDocs(
  base: {
    handshakeJobId: string;
    jobUrl: string;
    title: string;
    company: string;
  },
  job: JobContext
): Promise<JobResult> {
  // Scrape the employer's instructions up front — the agent flow needs them even
  // when the decision is a remembered one (so we don't re-prompt).
  const instructions = extractOtherDocsInstructions();

  let action = otherDocsRemembered;
  if (!action) {
    log(`other-docs gate hit for "${base.title}"; prompting the user.`);
    const decision = await promptOtherDocsDecision(base.title, base.company, instructions);
    action = decision.action;
    if (decision.remember) {
      await rememberOtherDocsAction(action);
      log(`remembering "${action}" for the rest of this run.`);
    }
  } else {
    log(`other-docs gate hit; applying remembered choice "${action}".`);
  }

  switch (action) {
    case "agent":
      return await handleOtherDocsAgent(base, job, instructions);
    case "save": {
      // Close the apply modal first so the left card / detail panel is unobscured.
      dismissOpenDialog();
      await sleep(400);
      const saved = await saveJobForLater(base.handshakeJobId);
      if (!saved) {
        warn("Could not confirm the job was saved; recording it as SAVED_FOR_LATER anyway.");
      }
      return { ...base, status: "SKIPPED", skipReason: "SAVED_FOR_LATER" };
    }
    case "blank": {
      const result = await submitWithBlankPdf(base);
      if (result.status !== "APPLIED") dismissOpenDialog();
      return result;
    }
    case "stop": {
      inPlaceStop = true;
      dismissOpenDialog();
      return { ...base, status: "SKIPPED", skipReason: "USER_STOPPED" };
    }
    case "skip":
    default: {
      dismissOpenDialog();
      return { ...base, status: "SKIPPED", skipReason: "OTHER_DOCS_REQUIRED" };
    }
  }
}

// ─── Message handlers ─────────────────────────────────────────────────────────

const pageSupport = inferPageSupport(window.location.href);

async function handleStatus(): Promise<ContentResponse> {
  const session = await getSession();
  const activeRunId = session && !session.shouldStop ? session.runId : null;
  return {
    ok: true,
    activeRunId,
    runActive: runLoopActive || !!activeRunId
  };
}

function routeKind(): PageDiagnostics["route"] {
  const path = pathnameFor(window.location.href);
  if (isOnJobDetailPage()) return "job-detail";
  if (/\/job-search(?:\/|$)/.test(path)) return "job-search";
  return "supported-other";
}

async function buildPageDiagnostics(): Promise<PageDiagnostics> {
  const session = await getSession();
  const selectedJobId = extractJobId(window.location.href);
  const cards = collectJobCards({ quiet: true });
  const applyButton = findApplyButton();
  const { title, company } = extractJobMeta();

  return {
    url: window.location.href,
    pageSupport,
    route: routeKind(),
    isOnJobDetailPage: isOnJobDetailPage(),
    selectedJobId,
    currentPage: currentPageNumber(),
    visibleJobCardCount: cards.length,
    cardSamples: cards.slice(0, 8).map((card) => ({
      id: card.id,
      title: card.title,
      isSearch: card.isSearch
    })),
    currentJob: {
      title,
      company
    },
    gates: {
      alreadyApplied: isAlreadyApplied(),
      externalApply: isExternalApply(),
      applyButtonFound: !!applyButton,
      applyButtonText: applyButton?.textContent?.trim() || null,
      screeningQuestionsVisible: hasScreeningQuestions(),
      otherRequiredDocsVisible: hasOtherRequiredDocs()
    },
    session: {
      runLoopActive,
      activeRunId: session && !session.shouldStop ? session.runId : null,
      activeMode: session?.mode ?? null,
      shouldStop: session?.shouldStop ?? null,
      seenCount: session?.seenIds?.length ?? 0,
      processed: session?.processed ?? null
    },
    counts: {
      totalButtons: document.querySelectorAll("button").length,
      totalAnchors: document.querySelectorAll("a[href]").length,
      jobResultCardHooks: document.querySelectorAll('[data-hook^="job-result-card"]').length
    },
    buttonsSample: dumpButtonTexts().slice(0, 25)
  };
}

async function emitPageDiagnostics(
  label: "content-ready" | "page-diagnostics"
): Promise<PageDiagnostics | null> {
  try {
    if (label === "content-ready") {
      await waitFor(
        () => pageSupport !== "supported" || isOnJobDetailPage() || collectJobCards({ quiet: true }).length > 0,
        2500,
        250
      );
    }
    const diagnostics = await buildPageDiagnostics();
    log(label, diagnostics);
    console.log(
      `${LOG} ${label.toUpperCase().replace(/-/g, "_")}_JSON\n` +
        JSON.stringify(diagnostics, null, 2)
    );
    void chrome.runtime
      .sendMessage({ type: "content/debug-log", label, payload: diagnostics })
      .catch(() => {});
    return diagnostics;
  } catch (err) {
    warn(`Could not capture ${label}`, err);
    return null;
  }
}

async function handleDiagnosePage(): Promise<ContentResponse> {
  const diagnostics = await emitPageDiagnostics("page-diagnostics");
  if (!diagnostics) {
    return { ok: false, error: "Could not capture Handshake page diagnostics." };
  }
  return { ok: true, diagnostics };
}

async function handleStartRun(
  runId: string,
  settings: Settings,
  screening: ScreeningPrefs
): Promise<ContentResponse> {
  // Refuse a second run while one is already walking this tab. The background
  // guards this too, but its guard lives in the recyclable MV3 service worker;
  // once that's been recycled it can wave a duplicate start through, so we
  // re-check here BEFORE resetting session state or spawning another walker.
  if (runLoopActive) {
    warn(`handleStartRun: a run is already active in this tab; refusing duplicate start (runId ${runId}).`);
    return { ok: false, error: "A run is already active in this tab." };
  }

  screeningPrefs = normalizeScreeningPrefs(screening); // answers used by answerScreeningQuestions() this run
  otherDocsRemembered = null; // every new run starts without a remembered choice
  group(`handleStartRun runId=${runId}`);
  log("url", window.location.href);
  log("pageSupport", pageSupport, "| isOnJobDetailPage", isOnJobDetailPage());
  log("settings", settings);
  log("screening prefs", screening);
  groupEnd();

  if (pageSupport !== "supported") {
    warn("Page is not a supported Handshake page; returning unsupported.");
    return { ok: true, pageSupport: "unsupported", discoveredJobCount: 0 };
  }

  // If already on a job detail page, queue just that one job
  if (isOnJobDetailPage()) {
    log("On a job detail page — processing this single job without queue navigation.");
    const session: RunSession = {
      runId,
      settings,
      shouldStop: false,
      mode: "detail",
      screening: screeningPrefs,
      otherDocsRemembered: null
    };
    await saveSession(session);
    // Process immediately after sending the response
    setTimeout(() => void continueSessionRun(), 500);
    return { ok: true, pageSupport: "supported", discoveredJobCount: 1 };
  }

  log("On a list page — walking the list in place (clicking cards, no navigation).");
  const cards = collectJobCards();
  dumpListCards(cards);

  if (cards.length === 0) {
    warn("Found 0 job cards in the list. Dumping DOM diagnostics so the card selector can be fixed.");
    dumpDomDiagnostics();
    return { ok: true, pageSupport: "supported", discoveredJobCount: 0 };
  }

  inPlaceStop = false;
  // Persist a "list" session so the walker can resume the SAME run if Handshake
  // hard-reloads the search page mid-walk (otherwise it restarts from the top and
  // re-applies).
  await saveSession({
    runId,
    settings,
    shouldStop: false,
    mode: "list",
    screening: screeningPrefs,
    otherDocsRemembered: null,
    seenIds: [],
    processed: 0,
    startPage: currentPageNumber()
  });
  // Start walking after this response goes back to the popup/background. The
  // walker re-collects cards as it scrolls (the list is virtualized).
  setTimeout(() => void runListInPlace(runId, settings), 400);

  return { ok: true, pageSupport: "supported", discoveredJobCount: cards.length };
}

async function handleStopRun(): Promise<ContentResponse> {
  inPlaceStop = true; // stops the in-place walker between cards
  const session = await getSession();
  if (session) {
    await saveSession({ ...session, shouldStop: true });
  }
  return { ok: true, pageSupport, discoveredJobCount: 0 };
}

// Guard against duplicate injection. All content scripts in a frame share one
// isolated-world global, so a flag on `window` is visible across injections (a
// module-level `let` would not be — each injection gets its own scope). If the
// script is injected twice into the same page (e.g. an extension reload while a
// Handshake tab is open), the second instance must NOT register a second
// onMessage listener (that double-handles every message, double-firing
// handleStartRun) or kick off a second continueSessionRun resume.
const haaWindow = window as typeof window & { __haaContentInitialized?: boolean };

if (haaWindow.__haaContentInitialized) {
  log("Duplicate content-script injection in this frame; skipping listener + resume re-init.");
} else {
  haaWindow.__haaContentInitialized = true;

  chrome.runtime.onMessage.addListener((message: ContentMessage, _sender, sendResponse) => {
    void (async () => {
      switch (message.type) {
        case "content/status":
          sendResponse(await handleStatus());
          return;

        case "content/start-run":
          sendResponse(await handleStartRun(message.runId, message.settings, message.screening));
          return;

        case "content/diagnose-page":
          sendResponse(await handleDiagnosePage());
          return;

        case "content/stop-run":
          sendResponse(await handleStopRun());
          return;

        case "content/scrape-job":
          sendResponse({ ok: true, job: scrapeJobContext() });
          return;

        case "content/attach-cover-letter":
          sendResponse({
            ok: true,
            attach: await attachCoverLetterAndSubmit(message.pdfBase64, message.filename)
          });
          return;

        default:
          sendResponse({ ok: false, error: "Unknown content message" } satisfies ContentResponse);
      }
    })();
    return true;
  });

  // On every page load, resume any in-progress run
  void continueSessionRun();

  log("HandShook content script loaded", {
    url: window.location.href,
    pageSupport,
    isOnJobDetailPage: isOnJobDetailPage()
  });
  setTimeout(() => void emitPageDiagnostics("content-ready"), 1500);
}
