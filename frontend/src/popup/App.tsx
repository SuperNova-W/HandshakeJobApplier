import { useEffect, useState, type ReactNode } from "react";
import React from "react";
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
  const [uiMessage, setUiMessage] = useState("Frontend scaffold ready. Backend wiring is next.");

  useEffect(() => {
    void refreshRuntimeState();
    void refreshPageContext();
  }, []);

  async function refreshRuntimeState() {
    const response = await sendExtensionMessage({ type: "runtime/get" });

    if (!response) {
      setUiMessage("Chrome runtime unavailable. Open this from the extension, not the browser tab.");
      return;
    }

    if (!response.ok) {
      setUiMessage(response.error);
      return;
    }

    setRuntimeState(response.state);
  }

  async function refreshPageContext() {
    try {
      const nextContext = await getActivePageContext();
      setPageContext(nextContext);
    } catch {
      setUiMessage("Could not inspect the active tab yet.");
    }
  }

  async function handleStart() {
    if (pageContext.support !== "supported") {
      setUiMessage("Open a supported Handshake page before starting.");
      return;
    }

    const response = await sendExtensionMessage({ type: "runtime/start-placeholder" });

    if (!response) {
      setUiMessage("Chrome runtime unavailable. Start is only available inside the extension.");
      return;
    }

    if (!response.ok) {
      setUiMessage(response.error);
      return;
    }

    setRuntimeState(response.state);
    setUiMessage("Placeholder run started. Background state is wired; backend and apply flow come next.");
  }

  async function handleStop() {
    const response = await sendExtensionMessage({ type: "runtime/stop-placeholder" });

    if (!response) {
      setUiMessage("Chrome runtime unavailable. Stop is only available inside the extension.");
      return;
    }

    if (!response.ok) {
      setUiMessage(response.error);
      return;
    }

    setRuntimeState(response.state);
    setUiMessage("Placeholder run stopped.");
  }

  const startDisabled = pageContext.support !== "supported" || runtimeState.runStatus === "RUNNING";
  const stopDisabled = runtimeState.runStatus !== "RUNNING";

  return (
    <main className="app-shell">
      <section className="hero-card">
        <p className="eyebrow">Handshake Chrome Extension</p>
        <div className="hero-copy">
          <h1>Auto-Apply Frontend</h1>
          <p>
            React popup scaffold for the extension MVP. This layer now owns the popup shell,
            manifest wiring, and background/content entrypoints.
          </p>
        </div>
      </section>

      <section className="panel-grid">
        <article className="panel">
          <header className="panel-header">
            <span>Companion API</span>
            <StatusBadge tone={runtimeState.backendHealth}>{formatStatusLabel(runtimeState.backendHealth)}</StatusBadge>
          </header>
          <p className="panel-copy">{BACKEND_BASE_URL}</p>
          <p className="panel-note">Not connected yet. Health checks will be wired in the next increment.</p>
        </article>

        <article className="panel">
          <header className="panel-header">
            <span>Run State</span>
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
        </article>

        <article className="panel panel-wide">
          <header className="panel-header">
            <span>Active Page</span>
            <StatusBadge tone={pageContext.support}>{formatStatusLabel(pageContext.support)}</StatusBadge>
          </header>
          <p className="url-preview">{pageContext.url ?? "No active tab detected"}</p>
          <div className="button-row">
            <button className="button button-secondary" type="button" onClick={() => void refreshPageContext()}>
              Refresh Page
            </button>
          </div>
        </article>
      </section>

      <section className="panel controls-panel">
        <header className="panel-header">
          <span>Controls</span>
          <small>Placeholder state only</small>
        </header>
        <div className="button-row">
          <button className="button button-primary" type="button" onClick={() => void handleStart()} disabled={startDisabled}>
            Start
          </button>
          <button className="button button-secondary" type="button" onClick={() => void handleStop()} disabled={stopDisabled}>
            Stop
          </button>
          <button className="button button-ghost" type="button" onClick={() => void refreshRuntimeState()}>
            Sync State
          </button>
        </div>
        <p className="message-box">{uiMessage}</p>
      </section>

      <section className="panel">
        <header className="panel-header">
          <span>Next Increments</span>
          <small>Frontend roadmap</small>
        </header>
        <ul className="roadmap-list">
          <li>Wire popup health checks and settings to the Spring Boot companion API.</li>
          <li>Replace placeholder start/stop with real run orchestration in the background worker.</li>
          <li>Add structured content-script events for supported Handshake pages.</li>
        </ul>
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
