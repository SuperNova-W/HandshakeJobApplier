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
  | messages                     | HTTPS
  v                              v
Handshake content script      API Gateway + Lambda
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
| Ops/dev workflow | AWS Lambda, API Gateway, CloudFormation/SAM, CloudWatch Logs, Spring Actuator, Netlify static landing page |

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
- **Document pipeline:** uploaded PDFs/text files are stored per user in MongoDB, extracted
  with PDFBox for model context, reviewed in-browser, rendered with OpenPDF, and
  attached through file inputs using browser-native `File`/`DataTransfer` APIs.

## Backend API

Production API routes are served through API Gateway and CORS-restricted to the
stable Chrome extension origin. Local development defaults to
`http://127.0.0.1:8765`.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Service status, version, and live datastore connectivity |
| `GET` | `/api/settings` | Read run controls such as delay, max pages, and stop-on-error |
| `POST` | `/api/runs` | Create a new application run |
| `PATCH` | `/api/runs/{runId}` | Finalize a run as completed, stopped, or failed |
| `GET` | `/api/runs` | Fetch recent run history for the popup |
| `POST` | `/api/runs/{runId}/outcomes` | Increment an aggregate applied, skipped, or failed counter |
| `GET` / `PUT` | `/api/content/screening` | Store screening preferences used by the content script |
| `GET` / `POST` / `DELETE` | `/api/documents` | Upload, list, fetch, and delete user-owned application documents |
| `POST` | `/api/users/google` | Verify Google and issue a HandShook session |
| `GET` / `PUT` / `DELETE` | `/api/users/current` | Read/update the signed-in profile or sign out |
| `POST` | `/api/cover-letter` | Generate a tailored cover letter from the stored resume and scraped job |
| `POST` | `/api/cover-letter/pdf` | Render reviewed cover-letter text to PDF |
| `POST` | `/api/other-docs/generate` | Draft employer-requested supplemental documents from stored materials |
| `POST` | `/api/other-docs/pdf` | Render reviewed supplemental document text to PDF |

## MongoDB Data Model

MongoDB is the source of truth for deployed state:

- `users`: verified Google profiles; OAuth tokens are never stored.
- `screening_preferences`: user-owned screening and relocation answers.
- `documents`: user-owned metadata and binary content for application files.
- `application_runs`: user-owned run lifecycle and aggregate counters.

The backend deliberately does not persist per-job outcomes. Handshake's applied
state is used to detect whether a job was already submitted.

## Safety Features

- Manual start only; no background auto-run on page load.
- The backend must be healthy before a run can start.
- Each run has a visible Stop control and delay between attempts.
- Jobs are skipped when they are already applied, external, unsupported,
  ambiguous, incomplete, or missing required saved documents.
- Handshake's own applied state is trusted instead of maintaining a second
  cross-run application ledger.
- AI-generated documents are reviewed by the user before attachment/submission.
- OpenAI calls happen in the backend, keeping the API key and source-document
  contents out of the browser runtime.

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
cp .env.example .env
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

Local development requires a MongoDB connection through `MONGODB_URI`. AI
document features additionally require `OPENAI_API_KEY`.

### Google authentication

HandShook uses Chrome's Identity API with a Google OAuth client of type **Chrome
Extension**:

1. Keep the extension ID stable. For production, upload an unpublished ZIP to
   the Chrome Developer Dashboard, copy its public key, and set
   `GOOGLE_EXTENSION_PUBLIC_KEY` in `frontend/.env`.
2. In Google Cloud Console, configure the OAuth consent screen and create an
   OAuth client with application type **Chrome Extension**. Enter the extension
   ID as its Item ID.
3. Copy `frontend/.env.example` to `frontend/.env` and set
   `GOOGLE_OAUTH_CLIENT_ID`.
4. Set the same `GOOGLE_OAUTH_CLIENT_ID` in `backend/.env`.
5. Rebuild the extension and reload `frontend/dist/` in Chrome.

The extension requests only OpenID, email, and basic profile scopes. OAuth access
tokens remain in Chrome's token cache and are never stored in MongoDB. The backend
checks that each token was issued for HandShook's configured client ID before
accepting the profile, then issues a signed application session used to scope all
MongoDB access to that user.

### Deploy to AWS

1. Create an Atlas cluster/database user and copy its Java driver connection
   string into `backend/.env` as `MONGODB_URI`.
2. Permit Lambda network access in Atlas. For an M0 development cluster this
   usually means temporarily allowing `0.0.0.0/0` and using a strong password.
3. Run `backend/deploy.sh`.
4. Copy the printed API URL into `frontend/.env` as
   `VITE_BACKEND_BASE_URL`, rebuild, and reload the extension.

To migrate the existing local documents and run history, follow
[`backend/backend.md`](backend/backend.md).

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
  while keeping API keys and source-document processing server-side.
