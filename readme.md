# HandShook

HandShook is a Chrome Extension MV3 system that automates eligible native
Handshake one-click job applications from the user's already-authenticated
browser session. It combines in-browser automation, a stateless Spring Boot
companion API on AWS Lambda, local-first persistence in the browser, and
AI-assisted document generation while keeping Handshake credentials — and all
user data — out of the backend entirely.

Landing page: https://handshook.netlify.app/
Publishing runbook: [`PUBLISHING.md`](PUBLISHING.md)

## Recruiter Summary

- Built a full-stack browser automation product with a React/TypeScript popup,
  Manifest V3 background service worker, Handshake content-script automation, and
  a Java/Spring Boot companion API deployed serverless on AWS Lambda.
- Designed a local-first architecture: resume, documents, preferences, and run
  history live in `chrome.storage.local`; the backend is stateless with no
  database, so no user data ever rests on a server.
- Implemented safe browser automation guardrails: user-controlled start/stop,
  live run counters, screening preference handling, and refusal to submit
  external or ambiguous flows.
- Added AI-assisted document workflows that generate cover letters and other
  employer-requested documents server-side from per-request context, render
  reviewed text to PDF, and attach the result in the browser.
- Measured hot local JSON endpoints at roughly 3-4 ms p50 end-to-end latency on
  loopback.

## What It Does

HandShook coordinates three moving parts:

1. The popup gives the user a control panel for backend health, page support,
   start/stop controls, live counters, settings, documents, and recent runs.
2. The background service worker owns runtime state, stores run history and
   preferences locally, calls the AI backend, and relays messages between
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
MV3 background service worker ──── chrome.storage.local
  | messages                  |      (documents, profile,
  v                           |       prefs, run history)
Handshake content script      | HTTPS (AI + sign-in only)
  |                           v
  | DOM automation         API Gateway + Lambda (stateless)
  v                           |
Handshake apply flow          v
                           OpenAI API
```

The backend is deliberately stateless: it verifies Google sign-ins and runs the
AI document endpoints, and keeps no database. Every piece of user data lives in
the extension's `chrome.storage.local` on the user's machine. The Chrome
extension automates from the user's authenticated browser tab, so Handshake
credentials are never collected or stored by HandShook. The public web presence
is a static Netlify landing page.

## Tech Stack

| Layer | Technology |
| --- | --- |
| Chrome extension | Manifest V3, Chrome Extension APIs, background service worker, content scripts |
| Frontend | React 19, TypeScript 5, Vite 6, lucide-react, custom CSS design tokens |
| Browser automation | DOM scanning, job-detail navigation, modal detection, file input attachment, run-state messaging |
| Backend | Java 21, Spring Boot 3.4, Maven, Spring Web, Validation, Actuator |
| Persistence | `chrome.storage.local` (documents, profile, screening prefs, run history) — no server-side database |
| AI/document services | OpenAI Chat Completions (`gpt-4o`) via Spring `RestClient`, OpenPDF rendering, client-side `pdfjs-dist` text extraction |
| Ops/dev workflow | AWS Lambda (SnapStart), API Gateway, SAM/CloudFormation, CloudWatch Logs, Netlify static landing page |

## Engineering Highlights

- **Run orchestration:** the background worker owns run state, records runs and
  aggregate counters in local storage, hydrates settings, forwards stop
  commands, and recovers from transient MV3 service-worker restarts.
- **DOM automation:** the content script discovers job cards, opens details,
  waits for hydrated UI state, detects external/already-applied jobs, answers
  supported screening questions, attaches required PDFs, and records outcomes.
- **Local-first persistence:** all user data lives in the browser. The backend
  stores nothing — no job IDs, titles, companies, URLs, per-job history, or
  even user rows. Handshake remains the source of truth for submitted
  applications.
- **Stateless AI pipeline:** AI endpoints receive the resume text / knowledge
  base per request, draft with OpenAI, and render reviewed text with OpenPDF;
  the browser attaches the PDF using native `File`/`DataTransfer` APIs. A
  per-user hourly rate limit protects the public deployment.

## Backend API

Production routes are served through API Gateway + Lambda and CORS-restricted
to the stable Chrome extension origin. Local development defaults to
`http://127.0.0.1:8765`.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Service status and version |
| `POST` | `/api/users/google` | Verify Google sign-in and issue a HandShook session token |
| `POST` | `/api/cover-letter` | Generate a tailored cover letter from the request's resume text and scraped job |
| `POST` | `/api/cover-letter/pdf` | Render reviewed cover-letter text to PDF |
| `POST` | `/api/other-docs/generate` | Draft employer-requested supplemental documents from the request's sources |
| `POST` | `/api/other-docs/pdf` | Render reviewed supplemental document text to PDF |

Everything else — settings, screening preferences, run history, documents, the
user profile — is read and written directly in `chrome.storage.local` by the
extension (`frontend/src/shared/localData.ts`, `localDocuments.ts`,
`onboarding.ts`).

## Data Model (chrome.storage.local)

- `handshook:googleUser` — the verified Google profile saved at sign-in.
- `handshook:sessionToken` — the signed HandShook session token.
- `handshook:screeningPrefs` — screening and relocation answers.
- `handshook:runs` — recent run lifecycle + aggregate counters (capped at 25).
- Document keys — uploaded resume/transcript/etc. with client-side extracted text.

The extension deliberately does not persist per-job outcomes. Handshake's applied
state is used to detect whether a job was already submitted. Uninstalling the
extension deletes all data; there is nothing server-side to delete.

## Safety Features

- Manual start only; no background auto-run on page load.
- The backend must be healthy before a run can start.
- Each run has a visible Stop control and delay between attempts.
- Jobs are skipped when they are already applied, external, unsupported,
  ambiguous, incomplete, or missing required saved documents.
- Handshake's own applied state is trusted instead of maintaining a second
  cross-run application ledger.
- AI-generated documents are reviewed by the user before attachment/submission.
- OpenAI calls happen in the backend, keeping the API key out of the browser
  runtime, with per-user rate limits and API Gateway throttling.

## AI Document Automation

HandShook can handle application flows that ask for additional documents:

- Cover letters are generated from the locally stored resume and scraped job context.
- "Other required documents" use a lightweight retrieval-augmented flow that
  grounds the draft in the user's locally stored resume, transcript, GitHub
  project writeup, and other uploaded documents, shipped per request.
- `pdfjs-dist` extracts text from uploaded PDFs in the browser.
- OpenPDF renders reviewed text into attachable PDFs on the backend.
- Generated documents are surfaced for review instead of being blindly submitted.

## Performance Snapshot

Measured June 16, 2026 against the locally running backend using 50 sequential
`fetch` requests per endpoint after 5 warm-ups. Production adds API Gateway +
Lambda overhead (SnapStart keeps cold starts to ~1-3 s; warm requests are
tens of ms). OpenAI generation latency depends on model response time and
document size.

| Endpoint | Avg | p50 | p95 | Max |
| --- | ---: | ---: | ---: | ---: |
| `GET /api/health` | 5.38 ms | 4.22 ms | 11.37 ms | 16.91 ms |

## Repository Layout

```text
HandShook/
├── README.md
├── PUBLISHING.md          # Chrome Web Store + AWS deploy runbook
├── MVP.md
├── DESIGN.md
├── frontend/
│   ├── package.json
│   ├── public/manifest.json
│   └── src/
│       ├── popup/
│       ├── options/
│       ├── background/
│       ├── content/
│       └── shared/        # backendApi, localData, localDocuments, contracts
├── backend/
│   ├── pom.xml            # `lambda` profile builds the Lambda zip
│   ├── template.yaml      # SAM stack: API Gateway → Lambda (SnapStart)
│   ├── run.sh             # local dev server
│   ├── deploy.sh          # AWS deploy
│   └── src/main/java/com/handshook/backend/
└── landing/
    ├── index.html
    ├── privacy.html
    └── coming-soon.html
```

## Run Locally

### Backend

Requires Java 21 and Maven.

```bash
cd backend
cp .env.example .env
./run.sh
curl -s http://127.0.0.1:8765/api/health
```

AI document features require `OPENAI_API_KEY` in `backend/.env`. There is no
database to set up.

### Google authentication

Sign-in uses `chrome.identity.launchWebAuthFlow` with a Google OAuth client of
type **Web application** (Google retired the legacy extension `getAuthToken`
flow):

1. Keep the extension ID stable: `GOOGLE_EXTENSION_PUBLIC_KEY` in
   `frontend/.env` pins the unpacked ID to
   `eacnhbojhiplfeaddmnfmhihkabajodb` (dev builds only; the Web Store item
   already owns this ID for published builds).
2. In Google Cloud Console, create an OAuth client of type **Web application**
   with the redirect URI
   `https://eacnhbojhiplfeaddmnfmhihkabajodb.chromiumapp.org/`.
3. Put the client ID in `frontend/.env` (`GOOGLE_OAUTH_CLIENT_ID` and
   `VITE_GOOGLE_OAUTH_CLIENT_ID`) **and** `backend/.env`
   (`GOOGLE_OAUTH_CLIENT_ID`) — the backend checks the token audience.
4. Rebuild the extension and reload `frontend/dist/` in Chrome.

The extension requests only OpenID, email, and basic profile scopes. OAuth
access tokens are verified and discarded; the backend issues a signed,
self-contained session token instead.

### Chrome Extension

Requires Node.js.

```bash
cd frontend
npm install
npm run build
```

Then load `frontend/dist/` in Chrome via `chrome://extensions`, Developer mode,
Load unpacked.

## Deploy to AWS

```bash
cd backend
./deploy.sh    # builds the Lambda zip and deploys the SAM stack
```

Copy the printed `ApiUrl` into `frontend/.env` as `VITE_BACKEND_BASE_URL`,
then `npm run build` (dev) or `npm run package:store` (Chrome Web Store zip).
Full store instructions: [`PUBLISHING.md`](PUBLISHING.md).

## Verification

Recent local checks:

```bash
cd frontend && npm run typecheck && npm run build
cd backend && mvn test && mvn -Plambda clean package
```

## Resume Bullets

- Built HandShook, a Chrome MV3 extension that automates eligible
  Handshake one-click job applications using React, TypeScript, content scripts,
  and a stateless Spring Boot backend on AWS Lambda.
- Designed a local-first data architecture keeping all user data in browser
  extension storage, eliminating server-side persistence entirely while
  supporting multi-device Google sign-in.
- Added server-side AI document generation with OpenAI Chat Completions,
  client-side PDF text extraction, OpenPDF rendering, and browser-side PDF
  attachment workflows with per-user rate limiting.
