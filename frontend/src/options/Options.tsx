import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type Dispatch,
  type SetStateAction
} from "react";
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  Files,
  FolderGit2,
  GraduationCap,
  ListChecks,
  LogIn,
  LogOut,
  Mail,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  UserRound,
  X,
  type LucideIcon
} from "lucide-react";
import { getScreeningPrefs, saveScreeningPrefs } from "../shared/localData";
import { deleteDocument, downloadDocument, listDocuments } from "../shared/localDocuments";
import { uploadDocument } from "../shared/documentText";
import { DEFAULT_SCREENING, normalizeScreeningPrefs } from "../shared/constants";
import { markOnboardingComplete, readOnboardingState } from "../shared/onboarding";
import type {
  DocumentMeta,
  DocumentType,
  ExtensionMessage,
  ExtensionResponse,
  GoogleUserProfile,
  ScreeningPrefs
} from "../shared/contracts";

interface FixedSlot {
  type: Exclude<DocumentType, "OTHER">;
  title: string;
  hint: string;
  icon: LucideIcon;
}

type OnboardingStep = "auth" | "documents" | "extras" | "screening" | "finish";

const FIXED_SLOTS: FixedSlot[] = [
  {
    type: "RESUME",
    title: "Resume",
    hint: "The resume PDF you attach to applications.",
    icon: FileText
  },
  {
    type: "COVER_LETTER",
    title: "Cover Letter",
    hint: "A general cover-letter file. You can also generate a tailored one per job from the extension popup.",
    icon: Mail
  },
  {
    type: "TRANSCRIPT",
    title: "Transcript",
    hint: "Your official or unofficial transcript.",
    icon: GraduationCap
  },
  {
    type: "GITHUB_PROJECT",
    title: "Coolest GitHub Project",
    hint: "A short writeup about your favorite GitHub project, with a link. Handshake apps ask for this surprisingly often. (An AI agent to auto-generate this from your repos is coming.)",
    icon: FolderGit2
  }
];

const ONBOARDING_STEPS: Array<{ key: OnboardingStep; label: string; icon: LucideIcon }> = [
  { key: "auth", label: "Google", icon: ShieldCheck },
  { key: "documents", label: "Documents", icon: FileText },
  { key: "extras", label: "Other files", icon: Files },
  { key: "screening", label: "Answers", icon: ListChecks },
  { key: "finish", label: "Review", icon: CheckCircle2 }
];

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
      new Date(iso)
    );
  } catch {
    return iso;
  }
}

async function sendExtensionMessage(message: ExtensionMessage): Promise<ExtensionResponse | null> {
  if (!globalThis.chrome?.runtime?.sendMessage) {
    return null;
  }

  try {
    return (await globalThis.chrome.runtime.sendMessage(message)) as ExtensionResponse;
  } catch {
    return null;
  }
}

function Options() {
  const [documents, setDocuments] = useState<DocumentMeta[]>([]);
  const [status, setStatus] = useState("Loading documents...");
  const [busy, setBusy] = useState<string | null>(null);
  const [otherLabel, setOtherLabel] = useState("");
  const otherInputRef = useRef<HTMLInputElement>(null);

  const [screening, setScreening] = useState<ScreeningPrefs>(DEFAULT_SCREENING);
  const [newLocation, setNewLocation] = useState("");
  const [screeningStatus, setScreeningStatus] = useState("");
  const [savingScreening, setSavingScreening] = useState(false);

  const [checkingOnboarding, setCheckingOnboarding] = useState(true);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [onboardingStep, setOnboardingStep] = useState<OnboardingStep>("auth");
  const [googleUser, setGoogleUser] = useState<GoogleUserProfile | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [authStatus, setAuthStatus] = useState("");
  const [finishingOnboarding, setFinishingOnboarding] = useState(false);

  useEffect(() => {
    void refresh();
    void loadScreening();
    void loadOnboarding();
  }, []);

  async function loadOnboarding() {
    const forceOnboarding = new URLSearchParams(globalThis.location.search).get("onboarding") === "1";
    try {
      const state = await readOnboardingState();
      setGoogleUser(state.user);
      const shouldShow = forceOnboarding || !state.complete;
      setShowOnboarding(shouldShow);
      if (shouldShow && state.user) {
        setOnboardingStep("documents");
      }
    } catch {
      setShowOnboarding(forceOnboarding);
    } finally {
      setCheckingOnboarding(false);
    }
  }

  async function loadScreening() {
    try {
      setScreening(normalizeScreeningPrefs(await getScreeningPrefs()));
    } catch {
      /* leave defaults; the documents status surfaces load errors */
    }
  }

  function addLocation() {
    const value = newLocation.trim();
    if (!value) return;
    setNewLocation("");
    if (screening.locations.some((l) => l.toLowerCase() === value.toLowerCase())) return;
    setScreening((s) => ({ ...s, locations: [...s.locations, value] }));
  }

  function removeLocation(loc: string) {
    setScreening((s) => ({ ...s, locations: s.locations.filter((l) => l !== loc) }));
  }

  async function saveScreeningNow(): Promise<boolean> {
    setSavingScreening(true);
    setScreeningStatus("Saving...");
    try {
      setScreening(normalizeScreeningPrefs(await saveScreeningPrefs(screening)));
      setScreeningStatus("Saved.");
      return true;
    } catch (error) {
      setScreeningStatus(error instanceof Error ? error.message : "Save failed.");
      return false;
    } finally {
      setSavingScreening(false);
    }
  }

  async function handleSaveScreening() {
    await saveScreeningNow();
  }

  async function refresh() {
    try {
      const docs = await listDocuments();
      setDocuments(docs);
      setStatus(`${docs.length} document${docs.length === 1 ? "" : "s"} on file.`);
    } catch (error) {
      setStatus(
        error instanceof Error
          ? `Couldn't load your saved documents (${error.message}).`
          : "Couldn't load your saved documents."
      );
    }
  }

  async function handleUpload(
    docType: DocumentType,
    file: File,
    label?: string,
    busyKey = docType + (label ?? "")
  ) {
    setBusy(busyKey);
    setStatus(`Uploading ${file.name}...`);
    try {
      await uploadDocument(docType, file, label);
      setOtherLabel("");
      if (otherInputRef.current) otherInputRef.current.value = "";
      await refresh();
      setStatus(`Uploaded ${file.name}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Upload failed.");
    } finally {
      setBusy(null);
    }
  }

  async function handleDelete(doc: DocumentMeta) {
    setBusy(doc.id);
    try {
      await deleteDocument(doc.id);
      await refresh();
      setStatus(`Removed ${doc.filename}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Delete failed.");
    } finally {
      setBusy(null);
    }
  }

  async function handleGoogleLogin(switchAccount = false) {
    setAuthBusy(true);
    setAuthStatus(switchAccount ? "Switching Google accounts..." : "Opening Google sign-in...");
    try {
      const response = await sendExtensionMessage({
        type: switchAccount ? "runtime/google-switch-account" : "runtime/google-login"
      });
      if (!response) {
        throw new Error("Open onboarding from the installed extension to sign in with Google.");
      }
      if (!response.ok) {
        throw new Error(response.error);
      }
      if (!("user" in response)) {
        throw new Error("Google sign-in returned an unexpected response.");
      }
      setGoogleUser(response.user);
      setAuthStatus(`Signed in as ${response.user.email}.`);
      await Promise.all([refresh(), loadScreening()]);
      setOnboardingStep("documents");
    } catch (error) {
      setAuthStatus(error instanceof Error ? error.message : "Google sign-in failed.");
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleGoogleLogout() {
    setAuthBusy(true);
    setAuthStatus("Signing out...");
    try {
      const response = await sendExtensionMessage({ type: "runtime/google-logout" });
      if (!response) {
        throw new Error("Open this page from the installed extension to sign out.");
      }
      if (!response.ok) {
        throw new Error(response.error);
      }
      setGoogleUser(null);
      setDocuments([]);
      setScreening(DEFAULT_SCREENING);
      setShowOnboarding(true);
      setOnboardingStep("auth");
      setAuthStatus("Signed out.");
    } catch (error) {
      setAuthStatus(error instanceof Error ? error.message : "Sign-out failed.");
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleFinishOnboarding() {
    setFinishingOnboarding(true);
    setStatus("Saving setup...");
    try {
      const saved = await saveScreeningNow();
      if (!saved) return;

      const response = await sendExtensionMessage({ type: "runtime/complete-onboarding" });
      if (response && !response.ok) {
        throw new Error(response.error);
      }

      if (!response) {
        await markOnboardingComplete();
      }

      setShowOnboarding(false);
      setStatus("Setup complete. Manage Documents is filled from your onboarding.");
      globalThis.history.replaceState(null, "", "options.html");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Couldn't finish onboarding.");
    } finally {
      setFinishingOnboarding(false);
    }
  }

  function onFixedFileChange(event: ChangeEvent<HTMLInputElement>, type: DocumentType) {
    const file = event.target.files?.[0];
    if (file) void handleUpload(type, file);
    event.target.value = "";
  }

  function onOtherFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    const label = otherLabel.trim();
    if (!label) {
      setStatus("Add a short label before choosing a file.");
      event.target.value = "";
      return;
    }
    if (file) {
      event.target.value = "";
      void handleUpload("OTHER", file, label, "OTHER_NEW");
    }
  }

  async function replaceOtherDocument(doc: DocumentMeta, file: File) {
    setBusy(doc.id);
    setStatus(`Replacing ${doc.filename}...`);
    let replacement: DocumentMeta | null = null;
    try {
      replacement = await uploadDocument("OTHER", file, doc.label ?? undefined);
      await deleteDocument(doc.id);
      await refresh();
      setStatus(`Replaced ${doc.filename} with ${file.name}.`);
    } catch (error) {
      if (replacement) {
        try {
          await deleteDocument(replacement.id);
        } catch {
          /* best-effort rollback; refresh below will show the actual state */
        }
        await refresh();
      }
      setStatus(error instanceof Error ? error.message : "Replace failed.");
    } finally {
      setBusy(null);
    }
  }

  const otherDocs = documents.filter((d) => d.docType === "OTHER");
  const uploadedFixedCount = FIXED_SLOTS.filter((slot) =>
    documents.some((doc) => doc.docType === slot.type)
  ).length;
  const currentStepIndex = ONBOARDING_STEPS.findIndex((step) => step.key === onboardingStep);
  const isFirstStep = currentStepIndex === 0;
  const isLastStep = currentStepIndex === ONBOARDING_STEPS.length - 1;
  const nextDisabled = onboardingStep === "auth" && !googleUser;

  function goToPreviousStep() {
    if (isFirstStep) return;
    setOnboardingStep(ONBOARDING_STEPS[currentStepIndex - 1].key);
  }

  function goToNextStep() {
    if (isLastStep || nextDisabled) return;
    setOnboardingStep(ONBOARDING_STEPS[currentStepIndex + 1].key);
  }

  function renderDocumentGrid() {
    return (
      <section className="grid">
        {FIXED_SLOTS.map((slot) => (
          <DocumentSlotCard
            key={slot.type}
            slot={slot}
            doc={documents.find((d) => d.docType === slot.type)}
            busy={busy}
            onDelete={(doc) => void handleDelete(doc)}
            onFileChange={(event) => onFixedFileChange(event, slot.type)}
          />
        ))}
      </section>
    );
  }

  function renderScreeningCard() {
    return (
      <section className="card screening-card">
        <div className="card-head">
          <h2 className="card-title">
            <ListChecks size={17} aria-hidden="true" /> Screening answers
          </h2>
        </div>
        <p className="hint">
          When a Handshake application has screening questions, the bot fills these in automatically.
          A job is still skipped if it asks something not covered here.
        </p>

        <ScreeningFields
          screening={screening}
          setScreening={setScreening}
          newLocation={newLocation}
          setNewLocation={setNewLocation}
          addLocation={addLocation}
          removeLocation={removeLocation}
        />

        <div className="actions screening-actions">
          <button
            type="button"
            className="btn btn-primary"
            disabled={savingScreening}
            onClick={() => void handleSaveScreening()}
          >
            <Save size={15} aria-hidden="true" /> {savingScreening ? "Saving..." : "Save answers"}
          </button>
          {screeningStatus && <span className="inline-status">{screeningStatus}</span>}
        </div>
      </section>
    );
  }

  function renderOnboardingStep() {
    if (onboardingStep === "auth") {
      return (
        <section className="card onboarding-card">
          <div className="card-head">
            <h2 className="card-title">
              <ShieldCheck size={17} aria-hidden="true" /> Sign in with Google
            </h2>
            <span className="badge">Required</span>
          </div>
          <p className="hint">
            Start with the Google account you want tied to HandShook before adding application
            materials.
          </p>

          {googleUser ? (
            <AccountPill user={googleUser} />
          ) : (
            <button
              type="button"
              className="btn btn-primary onboarding-primary"
              disabled={authBusy}
              onClick={() => void handleGoogleLogin()}
            >
              <LogIn size={16} aria-hidden="true" /> {authBusy ? "Opening Google..." : "Continue with Google"}
            </button>
          )}

          {googleUser && (
            <button
              type="button"
              className="btn btn-secondary onboarding-secondary"
              disabled={authBusy}
              onClick={() => void handleGoogleLogin(true)}
            >
              <RefreshCw size={15} aria-hidden="true" /> Use a different account
            </button>
          )}

          {googleUser && (
            <button
              type="button"
              className="btn btn-danger onboarding-secondary"
              disabled={authBusy}
              onClick={() => void handleGoogleLogout()}
            >
              <LogOut size={15} aria-hidden="true" /> Sign out
            </button>
          )}

          {authStatus && <p className="inline-status onboarding-status">{authStatus}</p>}
        </section>
      );
    }

    if (onboardingStep === "documents") {
      return (
        <>
          <div className="onboarding-section-head">
            <h2>Application documents</h2>
            <span className="badge">{uploadedFixedCount} / {FIXED_SLOTS.length}</span>
          </div>
          {renderDocumentGrid()}
        </>
      );
    }

    if (onboardingStep === "extras") {
      return (
        <OtherDocumentsCard
          otherDocs={otherDocs}
          otherLabel={otherLabel}
          setOtherLabel={setOtherLabel}
          otherInputRef={otherInputRef}
          busy={busy}
          onOtherFileChange={onOtherFileChange}
          onReplace={(doc, file) => void replaceOtherDocument(doc, file)}
          onDelete={(doc) => void handleDelete(doc)}
        />
      );
    }

    if (onboardingStep === "screening") {
      return renderScreeningCard();
    }

    return (
      <section className="card onboarding-card">
        <div className="card-head">
          <h2 className="card-title">
            <Sparkles size={17} aria-hidden="true" /> Review setup
          </h2>
          <span className="badge badge-on">Ready</span>
        </div>
        <p className="hint">
          Finish saves these answers and brings you to Manage Documents for future edits.
        </p>
        <ul className="completion-list">
          <li>
            <CheckCircle2 size={16} aria-hidden="true" />
            <span>Google account</span>
            <strong>{googleUser?.email ?? "Not signed in"}</strong>
          </li>
          <li>
            <CheckCircle2 size={16} aria-hidden="true" />
            <span>Core documents</span>
            <strong>{uploadedFixedCount} of {FIXED_SLOTS.length}</strong>
          </li>
          <li>
            <CheckCircle2 size={16} aria-hidden="true" />
            <span>Other documents</span>
            <strong>{otherDocs.length}</strong>
          </li>
          <li>
            <CheckCircle2 size={16} aria-hidden="true" />
            <span>Locations</span>
            <strong>{screening.relocateAnywhere ? "Anywhere" : screening.locations.length}</strong>
          </li>
        </ul>
      </section>
    );
  }

  if (checkingOnboarding) {
    return (
      <main className="page">
        <header className="page-header">
          <h1>Application Documents</h1>
          <p>Loading setup...</p>
        </header>
      </main>
    );
  }

  if (showOnboarding) {
    return (
      <main className="page onboarding-page">
        <header className="page-header onboarding-header">
          <span className="eyebrow">First-run setup</span>
          <h1>Set up HandShook</h1>
          <p>
            Sign in and add the files and answers Handshake applications ask for. This fills Manage
            Documents automatically.
          </p>
        </header>

        <OnboardingProgress step={onboardingStep} />

        <div className="onboarding-stage">{renderOnboardingStep()}</div>

        <nav className="onboarding-actions" aria-label="Onboarding controls">
          <button
            type="button"
            className="btn btn-secondary"
            disabled={isFirstStep}
            onClick={goToPreviousStep}
          >
            <ChevronLeft size={16} aria-hidden="true" /> Back
          </button>
          {isLastStep ? (
            <button
              type="button"
              className="btn btn-primary"
              disabled={finishingOnboarding || !googleUser}
              onClick={() => void handleFinishOnboarding()}
            >
              <CheckCircle2 size={16} aria-hidden="true" />
              {finishingOnboarding ? "Finishing..." : "Finish setup"}
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-primary"
              disabled={nextDisabled}
              onClick={goToNextStep}
            >
              Continue <ChevronRight size={16} aria-hidden="true" />
            </button>
          )}
        </nav>

        <p className="status">{status}</p>
      </main>
    );
  }

  return (
    <main className="page">
      <header className="page-header">
        <h1>Application Documents</h1>
        <p>
          Store the documents Handshake applications ask for. Files stay on this device — saved in
          the extension's local storage, never uploaded to a server.
        </p>
      </header>

      {googleUser && (
        <section className="account-management" aria-label="Signed-in Google account">
          <AccountPill user={googleUser} />
          <button
            type="button"
            className="btn btn-danger"
            disabled={authBusy}
            onClick={() => void handleGoogleLogout()}
          >
            <LogOut size={15} aria-hidden="true" />
            {authBusy ? "Signing out..." : "Sign out"}
          </button>
        </section>
      )}

      {renderDocumentGrid()}

      <OtherDocumentsCard
        otherDocs={otherDocs}
        otherLabel={otherLabel}
        setOtherLabel={setOtherLabel}
        otherInputRef={otherInputRef}
        busy={busy}
        onOtherFileChange={onOtherFileChange}
        onReplace={(doc, file) => void replaceOtherDocument(doc, file)}
        onDelete={(doc) => void handleDelete(doc)}
      />

      {renderScreeningCard()}

      <p className="status">{status}</p>
    </main>
  );
}

function DocumentSlotCard({
  slot,
  doc,
  busy,
  onFileChange,
  onDelete
}: {
  slot: FixedSlot;
  doc?: DocumentMeta;
  busy: string | null;
  onFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onDelete: (doc: DocumentMeta) => void;
}) {
  const SlotIcon = slot.icon;

  return (
    <article className="card">
      <div className="card-head">
        <h2 className="card-title">
          <SlotIcon size={17} aria-hidden="true" /> {slot.title}
        </h2>
        {doc ? <span className="badge badge-on">Uploaded</span> : <span className="badge">Empty</span>}
      </div>
      <p className="hint">{slot.hint}</p>

      {doc ? (
        <div className="file-row">
          <div className="file-meta">
            <strong>{doc.filename}</strong>
            <span>
              {formatSize(doc.sizeBytes)} · {formatDate(doc.uploadedAt)}
            </span>
          </div>
          <DocumentActionButtons
            doc={doc}
            busy={busy}
            onFileChange={onFileChange}
            onDelete={onDelete}
          />
        </div>
      ) : (
        <label className="btn btn-primary upload-label">
          <Upload size={16} aria-hidden="true" />
          {busy === slot.type ? "Uploading..." : "Choose file"}
          <input type="file" hidden onChange={onFileChange} />
        </label>
      )}
    </article>
  );
}

function DocumentActionButtons({
  doc,
  busy,
  onFileChange,
  onDelete
}: {
  doc: DocumentMeta;
  busy: string | null;
  onFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onDelete: (doc: DocumentMeta) => void;
}) {
  const isBusy = busy === doc.id;

  return (
    <div className="actions">
      <button
        className="btn btn-ghost"
        type="button"
        disabled={isBusy}
        onClick={() => void downloadDocument(doc.id)}
      >
        <Download size={15} aria-hidden="true" /> Download
      </button>
      <label
        className={`btn btn-secondary${isBusy ? " is-disabled" : ""}`}
        aria-disabled={isBusy}
      >
        <RefreshCw size={15} aria-hidden="true" />
        {isBusy ? "Replacing..." : "Replace"}
        <input type="file" hidden disabled={isBusy} onChange={onFileChange} />
      </label>
      <button
        className="btn btn-danger"
        type="button"
        disabled={isBusy}
        onClick={() => onDelete(doc)}
      >
        <Trash2 size={15} aria-hidden="true" /> Remove
      </button>
    </div>
  );
}

function OtherDocumentsCard({
  otherDocs,
  otherLabel,
  setOtherLabel,
  otherInputRef,
  busy,
  onOtherFileChange,
  onReplace,
  onDelete
}: {
  otherDocs: DocumentMeta[];
  otherLabel: string;
  setOtherLabel: Dispatch<SetStateAction<string>>;
  otherInputRef: React.RefObject<HTMLInputElement | null>;
  busy: string | null;
  onOtherFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onReplace: (doc: DocumentMeta, file: File) => void;
  onDelete: (doc: DocumentMeta) => void;
}) {
  function handleReplaceChange(event: ChangeEvent<HTMLInputElement>, doc: DocumentMeta) {
    const file = event.target.files?.[0];
    if (file) onReplace(doc, file);
    event.target.value = "";
  }

  return (
    <section className="card other-card">
      <div className="card-head">
        <h2 className="card-title">
          <Files size={17} aria-hidden="true" /> Other documents
        </h2>
        <span className="badge">{otherDocs.length}</span>
      </div>
      <p className="hint">
        Keep reusable files that do not fit the core slots, such as writing samples, portfolios,
        references, or project briefs.
      </p>

      <div className="other-upload-panel">
        <div className="other-upload-copy">
          <span className="other-upload-icon" aria-hidden="true">
            <Plus size={18} />
          </span>
          <div>
            <strong>Add another document</strong>
            <span>Give it a clear label, then choose the file from your computer.</span>
          </div>
        </div>
        <div className="other-add">
          <div className="other-label-field">
            <label className="field-label" htmlFor="other-document-label">
              Document label
            </label>
            <input
              id="other-document-label"
              className="text-input"
              type="text"
              placeholder="e.g. Writing sample"
              value={otherLabel}
              onChange={(e) => setOtherLabel(e.target.value)}
              maxLength={80}
            />
          </div>
          <label
            className={`btn btn-primary other-upload-button${
              !otherLabel.trim() || busy === "OTHER_NEW" ? " is-disabled" : ""
            }`}
            aria-disabled={!otherLabel.trim() || busy === "OTHER_NEW"}
          >
            <Upload size={16} aria-hidden="true" />
            {busy === "OTHER_NEW" ? "Uploading..." : "Choose file"}
            <input
              ref={otherInputRef}
              type="file"
              hidden
              disabled={!otherLabel.trim() || busy === "OTHER_NEW"}
              onChange={onOtherFileChange}
            />
          </label>
        </div>
      </div>

      {otherDocs.length === 0 ? (
        <div className="other-empty">
          <Files size={22} aria-hidden="true" />
          <div>
            <strong>No other documents yet</strong>
            <span>Add files here when an application asks for something beyond your core documents.</span>
          </div>
        </div>
      ) : (
        <div className="other-library">
          <div className="other-library-head">
            <strong>Your other documents</strong>
            <span>{otherDocs.length} saved</span>
          </div>
          <ul className="other-list">
            {otherDocs.map((doc) => (
              <li key={doc.id}>
                <div className="other-document-main">
                  <span className="other-document-icon" aria-hidden="true">
                    <FileText size={18} />
                  </span>
                  <div className="file-meta">
                    <strong>{doc.label ?? doc.filename}</strong>
                    <span className="other-filename">{doc.filename}</span>
                    <span>
                      {formatSize(doc.sizeBytes)} · Added {formatDate(doc.uploadedAt)}
                    </span>
                  </div>
                </div>
                <DocumentActionButtons
                  doc={doc}
                  busy={busy}
                  onFileChange={(event) => handleReplaceChange(event, doc)}
                  onDelete={onDelete}
                />
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function ScreeningFields({
  screening,
  setScreening,
  newLocation,
  setNewLocation,
  addLocation,
  removeLocation
}: {
  screening: ScreeningPrefs;
  setScreening: Dispatch<SetStateAction<ScreeningPrefs>>;
  newLocation: string;
  setNewLocation: Dispatch<SetStateAction<string>>;
  addLocation: () => void;
  removeLocation: (loc: string) => void;
}) {
  return (
    <>
      <div className="field">
        <label className="field-label">Are you authorized to work in the United States?</label>
        <div className="seg" role="group" aria-label="US work authorization">
          <button
            type="button"
            className={"seg-btn" + (screening.usWorkAuthorized ? " active" : "")}
            onClick={() => setScreening((s) => ({ ...s, usWorkAuthorized: true }))}
          >
            Yes
          </button>
          <button
            type="button"
            className={"seg-btn" + (!screening.usWorkAuthorized ? " active" : "")}
            onClick={() => setScreening((s) => ({ ...s, usWorkAuthorized: false }))}
          >
            No
          </button>
        </div>
      </div>

      <div className="field">
        <label className="field-label">Do you have or are you pursuing a software engineering or related technical degree?</label>
        <div className="seg" role="group" aria-label="Software engineering degree">
          <button
            type="button"
            className={"seg-btn" + (screening.softwareEngineeringDegree ? " active" : "")}
            onClick={() => setScreening((s) => ({ ...s, softwareEngineeringDegree: true }))}
          >
            Yes
          </button>
          <button
            type="button"
            className={"seg-btn" + (!screening.softwareEngineeringDegree ? " active" : "")}
            onClick={() => setScreening((s) => ({ ...s, softwareEngineeringDegree: false }))}
          >
            No
          </button>
        </div>
      </div>

      <div className="field">
        <label className="field-label">Do you speak English?</label>
        <div className="seg" role="group" aria-label="English language ability">
          <button
            type="button"
            className={"seg-btn" + (screening.speaksEnglish ? " active" : "")}
            onClick={() => setScreening((s) => ({ ...s, speaksEnglish: true }))}
          >
            Yes
          </button>
          <button
            type="button"
            className={"seg-btn" + (!screening.speaksEnglish ? " active" : "")}
            onClick={() => setScreening((s) => ({ ...s, speaksEnglish: false }))}
          >
            No
          </button>
        </div>
      </div>

      <div className="field">
        <label className="field-label">Locations you're in or willing to relocate to</label>
        <label className="toggle-row">
          <input
            type="checkbox"
            checked={screening.relocateAnywhere}
            onChange={(e) => setScreening((s) => ({ ...s, relocateAnywhere: e.target.checked }))}
          />
          <span>Anywhere - answer "Yes" to every location question</span>
        </label>

        {!screening.relocateAnywhere && (
          <>
            <div className="other-add">
              <input
                className="text-input"
                type="text"
                placeholder="Add a city or region (e.g. Miami)"
                value={newLocation}
                onChange={(e) => setNewLocation(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addLocation();
                  }
                }}
              />
              <button type="button" className="btn btn-secondary" onClick={addLocation}>
                <Plus size={16} aria-hidden="true" /> Add
              </button>
            </div>
            {screening.locations.length > 0 ? (
              <div className="chips">
                {screening.locations.map((loc) => (
                  <span className="chip" key={loc}>
                    {loc}
                    <button type="button" aria-label={`Remove ${loc}`} onClick={() => removeLocation(loc)}>
                      <X size={13} aria-hidden="true" />
                    </button>
                  </span>
                ))}
              </div>
            ) : (
              <p className="hint chips-empty">
                No locations yet - location questions will be answered "No".
              </p>
            )}
          </>
        )}
      </div>
    </>
  );
}

function OnboardingProgress({ step }: { step: OnboardingStep }) {
  const currentIndex = ONBOARDING_STEPS.findIndex((item) => item.key === step);

  return (
    <ol className="onboarding-progress" aria-label="Onboarding progress">
      {ONBOARDING_STEPS.map((item, index) => {
        const StepIcon = item.icon;
        const state = index < currentIndex ? "done" : index === currentIndex ? "active" : "upcoming";
        return (
          <li className={`progress-step ${state}`} key={item.key}>
            <span className="progress-icon">
              <StepIcon size={15} aria-hidden="true" />
            </span>
            <span>{item.label}</span>
          </li>
        );
      })}
    </ol>
  );
}

function AccountPill({ user }: { user: GoogleUserProfile }) {
  const initial = (user.name || user.email).trim().charAt(0).toUpperCase();

  return (
    <div className="account-pill">
      <span className="account-avatar" aria-hidden="true">
        {initial || <UserRound size={17} aria-hidden="true" />}
      </span>
      <span>
        <strong>{user.name ?? "Google account"}</strong>
        <small>{user.email}</small>
      </span>
    </div>
  );
}

export default Options;
