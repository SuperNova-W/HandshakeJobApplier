import { useEffect, useState, type ReactNode } from "react";
import React from "react";
import {
  Activity,
  ArrowRight,
  CheckCircle2,
  FolderOpen,
  Globe,
  History,
  Play,
  RefreshCw,
  Settings as SettingsIcon,
  SlidersHorizontal,
  Square
} from "lucide-react";
import { createInitialRuntimeState } from "../shared/constants";
import { onboardingPageUrl, readOnboardingState } from "../shared/onboarding";
import type {
  ExtensionMessage,
  ExtensionResponse,
  PageContext,
  PageDiagnostics,
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
  const [diagnostics, setDiagnostics] = useState<PageDiagnostics | null>(null);
  const [onboardingComplete, setOnboardingComplete] = useState<boolean | null>(null);
  const [uiMessage, setUiMessage] = useState("Ready. Refresh backend status before starting a run.");

  useEffect(() => {
    void refreshRuntimeState({ refreshBackend: true });
    void refreshPageContext();
    void refreshOnboardingState();
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
          : "HandShook's backend is unavailable. Try again in a moment."
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

  async function refreshOnboardingState() {
    try {
      const state = await readOnboardingState();
      setOnboardingComplete(state.complete);
      if (!state.complete) {
        setUiMessage("Finish first-run setup before starting a run.");
      }
    } catch {
      setOnboardingComplete(false);
      setUiMessage("Finish first-run setup before starting a run.");
    }
  }

  function openOnboarding() {
    if (globalThis.chrome?.tabs?.create) {
      void globalThis.chrome.tabs.create({ url: onboardingPageUrl() });
      return;
    }
    globalThis.chrome?.runtime?.openOptionsPage?.();
  }

  function openDocumentsOrOnboarding() {
    if (onboardingComplete === false) {
      openOnboarding();
      return;
    }
    globalThis.chrome?.runtime?.openOptionsPage?.();
  }

  async function handleStart() {
    if (onboardingComplete !== true) {
      setUiMessage("Finish first-run setup before starting a run.");
      return;
    }

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

  async function handleDiagnose() {
    if (pageContext.support !== "supported") {
      setUiMessage("Open a supported Handshake page before diagnosing.");
      return;
    }

    setUiMessage("Capturing page diagnostic...");
    const response = await sendExtensionMessage({ type: "runtime/diagnose-page" });

    if (!response) {
      setUiMessage("Chrome runtime unavailable. Diagnose is only available inside the extension.");
      return;
    }

    if (!response.ok) {
      setUiMessage(response.error);
      return;
    }

    if (!("diagnostics" in response)) return;

    setDiagnostics(response.diagnostics);
    setUiMessage(
      `Diagnostic captured: ${response.diagnostics.visibleJobCardCount} visible cards, ` +
        `${response.diagnostics.selectedJobId ?? "no selected job"}.`
    );
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
    onboardingComplete !== true ||
    pageContext.support !== "supported" ||
    runtimeState.backendHealth !== "online" ||
    runtimeState.runStatus === "RUNNING" ||
    runtimeState.runStatus === "STOPPING";
  const stopDisabled = runtimeState.runStatus !== "RUNNING";
  const diagnoseDisabled = pageContext.support !== "supported";

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="topbar-brand">
          <div className="topbar-mark" aria-hidden="true">
            <img src="/brand/handshook-mark-reversed.svg" alt="" />
          </div>
          <div className="topbar-heading">
            <span className="eyebrow">Chrome Extension</span>
            <h1 className="hs-wordmark">
              HandSh<span className="hs-oo"><img src="/brand/handshook-mark-reversed.svg" alt="" /></span>k
            </h1>
          </div>
        </div>
        <div className="topbar-actions">
          <StatusBadge tone={runtimeState.backendHealth}>
            {runtimeState.backendHealth === "online" ? "Connected" : formatStatusLabel(runtimeState.backendHealth)}
          </StatusBadge>
          <button
            className="icon-button"
            type="button"
            title="Documents & settings"
            aria-label="Open documents and settings"
            onClick={openDocumentsOrOnboarding}
          >
            <SettingsIcon size={18} aria-hidden="true" />
          </button>
        </div>
      </header>

      <div className="scroll-body">
        {onboardingComplete === false && (
          <section className="panel setup-panel">
            <header className="panel-header">
              <span className="panel-title-ic">
                <CheckCircle2 size={15} aria-hidden="true" /> First-run setup
              </span>
              <small>Required</small>
            </header>
            <p className="panel-note">
              Sign in with Google, upload application files, and save screening answers before
              starting.
            </p>
            <div className="button-row">
              <button className="button button-primary" type="button" onClick={openOnboarding}>
                <CheckCircle2 size={16} aria-hidden="true" /> Finish setup
                <ArrowRight size={15} aria-hidden="true" />
              </button>
            </div>
          </section>
        )}

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
            <button className="button button-secondary" type="button" onClick={() => void handleDiagnose()} disabled={diagnoseDisabled}>
              <Activity size={16} aria-hidden="true" /> Diagnose
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
            onClick={openDocumentsOrOnboarding}
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

        <section className="panel">
          <header className="panel-header">
            <span className="panel-title-ic">
              <Globe size={15} aria-hidden="true" /> Active Page
            </span>
            <StatusBadge tone={pageContext.support}>{formatStatusLabel(pageContext.support)}</StatusBadge>
          </header>
          <p className="url-preview">{pageContext.url ?? "No active tab detected"}</p>
          {diagnostics ? (
            <dl className="settings-grid">
              <div>
                <dt>Cards</dt>
                <dd>{diagnostics.visibleJobCardCount}</dd>
              </div>
              <div>
                <dt>Selected</dt>
                <dd>{diagnostics.selectedJobId ?? "None"}</dd>
              </div>
              <div>
                <dt>Apply</dt>
                <dd>{diagnostics.gates.applyButtonFound ? "Found" : "Missing"}</dd>
              </div>
            </dl>
          ) : null}
          <div className="button-row">
            <button className="button button-secondary" type="button" onClick={() => void refreshPageContext()}>
              <RefreshCw size={16} aria-hidden="true" /> Refresh Page
            </button>
          </div>
        </section>
      </div>
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
