# HandShook

Auto-apply to eligible native Handshake **one-click jobs** straight from your
logged-in browser session. HandShook is **local-first**: it drives the page from
a Chrome extension and keeps all of your data (settings, run history, documents,
job outcomes) in a SQLite database on your own machine. It never stores your
Handshake password.

🔗 Landing page: https://handshook.netlify.app/

---

## How it works

HandShook is split into two cooperating parts that run entirely on your machine:

1. **Chrome extension (Manifest V3)** — a React popup, a background service
   worker that owns run state, and a content script that detects supported
   Handshake pages and performs the in-browser apply automation. Because it runs
   inside your existing logged-in tab, no credentials are ever handled.
2. **Local Spring Boot companion API** — a localhost-only service on
   `127.0.0.1:8765` that persists settings, run history, application outcomes,
   uploaded documents, and screening preferences to SQLite. It also hosts the
   OpenAI-backed document features so your API key and files never reach the
   browser.

You start a run manually from the popup; it does not auto-run on page load.

---

## Tech stack

### Chrome extension (`frontend/`)
- **React 19** + **TypeScript 5**
- **Vite 6** (multi-entry build: popup, background worker, content script)
- **Chrome Extension Manifest V3** APIs (`@types/chrome`)
- **lucide-react** for icons
- CSS design tokens (`src/shared/design-tokens.css`)

### Companion backend (`backend/`)
- **Java 21** + **Spring Boot 3.4** (Maven build)
- `spring-boot-starter-web`, `-jdbc`, `-validation`, `-actuator`
- **SQLite** via `sqlite-jdbc` (single-file DB at `backend/data/handshook.db`)
- **OpenAI Chat Completions** (`gpt-4o`) called via Spring `RestClient` — no
  vendor SDK
- **Apache PDFBox** — extract text from uploaded PDFs (resume, transcript, etc.)
- **OpenPDF** — render generated documents back into attachable PDFs

### Landing page (`landing/`)
- Static HTML/CSS (`index.html`, `coming-soon.html`), deployed to Netlify
- Visual language documented in `DESIGN.md` (a Mastercard-inspired design system)

---

## Repository layout

```text
HandShook/
├── readme.md                 # this file
├── MVP.md                    # approved MVP product + technical spec
├── DESIGN.md                 # Mastercard-inspired design system spec
├── handshook-extension.zip   # packaged extension build
│
├── frontend/                 # Chrome extension (Vite + React + TS)
│   ├── package.json
│   ├── vite.config.ts            # popup + background build
│   ├── vite.content.config.ts    # content-script build
│   ├── popup.html / options.html
│   ├── public/
│   │   ├── manifest.json         # Manifest V3 definition
│   │   └── icons/
│   └── src/
│       ├── popup/                # React popup UI (App.tsx, styles)
│       ├── options/              # options page (settings, documents)
│       ├── background/index.ts   # service worker — owns run state
│       ├── content/index.ts      # content script — page detection + apply loop
│       └── shared/               # backendApi, contracts, constants, handshake helpers
│
├── backend/                  # Spring Boot companion API (Java 21 + Maven)
│   ├── pom.xml
│   ├── run.sh                    # loads .env (OPENAI_API_KEY) and runs the jar
│   ├── data/                     # SQLite database lives here
│   ├── logs/                     # rolling backend logs
│   └── src/main/
│       ├── java/com/handshook/backend/
│       │   ├── HandShookBackendApplication.java
│       │   ├── config/           # CORS, request logging, global exception handler
│       │   ├── health/           # GET /api/health (+ DB connectivity check)
│       │   ├── settings/         # run settings (delay, max pages, stop-on-error)
│       │   ├── runs/             # application run lifecycle + history
│       │   ├── applications/     # per-job outcomes + duplicate preflight
│       │   ├── documents/        # uploaded resume/cover letter/transcript/etc.
│       │   ├── content/          # resume text + screening preferences
│       │   ├── coverletter/      # OpenAI cover-letter generation + PDF render
│       │   ├── otherdocs/        # RAG agent for "other required documents"
│       │   ├── database/         # datasource status service
│       │   └── debug/            # client log sink for the extension
│       └── resources/
│           ├── application.properties
│           └── schema.sql        # idempotent SQLite schema (runs on startup)
│
├── landing/                  # static marketing site (Netlify)
└── mastercard/DESIGN.md      # design system reference
```

---

## Backend API surface

All routes are served from `http://127.0.0.1:8765` and CORS-restricted to the
extension origin.

| Method | Path | Purpose |
| ------ | ---- | ------- |
| `GET` | `/api/health` | Status, version, live SQLite connectivity |
| `GET` / `PUT` | `/api/settings` | Read/update run settings (apply delay, max pages, stop-on-error) |
| `POST` | `/api/runs` | Create a run; `PATCH /api/runs/{runId}` to finalize; `GET` for history |
| `POST` | `/api/runs/{runId}/applications` | Record a per-job outcome (applied/skipped/failed) |
| `GET` | `/api/applications/exists` | Duplicate preflight before applying |
| `POST` / `GET` / `DELETE` | `/api/documents` | Upload (multipart), fetch content, delete documents |
| `GET` / `PUT` | `/api/content/resume`, `/api/content/screening` | Resume text + screening prefs (work auth, relocation) |
| `POST` | `/api/cover-letter`, `/api/cover-letter/pdf` | Generate a cover letter (OpenAI) and render it to PDF |
| `POST` | `/api/other-docs/generate`, `/api/other-docs/pdf` | RAG-drafted "other required document" + PDF |
| `POST` | `/api/debug/client-log` | Sink for extension-side logs |

### Data model (SQLite)
`settings` · `user_content` · `screening_prefs` · `documents` ·
`application_runs` · `applications`. A unique partial index on
`applications(handshake_job_id) WHERE status = 'APPLIED'` enforces no duplicate
applications across runs. The schema is created idempotently on every startup.

---

## Getting started

### 1. Run the backend
Requires **Java 21** and **Maven**.

```bash
cd backend
cp .env.example .env        # add your OPENAI_API_KEY (optional — only AI docs need it)
./run.sh                    # builds if needed, then starts on 127.0.0.1:8765
# or: ./run.sh --build      # force a clean rebuild first
```

Verify: open http://127.0.0.1:8765/api/health — expect `status: UP`,
`database: CONNECTED`. AI document features are disabled (with an actionable
error) if `OPENAI_API_KEY` is unset; everything else still works.

### 2. Build & load the extension
Requires **Node.js**.

```bash
cd frontend
npm install
npm run build               # outputs to frontend/dist/
# watch mode: npx vite build --watch
```

Then in Chrome → `chrome://extensions` → enable **Developer mode** →
**Load unpacked** → select `frontend/dist/`. (A prebuilt
`handshook-extension.zip` is also included.)

### 3. Use it
1. Start the backend (step 1).
2. Open Handshake and log in as usual.
3. Open the HandShook popup, confirm the backend is online and the page is
   supported, then click **Start**.

---

## Privacy & design principles

- **No credentials stored.** Automation runs inside your own logged-in session.
- **Local-first.** The backend binds only to `127.0.0.1`; all data stays in
  local SQLite.
- **AI stays server-side.** Your OpenAI key and uploaded files never reach the
  browser.
- **One-click only.** HandShook applies only to eligible native Handshake
  one-click jobs and skips unsupported or risky application flows.

See `MVP.md` for the full product specification and `DESIGN.md` for the design
system.
