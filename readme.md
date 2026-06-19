# HandShook

HandShook is a Chrome Extension MV3 system that automates eligible native
Handshake one-click job applications from the user's already-authenticated
browser session. It combines in-browser automation, a Spring Boot companion API,
MongoDB-backed persistence, and AI-assisted document generation while keeping
Handshake credentials out of the backend entirely.

Landing page: https://handshook.netlify.app/

## Recruiter Summary

- Built a full-stack browser automation product with a React/TypeScript popup,
  Manifest V3 background service worker, Handshake content-script automation, and
  a Java/Spring Boot companion API.
- Designed a privacy-preserving backend architecture that keeps Handshake
  credentials in the user's logged-in browser session while persisting settings,
  documents, and aggregate run history.
- Implemented safe browser automation guardrails: user-controlled start/stop,
  live run counters, screening preference handling, and refusal to submit
  external or ambiguous flows.
- Added AI-assisted document workflows that generate cover letters and other
  employer-requested documents server-side from stored user materials, render
  reviewed text to PDF, and attach the result in the browser.
- Measured hot local JSON endpoints at roughly 3-4 ms p50 end-to-end latency on
  loopback.

## What It Does

HandShook coordinates three moving parts:

1. The popup gives the user a control panel for backend health, page support,
   start/stop controls, live counters, settings, documents, and recent runs.
2. The background service worker owns runtime state, calls the backend, creates
   and finalizes runs, updates aggregate counters, and relays messages between
   popup and content script.
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
  |                           MongoDB Atlas
  |
  v
Handshake apply flow
```

The backend uses MongoDB Atlas as the deployed persistence layer. The Chrome
extension still automates from the user's authenticated browser tab, so Handshake
credentials are never collected or stored by HandShook. The public web presence
is deployed separately as a static Netlify landing page.

## Tech Stack

| Layer | Technology |
| --- | --- |
| Chrome extension | Manifest V3, Chrome Extension APIs, background service worker, content scripts |
| Frontend | React 19, TypeScript 5, Vite 6, lucide-react, custom CSS design tokens |
| Browser automation | DOM scanning, job-detail navigation, modal detection, file input attachment, run-state messaging |
| Backend | Java 21, Spring Boot 3.4, Maven, Spring Web, Validation, Actuator |
| Persistence | MongoDB Atlas, document collections, compound indexes, document upload metadata/content storage |
| AI/document services | OpenAI Chat Completions (`gpt-4o`) via Spring `RestClient`, Apache PDFBox, OpenPDF |
| Ops/dev workflow | Localhost-only API, rolling file logs, Spring Actuator, health endpoint with live DB connectivity, Netlify static landing page |

## Engineering Highlights

- **Run orchestration:** the background worker owns run state, creates/finalizes
  backend runs, hydrates settings, forwards stop commands, and recovers from
  transient MV3 service-worker restarts.
- **DOM automation:** the content script discovers job cards, opens details,
  waits for hydrated UI state, detects external/already-applied jobs, answers
  supported screening questions, attaches required PDFs, and records outcomes.
- **Lean persistence:** the backend stores aggregate run counters but no job IDs,
  titles, companies, URLs, or per-job application history. Handshake remains the
  source of truth for submitted applications.
- **Document pipeline:** uploaded PDFs/text files are stored locally, extracted
  with PDFBox for model context, reviewed in-browser, rendered with OpenPDF, and
  attached through file inputs using browser-native `File`/`DataTransfer` APIs.

## Backend API

All API routes are served from `http://127.0.0.1:8765` and CORS-restricted to the
Chrome extension origin.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Service status, version, and live datastore connectivity |
| `GET` | `/api/settings` | Read run controls such as delay, max pages, and stop-on-error |
| `POST` | `/api/runs` | Create a new application run |
| `PATCH` | `/api/runs/{runId}` | Finalize a run as completed, stopped, or failed |
| `GET` | `/api/runs` | Fetch recent run history for the popup |
| `POST` | `/api/runs/{runId}/outcomes` | Increment an aggregate applied, skipped, or failed counter |
| `GET` / `PUT` | `/api/content/screening` | Store screening preferences used by the content script |
| `GET` / `POST` / `DELETE` | `/api/documents` | Upload, list, fetch, and delete local application documents |
| `POST` | `/api/cover-letter` | Generate a tailored cover letter from the stored resume and scraped job |
| `POST` | `/api/cover-letter/pdf` | Render reviewed cover-letter text to PDF |
| `POST` | `/api/other-docs/generate` | Draft employer-requested supplemental documents from stored materials |
| `POST` | `/api/other-docs/pdf` | Render reviewed supplemental document text to PDF |

## MongoDB Data Model

MongoDB is the source of truth for deployed state:

- `settings`: run delay, max pages, stop-on-error behavior, and user-level
  runtime preferences.
- `screeningPrefs`: work authorization and relocation answers.
- `documents`: resume, transcript, cover letter, GitHub project writeup, and
  arbitrary supporting files with metadata plus stored content or GridFS
  references.
- `applicationRuns`: run lifecycle, source URL, aggregate counters, and error state.

The backend deliberately does not persist per-job outcomes. Handshake's applied
state is used to detect whether a job was already submitted.

## Safety Features

- Manual start only; no background auto-run on page load.
- The backend must be healthy before a run can start.
- Each run has a visible Stop control and delay between attempts.
- Jobs are skipped when they are already applied, external, unsupported,
  ambiguous, incomplete, or missing required local documents.
- Handshake's own applied state is trusted instead of maintaining a second
  cross-run application ledger.
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

Measured on June 16, 2026 against an already-running backend using a one-off
Node.js script with 50 sequential `fetch` requests per endpoint after 5 warm-up
requests. These numbers cover non-AI JSON endpoints; MongoDB latency depends on
Atlas region, connection pooling, indexes, and network distance. OpenAI
generation latency depends on network/model response time and document size.

| Endpoint | Avg | p50 | p95 | Max |
| --- | ---: | ---: | ---: | ---: |
| `GET /api/health` | 5.38 ms | 4.22 ms | 11.37 ms | 16.91 ms |
| `GET /api/settings` | 3.18 ms | 3.11 ms | 5.79 ms | 6.37 ms |

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
cd backend && mvn test
```

## Resume Bullets

- Built HandShook, a Chrome MV3 extension that automates eligible
  Handshake one-click job applications using React, TypeScript, content scripts,
  and a Spring Boot backend deployed with MongoDB persistence.
- Implemented a run orchestration pipeline with backend health checks, aggregate
  run telemetry, safe skip classifications, and user-controlled stop behavior.
- Added server-side AI document generation with OpenAI Chat Completions, PDFBox
  text extraction, OpenPDF rendering, and browser-side PDF attachment workflows
  while keeping API keys and user files local.
