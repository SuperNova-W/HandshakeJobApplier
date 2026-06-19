# HandShook MVP

## Document Status
- Status: Approved MVP specification
- Scope: Product and technical specification only
- Implementation status: Not started
- Target platform: Chrome extension (Manifest V3) + local Spring Boot companion API + SQLite

## 1. Overview

This document defines the MVP for a Handshake auto-apply product that applies only to native Handshake one-click jobs. The goal is to provide a practical first version that works from the user's existing logged-in Handshake browser session without storing Handshake credentials in the product.

The MVP is intentionally split into two parts:

1. A Chrome extension that performs in-browser automation on supported Handshake pages.
2. A local Spring Boot companion backend that stores settings, run history, job outcomes, and audit logs in SQLite.

This repository is now a clean implementation starting point centered on this specification. The MVP target described here is the intended architecture for new buildout:

- React popup UI in the extension
- Manifest V3 background service worker
- Content-script-driven DOM automation
- Localhost Spring Boot API on `127.0.0.1:8765`
- SQLite as the source of truth for settings and aggregate run history

The MVP starts manually from the extension popup. It does not auto-run on page load.

## 2. Product Goals

### Primary Goal
- Let a logged-in Handshake user start a run from the browser popup and automatically apply to eligible one-click jobs on supported Handshake job pages.

### Secondary Goals
- Trust Handshake's applied state instead of maintaining a second application ledger.
- Skip unsupported or risky application flows.
- Show clear live progress and recent run history.
- Keep user data local to the user's machine.

### Success Criteria
- A user can install the extension, start the local backend, open Handshake, click `Start`, and complete a run without touching credentials.
- Eligible one-click jobs are applied successfully.
- Ineligible jobs are skipped with a machine-readable reason.
- The popup reflects live state and the backend retains a trustworthy audit trail.

## 3. Non-Goals

The MVP does not include:

- Automatic start when a Handshake page loads
- Advanced job filters by title, company, location, pay, or tags
- Resume selection logic for multiple resumes
- Complex form filling
- Screening question answering
- Multi-account support
- Remote hosting or shared multi-user database storage
- Support for Firefox, Safari, or Edge-specific packaging
- AI-generated answers or AI ranking in the apply loop

## 4. Current Repo Baseline

This repository currently serves as a clean spec-first workspace for the MVP.

Current baseline:

- `MVP.md` is the source of truth for product and technical scope
- Existing implementation code has been removed
- New extension and backend code should be created directly against this architecture

This means the project no longer needs migration logic from older codebases. Implementation should start from the architecture, contracts, and guardrails defined in this document.

## 5. MVP User Story

As a logged-in Handshake user, I want to open a supported Handshake jobs page, click `Start Auto-Apply` in the extension popup, and have the product automatically apply only to valid one-click jobs while logging every result locally.

## 6. Supported Scope

### Supported Browser
- Google Chrome, desktop only

### Supported Domains
- `https://handshake.com/*`
- `https://www.handshake.com/*`
- `https://joinhandshake.com/*`
- `https://app.joinhandshake.com/*`
- `https://*.handshake.com/*`
- `https://*.joinhandshake.com/*`

### Supported Page Types
- Handshake student job listing pages that visibly render job cards or job rows
- Handshake job detail pages or side panels that expose a native Handshake `Apply` button

### Unsupported Page Types
- Login pages
- Employer-facing pages
- Pages with no visible job listings or job details
- Flows that redirect off Handshake
- Any flow that requires user-provided text, file changes, additional selections, or question answering

## 7. Eligibility Rules

A job is eligible for the MVP only if all of the following are true:

- The user is already logged into Handshake
- The current page is supported
- The job exposes a native Handshake `Apply` action
- The job does not show an `Applied` state
- The job does not require leaving Handshake
- The job does not open a multi-step form
- The job does not present screening questions
- The apply button is enabled

### Skip Reasons

Every skipped job must be recorded with one of these reasons:

| Reason | Meaning |
| --- | --- |
| `ALREADY_APPLIED` | Handshake UI indicates the job was already applied to |
| `APPLY_EXTERNALLY` | The flow leaves Handshake or uses an external application |
| `MULTI_STEP_FORM` | The job opens a multi-step or document-heavy flow |
| `SCREENING_QUESTIONS` | The flow contains questions, text fields, radios, checkboxes, selects, or textareas that need answers |
| `NO_APPLY_BUTTON` | No valid native apply button was found |
| `DISABLED_BUTTON` | Apply button exists but is disabled |
| `UNSUPPORTED_PAGE` | The user started from a page without supported job list or detail structures |

## 8. Guardrails

The MVP must include these guardrails:

- Manual start only
- Prominent `Stop` button during active runs
- Delay between application attempts
- Skip any ambiguous or complex flow instead of guessing
- Refuse to start if the backend is unavailable
- Never store Handshake credentials
- Never automate sign-in
- Never submit external applications
- Never retry blindly after repeated selector or backend failures

## 9. User Flow

### Happy Path

1. User starts the local Spring Boot backend.
2. User logs into Handshake in Chrome.
3. User navigates to a supported job listing or job detail page.
4. User opens the extension popup.
5. Popup checks backend health and loads settings and recent runs.
6. User clicks `Start Auto-Apply`.
7. Background service worker creates a new run through the backend.
8. Content script scans visible jobs, opens details, validates eligibility, applies where safe, and records results through the background.
9. Popup shows live counters for applied, skipped, failed, backend health, and last error.
10. Run ends when:
   - No more supported jobs remain
   - Last page is reached
   - `maxPagesPerRun` is hit
   - User clicks `Stop`
   - A fatal error occurs
11. Background finalizes the run in the backend with `COMPLETED`, `STOPPED`, or `FAILED`.

### Stop Flow

1. User clicks `Stop` in the popup.
2. Background flips run state to stopping.
3. Content script finishes the current atomic step and stops before the next job attempt.
4. Background finalizes the run as `STOPPED`.

### Offline Backend Flow

1. User opens the popup.
2. Popup fails `GET /api/health`.
3. Popup disables `Start`.
4. Popup shows a clear message such as: `Local backend unavailable. Start the companion service on 127.0.0.1:8765 and retry.`

## 10. High-Level Architecture

```text
+-------------------+        runtime messages        +----------------------+
| React Popup UI    | <----------------------------> | Background Worker    |
| - Health          |                                | - Run state          |
| - Start/Stop      |                                | - Tab coordination   |
| - Counters        |                                | - Backend API client |
| - Recent runs     |                                +----------+-----------+
+---------+---------+                                           |
          |                                                     |
          | chrome.runtime messaging                            | localhost HTTP
          |                                                     |
          v                                                     v
+-------------------+                                  +----------------------+
| Content Script    |                                  | Spring Boot API      |
| - Scan listings   |                                  | - Settings           |
| - Open jobs       |                                  | - Run persistence    |
| - Validate flows  |                                  | - Application audit  |
| - Click apply     |                                  | - Duplicate checks   |
| - Emit events     |                                  +----------+-----------+
+-------------------+                                             |
                                                                  |
                                                                  v
                                                          +------------------+
                                                          | SQLite           |
                                                          +------------------+
```

## 11. Extension Architecture

### 11.1 Technology Defaults

- Manifest V3
- React for popup UI
- TypeScript for popup, background, and shared contracts
- Content scripts may use TypeScript compiled to extension-safe JavaScript
- Browser storage is allowed for transient UI state only; SQLite is the source of truth for persisted run data

### 11.2 Extension Responsibilities

#### Popup UI
- Display backend health
- Display current run state
- Start and stop runs
- Show applied, skipped, failed counts
- Show last completed run summary
- Show last error, if present
- Allow settings updates for:
  - `applyDelayMs`
  - `maxPagesPerRun`
  - `stopOnError`

#### Background Service Worker
- Maintain canonical in-extension run state
- Validate startup prerequisites before initiating a run
- Own communication with the local backend
- Create runs and finalize runs
- Relay progress messages between popup and content script
- Hold a `seenJobIds` set for the current run to avoid intra-run duplicate work
- Stop the run safely when the popup requests it or a fatal condition occurs

#### Content Script
- Detect supported page structures
- Discover visible job entries
- Open each job detail safely
- Identify apply button type
- Skip external, complex, or ambiguous flows
- Confirm simple one-click submissions only
- Paginate listings when appropriate
- Send structured events to background after each job outcome

### 11.3 Permissions

The extension MVP is expected to require:

- `storage`
- `activeTab`
- `tabs`

Host permissions:

- Supported Handshake domains listed above
- `http://127.0.0.1:8765/*`

## 12. Backend Architecture

### 12.1 Technology Defaults

- Java 21
- Spring Boot 3.x
- Spring Web
- Spring Data JPA
- Flyway for schema migrations
- SQLite via JDBC

### 12.2 Runtime Rules

- Bind only to `127.0.0.1:8765`
- No Handshake credential storage
- No browser automation in the backend
- No remote exposure in the MVP
- No user authentication in the MVP because the backend is local-only
- CORS must allow the extension origin and block unrelated origins

### 12.3 Backend Responsibilities

- Report service health and version
- Persist settings
- Create and finalize runs
- Persist aggregate applied, skipped, and failed counts for each run
- Return recent run history to the popup

## 13. Target Data Model

### 13.1 Shared Enums

```text
RunStatus = RUNNING | COMPLETED | STOPPED | FAILED
ApplicationStatus = APPLIED | SKIPPED | FAILED
```

### 13.2 Shared Types

```text
Settings = {
  applyDelayMs: number,
  maxPagesPerRun: number,
  stopOnError: boolean
}

ApplicationRecord = {
  handshakeJobId: string,
  title: string,
  company: string,
  jobUrl: string,
  status: ApplicationStatus,
  skipReason?: string,
  errorMessage?: string,
  appliedAt: string
}
```

### 13.3 Extension Runtime State

The background worker should maintain:

- `isRunning`
- `isStopping`
- `runId`
- `tabId`
- `sourceUrl`
- `appliedCount`
- `skippedCount`
- `failedCount`
- `lastError`
- `seenJobIds`
- `startedAt`

## 14. SQLite Schema

The SQLite database is the persistent source of truth for settings and run history.

### 14.1 `settings`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | INTEGER PRIMARY KEY | Single-row settings record |
| `apply_delay_ms` | INTEGER NOT NULL | Default delay between attempts |
| `max_pages_per_run` | INTEGER NOT NULL | Hard page cap per run |
| `stop_on_error` | BOOLEAN NOT NULL | Whether to end the run on first fatal application error |
| `created_at` | TEXT NOT NULL | ISO timestamp |
| `updated_at` | TEXT NOT NULL | ISO timestamp |

Default row:

```text
id = 1
apply_delay_ms = 1500
max_pages_per_run = 10
stop_on_error = false
```

### 14.2 `application_runs`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | TEXT PRIMARY KEY | UUID string |
| `started_at` | TEXT NOT NULL | ISO timestamp |
| `ended_at` | TEXT NULL | ISO timestamp |
| `status` | TEXT NOT NULL | `RUNNING`, `COMPLETED`, `STOPPED`, `FAILED` |
| `source_url` | TEXT NOT NULL | Handshake page where the run started |
| `applied_count` | INTEGER NOT NULL DEFAULT 0 | Applied total |
| `skipped_count` | INTEGER NOT NULL DEFAULT 0 | Skipped total |
| `failed_count` | INTEGER NOT NULL DEFAULT 0 | Failed total |
| `error_message` | TEXT NULL | Fatal run-level error if present |

The backend intentionally has no per-job applications table. Handshake is the
source of truth for submitted applications; SQLite keeps only run-level totals.

## 15. Backend API Contract

The following endpoints are part of the MVP contract.

### 15.1 `GET /api/health`

Purpose:
- Verify backend readiness before enabling `Start`

Response:

```json
{
  "status": "UP",
  "version": "0.1.0",
  "database": "CONNECTED"
}
```

Failure handling:
- Any non-200 response disables start in the popup

### 15.2 `GET /api/settings`

Purpose:
- Load extension settings into the popup and background

Response:

```json
{
  "applyDelayMs": 1500,
  "maxPagesPerRun": 10,
  "stopOnError": false
}
```

### 15.3 Settings updates

Settings are currently read-only through `GET /api/settings`; the unused
`PUT /api/settings` endpoint was removed from the backend.

### 15.4 `POST /api/runs`

Purpose:
- Create a new run when the user starts auto-apply

Request:

```json
{
  "sourceUrl": "https://app.joinhandshake.com/stu/postings",
  "startedAt": "2026-04-01T12:00:00.000Z"
}
```

Response:

```json
{
  "runId": "d5e2b4a3-6a3d-4f74-9fad-7e8a97bfa901",
  "status": "RUNNING",
  "startedAt": "2026-04-01T12:00:00.000Z"
}
```

### 15.5 `POST /api/runs/{runId}/outcomes`

Purpose:
- Increment one aggregate run counter without persisting job identity

Request:

```json
{
  "status": "SKIPPED"
}
```

Rules:
- `status` must be `APPLIED`, `SKIPPED`, or `FAILED`
- The request does not contain a job ID, title, company, URL, or skip reason

### 15.6 `PATCH /api/runs/{runId}`

Purpose:
- Finalize a run

Request:

```json
{
  "status": "COMPLETED",
  "endedAt": "2026-04-01T12:06:00.000Z",
  "errorMessage": null
}
```

Response:

```json
{
  "runId": "d5e2b4a3-6a3d-4f74-9fad-7e8a97bfa901",
  "status": "COMPLETED",
  "appliedCount": 14,
  "skippedCount": 8,
  "failedCount": 1,
  "endedAt": "2026-04-01T12:06:00.000Z"
}
```

### 15.7 `GET /api/runs?limit=10`

Purpose:
- Show recent run history in the popup

Response:

```json
[
  {
    "runId": "d5e2b4a3-6a3d-4f74-9fad-7e8a97bfa901",
    "startedAt": "2026-04-01T12:00:00.000Z",
    "endedAt": "2026-04-01T12:06:00.000Z",
    "status": "COMPLETED",
    "sourceUrl": "https://app.joinhandshake.com/stu/postings",
    "appliedCount": 14,
    "skippedCount": 8,
    "failedCount": 1,
    "errorMessage": null
  }
]
```

### 15.9 AI Document Endpoints (post-MVP)

OpenAI-backed document generation, added after the core MVP. Generation runs
server-side so the API key and the user's stored files never reach the browser;
all of these require `OPENAI_API_KEY` in the backend environment.

- `POST /api/cover-letter` — generates a cover letter from the stored resume + the
  scraped job; `POST /api/cover-letter/pdf` renders the reviewed text to a PDF.
- `POST /api/other-docs/generate` — a retrieval-augmented (RAG) agent that drafts
  the *extra* document an employer requests in the "Attach other required
  documents" gate. It retrieves the user's stored materials (resume, GitHub
  project, transcript, and any `OTHER` uploads), then asks the model to draft the
  requested document grounded in them plus the job description and the employer's
  instructions. Returns `{ document, model, generatedAt, sources }`.
- `POST /api/other-docs/pdf` — renders the reviewed agent document to a PDF for the
  extension to attach into the apply modal.

In the extension, the "other required documents" overlay surfaces this as a
**"Generate it from my documents (AI)"** option alongside Save / Blank PDF / Skip /
Stop: it drafts, lets the user review/edit, then attaches the PDF and submits.

## 16. Extension-Backend Interaction Model

### Run Start

1. Popup calls background `startRun`
2. Background checks:
   - Active tab exists
   - URL matches supported Handshake domain
   - Backend health is `UP`
   - Settings loaded successfully
3. Background creates backend run
4. Background sends `startRun` message to the content script with:
   - `runId`
   - `applyDelayMs`
   - `maxPagesPerRun`
   - `stopOnError`

### Per-Job Processing

For each discovered job:

1. Content script extracts job metadata
2. If Handshake shows already applied, count the job as skipped
3. If the button is external or complex, count a skip
4. If the flow is valid one-click apply, click apply and confirm
5. Increment the matching aggregate run counter
6. Update popup counts through background state

### Run Completion

Background finalizes the run as:

- `COMPLETED` when pagination ends naturally
- `STOPPED` when the user requests stop
- `FAILED` when a fatal backend or automation issue aborts the run

## 17. Failure Modes and Expected Behavior

| Failure | Expected Behavior |
| --- | --- |
| Backend offline before run start | Popup disables `Start` and surfaces backend error |
| Backend fails mid-run | Background stops the run and finalizes as `FAILED` if possible |
| Unsupported page | No run starts; popup shows page support error |
| DOM selector mismatch on one job | Mark that job `FAILED` or `SKIPPED`, continue unless `stopOnError = true` |
| Confirmation modal contains inputs | Skip as `SCREENING_QUESTIONS` or `MULTI_STEP_FORM` |
| Apply button text indicates external flow | Skip as `APPLY_EXTERNALLY` |
| Duplicate job within same run | Skip without applying using in-memory `seenJobIds` |
| Job applied during a prior run | Trust Handshake's applied state |

## 18. Security and Privacy Requirements

- Handshake credentials are never stored by the extension or backend
- Backend listens on `127.0.0.1` only
- Backend persists local audit data only
- No remote telemetry in the MVP
- Raw job snapshots must contain selector and button context only, not sensitive user profile content
- Extension should request the minimum required permissions

## 19. Logging and Observability

The MVP should log enough data to debug failures without exposing private credentials.

### Required Log Events
- Backend startup and DB connection
- Run created
- Run finalized
- Job discovered
- Job skipped with reason
- Job applied
- Job failed with error
- Backend health failure
- Stop requested

### Required Popup Visibility
- Backend health
- Current run status
- Applied count
- Skipped count
- Failed count
- Last error
- Last completed run summary

## 20. Acceptance Criteria

The MVP is complete when all of the following are true:

1. Manual start from the popup on a supported Handshake jobs page creates a backend run and updates live counters.
2. Native one-click Handshake jobs are applied successfully and reflected in aggregate run counters.
3. External apply links, screening questions, multi-step modals, disabled buttons, and already-applied jobs are skipped and logged with the correct reason.
4. Re-running relies on Handshake's applied state; no local cross-run application ledger is maintained.
5. Clicking `Stop` halts the run before the next job attempt and finalizes the run as `STOPPED`.
6. If the backend is offline, the popup blocks `Start` and surfaces a clear error instead of silently running.
7. Pagination stops cleanly at the last page or at `maxPagesPerRun`.

## 21. Test Plan

### Manual Product Tests
- Start from a supported listing page with backend online
- Start from an unsupported Handshake page
- Start with backend offline
- Apply a run with at least one valid one-click job
- Encounter an external apply job
- Encounter a screening question modal
- Encounter a multi-step flow
- Encounter an already-applied job
- Stop during an active run
- Re-run the same page and confirm Handshake marks submitted jobs as already applied

### Backend Tests
- Health endpoint returns `UP`
- Settings persist and reload correctly
- Run creation and finalization work
- Aggregate run counters increment for `APPLIED`, `SKIPPED`, and `FAILED`
- No per-job `applications` table exists

### Extension Tests
- Popup reflects backend health correctly
- Popup counters update during a run
- Background preserves state while popup opens and closes
- Content script halts safely when stop is requested

## 22. Risks

### DOM Volatility
Handshake may change selectors or application flow structure. The implementation must use layered selectors and defensive checks.

### Terms and Platform Risk
Handshake may view aggressive automation unfavorably. The MVP should stay conservative, manual-start only, and limited to native one-click flows.

### Local Backend Dependency
The product depends on a local service running correctly. The UX must make backend state obvious.

## 23. Phased Implementation Milestones

### Phase 1: Backend Foundation
- Create Spring Boot app under a dedicated backend directory
- Add SQLite connection and Flyway migrations
- Implement settings, run-counter, and health endpoints

### Phase 2: Extension Foundation
- Convert popup to React
- Implement background service worker state model
- Add backend API client and localhost health checks
- Add popup health, settings, start, stop, and recent-runs UI

### Phase 3: Apply Loop
- Implement supported page detection
- Implement job discovery, detail opening, and eligibility classification
- Implement one-click apply handling and modal confirmation
- Persist only aggregate run outcomes to backend

### Phase 4: Hardening
- Improve selector fallback strategy
- Improve stop behavior and error handling
- Validate Handshake applied-state handling end to end
- Complete manual QA checklist

## 24. Implementation Defaults and Assumptions

- Chrome is the only supported browser for MVP.
- React is used only for the popup UI, not for DOM automation.
- Spring Boot runs locally on `127.0.0.1:8765`.
- SQLite is local per user and not shared remotely.
- No auto-run on page load.
- No complex-form completion.
- No resume switching.
- No job filters in the MVP.
- The repository currently contains specification and setup files only; implementation will be built fresh from this document.

## 25. Deliverable

The deliverable defined by this document is a first production-grade MVP architecture and behavior specification for building a Handshake auto-apply product in this repository. This file is the implementation source of truth until code work begins.
