import { useEffect, useState, type ReactNode } from "react";
import React from "react";
import {
  Activity,
  ArrowRight,
  ChevronsRight,
  Copy,
  FileText,
  FolderOpen,
  Globe,
  History,
  Play,
  RefreshCw,
  Save,
  Send,
  Server,
  Settings as SettingsIcon,
  SlidersHorizontal,
  Sparkles,
  Square
} from "lucide-react";
import { getResume, saveResume } from "../shared/backendApi";
import { BACKEND_BASE_URL, createInitialRuntimeState } from "../shared/constants";
import type {
  ExtensionMessage,
  ExtensionResponse,
  PageContext,
  PopupRunStatus,
  RuntimeState
} from "../shared/contracts";
import { inferPageSupport } from "../shared/handshake";

const initialPageContext: PageContext = {
  support: "unknown",
  url: null
};

function formatStatusLabel(value: string) {
  return value.replace(/_/g, " ").toLowerCase();
}

function formatStartedAt(startedAt: string | null) {
  if (!startedAt) {
    return "Not started";
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(startedAt));
}

function formatRunTime(startedAt: string, endedAt: string | null) {
  const started = new Date(startedAt);
  const ended = endedAt ? new Date(endedAt) : null;

  if (!ended) {
    return formatStartedAt(startedAt);
  }

  const minutes = Math.max(0, Math.round((ended.getTime() - started.getTime()) / 60000));
  return `${formatStartedAt(startedAt)} · ${minutes} min`;
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

async function getActivePageContext(): Promise<PageContext> {
  if (!globalThis.chrome?.tabs?.query) {
    return initialPageContext;
  }

  const [activeTab] = await globalThis.chrome.tabs.query({
    active: true,
    currentWindow: true
  });

  return {
    support: inferPageSupport(activeTab?.url),
    url: activeTab?.url ?? null
  };
}

function App() {
  const [runtimeState, setRuntimeState] = useState<RuntimeState>(createInitialRuntimeState());
  const [pageContext, setPageContext] = useState<PageContext>(initialPageContext);
  const [uiMessage, setUiMessage] = useState("Ready. Refresh backend status before starting a run.");

  // Resume + cover-letter (AI) state
  const [resumeText, setResumeText] = useState("");
  const [resumeStatus, setResumeStatus] = useState("Loading resume…");
  const [coverLetter, setCoverLetter] = useState("");
  const [coverLetterStatus, setCoverLetterStatus] = useState("");
  const [generating, setGenerating] = useState(false);
  const [attaching, setAttaching] = useState(false);

  useEffect(() => {
    void refreshRuntimeState({ refreshBackend: true });
    void refreshPageContext();
    void loadResume();
  }, []);

  // Poll for live counter updates while a run is in progress
  useEffect(() => {
    if (runtimeState.runStatus !== "RUNNING" && runtimeState.runStatus !== "STOPPING") return;
    const id = setInterval(() => void refreshRuntimeState(), 2000);
    return () => clearInterval(id);
  }, [runtimeState.runStatus]);

  async function refreshRuntimeState(options?: { refreshBackend?: boolean }) {
    const response = await sendExtensionMessage({ type: options?.refreshBackend ? "runtime/refresh" : "runtime/get" });

    if (!response) {
      setUiMessage("Chrome runtime unavailable. Open this from the extension, not the browser tab.");
      return;
    }

    if (!response.ok) {
      setUiMessage(response.error);
      return;
    }

    if (!("state" in response)) return;

    setRuntimeState(response.state);
    if (options?.refreshBackend) {
      setUiMessage(
        response.state.backendHealth === "online"
          ? "Backend online. Extension control plane is ready."
          : "Local backend unavailable. Start the companion service on 127.0.0.1:8765 and retry."
      );
    }
  }

  async function refreshPageContext() {
    try {
      const nextContext = await getActivePageContext();
      setPageContext(nextContext);
    } catch {
      setUiMessage("Could not inspect the active tab yet.");
    }
  }

  async function loadResume() {
    try {
      const resume = await getResume();
      setResumeText(resume.resumeText);
      setResumeStatus(resume.hasResume ? "Resume on file." : "No resume yet — paste it below to enable cover letters.");
    } catch {
      setResumeStatus("Couldn't load resume (is the backend running?).");
    }
  }

  async function handleSaveResume() {
    setResumeStatus("Saving…");
    try {
      const saved = await saveResume(resumeText);
      setResumeText(saved.resumeText);
      setResumeStatus(saved.hasResume ? "Resume saved." : "Resume cleared.");
    } catch (error) {
      setResumeStatus(error instanceof Error ? error.message : "Failed to save resume.");
    }
  }

  async function handleGenerateCoverLetter() {
    setGenerating(true);
    setCoverLetterStatus("Reading the job and generating… this can take a few seconds.");
    setCoverLetter("");
    try {
      const response = await sendExtensionMessage({ type: "runtime/generate-cover-letter" });
      if (!response) {
        setCoverLetterStatus("Chrome runtime unavailable. Use this inside the extension.");
        return;
      }
      if (!response.ok) {
        setCoverLetterStatus(response.error);
        return;
      }
      if (!("coverLetter" in response)) return;
      setCoverLetter(response.coverLetter.coverLetter);
      setCoverLetterStatus(`Draft ready (${response.coverLetter.model}). Review and edit before using.`);
    } catch (error) {
      setCoverLetterStatus(error instanceof Error ? error.message : "Generation failed.");
    } finally {
      setGenerating(false);
    }
  }

  async function handleCopyCoverLetter() {
    try {
      await navigator.clipboard.writeText(coverLetter);
      setCoverLetterStatus("Copied to clipboard.");
    } catch {
      setCoverLetterStatus("Couldn't copy — select the text and copy manually.");
    }
  }

  async function handleAttachAndSubmit() {
    setAttaching(true);
    setCoverLetterStatus("Rendering PDF and attaching to the application…");
    try {
      const response = await sendExtensionMessage({ type: "runtime/attach-cover-letter", coverLetter });
      if (!response) {
        setCoverLetterStatus("Chrome runtime unavailable. Use this inside the extension.");
        return;
      }
      if (!response.ok) {
        setCoverLetterStatus(response.error);
        return;
      }
      if (!("attach" in response)) return;
      setCoverLetterStatus(response.attach.message);
    } catch (error) {
      setCoverLetterStatus(error instanceof Error ? error.message : "Attach failed.");
    } finally {
      setAttaching(false);
    }
  }

  async function handleStart() {
    if (pageContext.support !== "supported") {
      setUiMessage("Open a supported Handshake page before starting.");
      return;
    }

    const response = await sendExtensionMessage({ type: "runtime/start" });

    if (!response) {
      setUiMessage("Chrome runtime unavailable. Start is only available inside the extension.");
      return;
    }

    if (!response.ok) {
      setUiMessage(response.error);
      return;
    }

    if (!("state" in response)) return;

    setRuntimeState(response.state);
    setUiMessage("Run started. The extension will navigate through jobs automatically.");
  }

  async function handleStop() {
    const response = await sendExtensionMessage({ type: "runtime/stop" });

    if (!response) {
      setUiMessage("Chrome runtime unavailable. Stop is only available inside the extension.");
      return;
    }

    if (!response.ok) {
      setUiMessage(response.error);
      return;
    }

    if (!("state" in response)) return;

    setRuntimeState(response.state);
    setUiMessage("Stop requested. The current job will finish, then the run will be finalized.");
  }

  const startDisabled =
    pageContext.support !== "supported" ||
    runtimeState.backendHealth !== "online" ||
    runtimeState.runStatus === "RUNNING" ||
    runtimeState.runStatus === "STOPPING";
  const stopDisabled = runtimeState.runStatus !== "RUNNING";

  return (
    <main className="app-shell">
      <section className="hero-panel">
        <div className="hero-top">
          <div className="hero-mark" aria-hidden="true">
            <ChevronsRight size={20} strokeWidth={2.25} />
          </div>
          <div className="hero-heading">
            <p className="eyebrow">Chrome Extension</p>
            <h1>Handshake Auto-Apply</h1>
          </div>
        </div>
        <p className="hero-sub">
          Start, monitor, and stop local Handshake apply runs from the active browser tab.
        </p>
      </section>

      <section className="panel-grid">
        <article className="panel">
          <header className="panel-header">
            <span className="panel-title-ic">
              <Server size={15} aria-hidden="true" /> Companion API
            </span>
            <StatusBadge tone={runtimeState.backendHealth}>{formatStatusLabel(runtimeState.backendHealth)}</StatusBadge>
          </header>
          <p className="panel-copy">{BACKEND_BASE_URL}</p>
          <dl className="compact-list">
            <div>
              <dt>Version</dt>
              <dd>{runtimeState.backendVersion ?? "Unknown"}</dd>
            </div>
            <div>
              <dt>Database</dt>
              <dd>{runtimeState.backendDatabase ?? "Unknown"}</dd>
            </div>
          </dl>
        </article>

        <article className="panel">
          <header className="panel-header">
            <span className="panel-title-ic">
              <Activity size={15} aria-hidden="true" /> Run State
            </span>
            <StatusBadge tone={runtimeState.runStatus}>{formatStatusLabel(runtimeState.runStatus)}</StatusBadge>
          </header>
          <dl className="metric-list">
            <div>
              <dt>Applied</dt>
              <dd>{runtimeState.appliedCount}</dd>
            </div>
            <div>
              <dt>Skipped</dt>
              <dd>{runtimeState.skippedCount}</dd>
            </div>
            <div>
              <dt>Failed</dt>
              <dd>{runtimeState.failedCount}</dd>
            </div>
          </dl>
          <p className="panel-note">Started: {formatStartedAt(runtimeState.startedAt)}</p>
          {runtimeState.runId ? <p className="panel-note">Run: {runtimeState.runId}</p> : null}
        </article>

        <article className="panel panel-wide">
          <header className="panel-header">
            <span className="panel-title-ic">
              <Globe size={15} aria-hidden="true" /> Active Page
            </span>
            <StatusBadge tone={pageContext.support}>{formatStatusLabel(pageContext.support)}</StatusBadge>
          </header>
          <p className="url-preview">{pageContext.url ?? "No active tab detected"}</p>
          <div className="button-row">
            <button className="button button-secondary" type="button" onClick={() => void refreshPageContext()}>
              <RefreshCw size={16} aria-hidden="true" /> Refresh Page
            </button>
          </div>
        </article>
      </section>

      <section className="panel controls-panel">
        <header className="panel-header">
          <span className="panel-title-ic">
            <SlidersHorizontal size={15} aria-hidden="true" /> Controls
          </span>
          <small>Manual start only</small>
        </header>
        <div className="button-row">
          <button className="button button-primary" type="button" onClick={() => void handleStart()} disabled={startDisabled}>
            <Play size={16} aria-hidden="true" /> Start
          </button>
          <button className="button button-secondary" type="button" onClick={() => void handleStop()} disabled={stopDisabled}>
            <Square size={16} aria-hidden="true" /> Stop
          </button>
          <button className="button button-ghost" type="button" onClick={() => void refreshRuntimeState({ refreshBackend: true })}>
            <RefreshCw size={16} aria-hidden="true" /> Refresh
          </button>
        </div>
        <p className="message-box">{uiMessage}</p>
      </section>

      <section className="panel">
        <header className="panel-header">
          <span className="panel-title-ic">
            <Sparkles size={15} aria-hidden="true" /> Cover Letter Agent
          </span>
          <small>AI · review before use</small>
        </header>
        <p className="panel-note">
          Generates a tailored cover letter from your resume and the job currently open in the active tab.
          Open a job (or its apply form), then generate.
        </p>
        <div className="button-row">
          <button
            className="button button-primary"
            type="button"
            onClick={() => void handleGenerateCoverLetter()}
            disabled={generating || pageContext.support !== "supported"}
          >
            <Sparkles size={16} aria-hidden="true" /> {generating ? "Generating…" : "Generate cover letter"}
          </button>
          <button
            className="button button-secondary"
            type="button"
            onClick={() => void handleCopyCoverLetter()}
            disabled={!coverLetter}
          >
            <Copy size={16} aria-hidden="true" /> Copy
          </button>
        </div>
        <textarea
          className="text-area"
          rows={8}
          placeholder="The generated cover letter will appear here for you to review and edit."
          value={coverLetter}
          onChange={(event) => setCoverLetter(event.target.value)}
        />
        <div className="button-row">
          <button
            className="button button-primary"
            type="button"
            onClick={() => void handleAttachAndSubmit()}
            disabled={attaching || !coverLetter || pageContext.support !== "supported"}
          >
            <Send size={16} aria-hidden="true" /> {attaching ? "Attaching…" : "Attach to application & submit"}
          </button>
        </div>
        <p className="panel-note">
          Renders the letter above to a PDF, attaches it to the open apply form's cover-letter field,
          and submits when the form is valid. Review the text first — submitting is final.
        </p>
        {coverLetterStatus ? <p className="message-box">{coverLetterStatus}</p> : null}
      </section>

      <section className="panel">
        <header className="panel-header">
          <span className="panel-title-ic">
            <FileText size={15} aria-hidden="true" /> Resume
          </span>
          <small>Used as cover-letter context</small>
        </header>
        <textarea
          className="text-area"
          rows={6}
          placeholder="Paste your resume text here…"
          value={resumeText}
          onChange={(event) => setResumeText(event.target.value)}
        />
        <div className="button-row">
          <button className="button button-primary" type="button" onClick={() => void handleSaveResume()}>
            <Save size={16} aria-hidden="true" /> Save resume
          </button>
        </div>
        <p className="panel-note">{resumeStatus}</p>
      </section>

      <section className="panel">
        <header className="panel-header">
          <span className="panel-title-ic">
            <FolderOpen size={15} aria-hidden="true" /> Documents
          </span>
          <small>Resume · cover letter · transcript · more</small>
        </header>
        <p className="panel-note">
          Upload the files Handshake applications ask for (resume, transcript, the "coolest GitHub
          project" writeup, and anything else).
        </p>
        <div className="button-row">
          <button
            className="button button-secondary"
            type="button"
            onClick={() => globalThis.chrome?.runtime?.openOptionsPage?.()}
          >
            <FolderOpen size={16} aria-hidden="true" /> Manage documents
            <ArrowRight size={15} aria-hidden="true" />
          </button>
        </div>
      </section>

      <section className="panel">
        <header className="panel-header">
          <span className="panel-title-ic">
            <SettingsIcon size={15} aria-hidden="true" /> Settings
          </span>
          <small>Backend sourced</small>
        </header>
        <dl className="settings-grid">
          <div>
            <dt>Delay</dt>
            <dd>{runtimeState.settings.applyDelayMs} ms</dd>
          </div>
          <div>
            <dt>Page cap</dt>
            <dd>{runtimeState.settings.maxPagesPerRun}</dd>
          </div>
          <div>
            <dt>Stop on error</dt>
            <dd>{runtimeState.settings.stopOnError ? "On" : "Off"}</dd>
          </div>
        </dl>
      </section>

      <section className="panel">
        <header className="panel-header">
          <span className="panel-title-ic">
            <History size={15} aria-hidden="true" /> Recent Runs
          </span>
          <small>{runtimeState.recentRuns.length}</small>
        </header>
        {runtimeState.recentRuns.length ? (
          <ul className="run-list">
            {runtimeState.recentRuns.map((run) => (
              <li key={run.runId}>
                <div>
                  <strong>{formatStatusLabel(run.status)}</strong>
                  <span>{formatRunTime(run.startedAt, run.endedAt)}</span>
                </div>
                <span>
                  {run.appliedCount} / {run.skippedCount} / {run.failedCount}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="panel-note">No run history available yet.</p>
        )}
      </section>
    </main>
  );
}

function StatusBadge({
  tone,
  children
}: {
  tone: PopupRunStatus | RuntimeState["backendHealth"] | PageContext["support"];
  children: ReactNode;
}) {
  return <span className={`status-badge status-${tone.toLowerCase()}`}>{children}</span>;
}

export default App;
