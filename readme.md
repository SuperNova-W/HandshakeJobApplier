# HandShook

HandShook is a local-first Chrome Extension MV3 system that automates eligible
native Handshake one-click job applications from the user's already-authenticated
browser session. It combines in-browser automation, a Spring Boot companion API,
SQLite persistence, and AI-assisted document generation while keeping credentials,
documents, settings, and application history on the user's machine.

Landing page: https://handshook.netlify.app/

## Recruiter Summary

- Built a full-stack browser automation product with a React/TypeScript popup,
  Manifest V3 background service worker, Handshake content-script automation, and
  a Java/Spring Boot companion API.
- Designed a privacy-preserving backend architecture that binds to
  `127.0.0.1`, persists state in SQLite, and avoids storing Handshake
  credentials or sending user files through the browser runtime.
- Implemented safe browser automation guardrails: duplicate prevention,
  user-controlled start/stop, per-job audit logging, skip reasons, screening
  preference handling, and refusal to submit external or ambiguous flows.
- Added AI-assisted document workflows that generate cover letters and other
  employer-requested documents server-side from locally stored user materials,
  render reviewed text to PDF, and attach the result in the browser.
- Measured hot local JSON endpoints at roughly 3-4 ms p50 end-to-end latency on
  loopback.

## What It Does

HandShook coordinates three moving parts:

1. The popup gives the user a control panel for backend health, page support,
   start/stop controls, live counters, settings, documents, and recent runs.
2. The background service worker owns runtime state, calls the backend, creates
   and finalizes runs, checks duplicates, and relays messages between popup and
   content script.
3. The content script runs inside Handshake pages, scans job cards, opens job
   details, validates whether a job is safe to apply to, fills supported
   application requirements, and records the outcome.

The product starts only when the user clicks Start. It does not automate sign-in,
store passwords, or submit external applications.

## Architecture

```text
React popup UI
  | chrome.runtime messages
  v
MV3 background service worker
  | messages                     | localhost HTTP
  v                              v
Handshake content script      Spring Boot companion API
  |                              |
  | DOM automation               v
  |                           SQLite
  |
  v
Handshake apply flow
```

The product backend is a local companion service by design, not a hosted cloud
service. It binds to `127.0.0.1:8765` so the user's documents, OpenAI API key,
settings, and application history stay on their machine. The public web presence
is deployed separately as a static Netlify landing page, so the core product has
no shared production database or remote credential store.

## Tech Stack

| Layer | Technology |
| --- | --- |
| Chrome extension | Manifest V3, Chrome Extension APIs, background service worker, content scripts |
| Frontend | React 19, TypeScript 5, Vite 6, lucide-react, custom CSS design tokens |
| Browser automation | DOM scanning, job-detail navigation, modal detection, file input attachment, run-state messaging |
| Backend | Java 21, Spring Boot 3.4, Maven, Spring Web, JDBC, Validation, Actuator |
| Persistence | SQLite, idempotent schema initialization, indexed duplicate checks, BLOB-backed document storage |
| AI/document services | OpenAI Chat Completions (`gpt-4o`) via Spring `RestClient`, Apache PDFBox, OpenPDF |
| Ops/dev workflow | Localhost-only API, rolling file logs, Spring Actuator, health endpoint with live DB connectivity, Netlify static landing page |

## Engineering Highlights

- **Run orchestration:** the background worker owns run state, creates/finalizes
  backend runs, hydrates settings, forwards stop commands, and recovers from
  transient MV3 service-worker restarts.
- **DOM automation:** the content script discovers job cards, opens details,
  waits for hydrated UI state, detects external/already-applied jobs, answers
  supported screening questions, attaches required PDFs, and records outcomes.
- **Safety-first persistence:** SQLite tracks run lifecycle and per-job results;
  a partial unique index prevents duplicate successful applications across runs.
- **Document pipeline:** uploaded PDFs/text files are stored locally, extracted
  with PDFBox for model context, reviewed in-browser, rendered with OpenPDF, and
  attached through file inputs using browser-native `File`/`DataTransfer` APIs.

## Backend API

All API routes are served from `http://127.0.0.1:8765` and CORS-restricted to the
Chrome extension origin.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Service status, version, and live SQLite connectivity |
| `GET` | `/api/settings` | Read run controls such as delay, max pages, and stop-on-error |
| `POST` | `/api/runs` | Create a new application run |
| `PATCH` | `/api/runs/{runId}` | Finalize a run as completed, stopped, or failed |
| `GET` | `/api/runs` | Fetch recent run history for the popup |
| `POST` | `/api/runs/{runId}/applications` | Persist each job outcome |
| `GET` | `/api/applications/exists` | Preflight duplicate check by Handshake job ID |
| `GET` / `PUT` | `/api/content/screening` | Store screening preferences used by the content script |
| `GET` / `POST` / `DELETE` | `/api/documents` | Upload, list, fetch, and delete local application documents |
| `POST` | `/api/cover-letter` | Generate a tailored cover letter from the stored resume and scraped job |
| `POST` | `/api/cover-letter/pdf` | Render reviewed cover-letter text to PDF |
| `POST` | `/api/other-docs/generate` | Draft employer-requested supplemental documents from stored materials |
| `POST` | `/api/other-docs/pdf` | Render reviewed supplemental document text to PDF |
| `POST` | `/api/debug/client-log` | Persist extension-side debug events |

## Data Model

SQLite is the source of truth for local state:

- `settings`: run delay, max pages, and stop-on-error behavior.
- `screening_prefs`: work authorization and relocation answers.
- `documents`: resume, transcript, cover letter, GitHub project writeup, and
  arbitrary supporting files stored as local BLOBs.
- `application_runs`: run lifecycle, source URL, counters, and error state.
- `applications`: per-job status, skip reason, job metadata, and raw snapshot.

A partial unique index on `applications(handshake_job_id) WHERE status =
'APPLIED'` prevents duplicate successful applications across runs.

## Safety Features

- Manual start only; no background auto-run on page load.
- The backend must be healthy before a run can start.
- Each run has a visible Stop control and delay between attempts.
- Jobs are skipped when they are already applied, external, unsupported,
  ambiguous, incomplete, or missing required local documents.
- Duplicate jobs are checked against SQLite before submission.
- AI-generated documents are reviewed by the user before attachment/submission.
- OpenAI calls happen in the backend, keeping the API key and local documents out
  of the browser runtime.

## AI Document Automation

HandShook can handle application flows that ask for additional documents:

- Cover letters are generated from the stored resume and scraped job context.
- "Other required documents" use a lightweight retrieval-augmented flow that
  grounds the draft in the user's stored resume, transcript, GitHub project
  writeup, and other uploaded documents.
- PDFBox extracts text from uploaded PDFs.
- OpenPDF renders reviewed text into attachable PDFs.
- Generated documents are surfaced for review instead of being blindly submitted.

## Performance Snapshot

Measured on June 16, 2026 against an already-running local backend on
`127.0.0.1:8765`, using a one-off Node.js script with 50 sequential `fetch`
requests per endpoint after 5 warm-up requests. These numbers are end-to-end
client-observed latency for non-AI JSON endpoints on loopback; OpenAI generation
latency depends on network/model response time and document size.

| Endpoint | Avg | p50 | p95 | Max |
| --- | ---: | ---: | ---: | ---: |
| `GET /api/health` | 5.38 ms | 4.22 ms | 11.37 ms | 16.91 ms |
| `GET /api/settings` | 3.18 ms | 3.11 ms | 5.79 ms | 6.37 ms |
| `GET /api/applications/exists` | 3.82 ms | 3.11 ms | 9.02 ms | 11.09 ms |

## Repository Layout

```text
HandShook/
├── README.md
├── MVP.md
├── DESIGN.md
├── handshook-extension.zip
├── frontend/
│   ├── package.json
│   ├── public/manifest.json
│   └── src/
│       ├── popup/
│       ├── options/
│       ├── background/
│       ├── content/
│       └── shared/
├── backend/
│   ├── pom.xml
│   ├── run.sh
│   ├── data/
│   ├── logs/
│   └── src/main/
│       ├── java/com/handshook/backend/
│       └── resources/
└── landing/
    ├── index.html
    └── coming-soon.html
```

## Run Locally

### Backend

Requires Java 21 and Maven.

```bash
cd backend
./run.sh
```

The API starts on:

```text
http://127.0.0.1:8765
```

Check health:

```bash
curl -s http://127.0.0.1:8765/api/health
```

AI document features require `OPENAI_API_KEY` in `backend/.env`. The rest of the
backend still works when the key is unset.

### Chrome Extension

Requires Node.js.

```bash
cd frontend
npm install
npm run build
```

Then load `frontend/dist/` in Chrome via `chrome://extensions`, Developer mode,
Load unpacked.

## Verification

Recent local checks:

```bash
cd frontend && npm run build
cd backend && mvn -DskipTests package
```

`mvn test` currently starts the Spring context but fails in this local environment
because Mockito/Byte Buddy cannot self-attach an agent on the installed macOS/JDK
setup. The backend package step verifies compilation and jar creation.

## Resume Bullets

- Built HandShook, a local-first Chrome MV3 extension that automates eligible
  Handshake one-click job applications using React, TypeScript, content scripts,
  and a Spring Boot/SQLite companion API.
- Implemented a run orchestration pipeline with backend health checks, duplicate
  prevention, audited job outcomes, safe skip classifications, and user-controlled
  stop behavior.
- Added server-side AI document generation with OpenAI Chat Completions, PDFBox
  text extraction, OpenPDF rendering, and browser-side PDF attachment workflows
  while keeping API keys and user files local.
