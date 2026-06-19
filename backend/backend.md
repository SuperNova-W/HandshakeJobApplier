# Backend Implementation Notes

This is the living implementation document for the local Spring Boot companion backend.

## Current Status

- Status: backend scaffold created
- Framework: Spring Boot
- Java version target: 21
- Build tool: Maven
- Current scope: app bootstrap, localhost binding, extension CORS config, SQLite datasource config, schema initialization skeleton, DB-backed health endpoint
- Per-job application persistence is intentionally omitted; only aggregate run counters are stored

## Directory Structure

```text
backend/
├── pom.xml
├── backend.md
├── data/
│   └── .gitkeep
└── src/
    ├── main/
    │   ├── java/com/handshook/backend/
    │   │   ├── HandShookBackendApplication.java
    │   │   ├── config/
    │   │   │   └── WebCorsConfig.java
    │   │   ├── database/
    │   │   │   └── DatabaseStatusService.java
    │   │   └── health/
    │   │       ├── HealthController.java
    │   │       └── HealthResponse.java
    │   └── resources/
    │       ├── application.properties
    │       └── db/migration/
    │           └── V1__create_initial_schema.sql
    └── test/
        └── java/com/handshook/backend/
            └── HandShookBackendApplicationTests.java
```

## What Exists Now

### `pom.xml`
- Spring Boot parent project
- Includes:
  - `spring-boot-starter-web`
  - `spring-boot-starter-jdbc`
  - `spring-boot-starter-validation`
  - `spring-boot-starter-actuator`
  - `sqlite-jdbc`
  - `spring-boot-starter-test`

### `HandShookBackendApplication.java`
- Main Spring Boot application entrypoint

### `WebCorsConfig.java`
- Allows extension-origin requests to `/api/**`
- Uses `chrome-extension://*` pattern for the Chrome extension

### `HealthController.java`
- Exposes `GET /api/health`
- Current response:
  - `status`
  - `version`
  - `database`

### `DatabaseStatusService.java`
- Uses the configured datasource to run `SELECT 1`
- Returns a simple DB health string for the custom health endpoint

### `application.properties`
- Binds the backend to:
  - `127.0.0.1`
  - port `8765`
- Configures SQLite datasource at `./data/handshook.db`
- Runs Spring SQL schema initialization from `classpath:schema.sql` on every startup (`spring.sql.init.mode=always`)

### `schema.sql`
- Creates the initial SQLite tables (idempotent, `CREATE TABLE IF NOT EXISTS`):
  - `settings`
  - `application_runs`
- Inserts the default `settings` row via `INSERT OR IGNORE` (safe to re-run on every startup)
- Removes the legacy per-job `applications` table; Handshake is the source of
  truth for submitted jobs.
- Adds the run-history lookup index.

### Test Skeleton
- Spring context smoke test only

## Current API Surface

### `GET /api/health`

Current placeholder response shape:

```json
{
  "status": "UP",
  "version": "0.1.0",
  "database": "CONNECTED"
}
```

The `database` field now reflects a live SQLite connectivity check. If the datasource is unavailable, it should return `UNAVAILABLE`.

### AI document endpoints (OpenAI-backed)

Two OpenAI-backed features generate application documents server-side, so the API
key and the user's stored files never reach the browser. Both require
`OPENAI_API_KEY` in the backend environment (loaded from `backend/.env` by
`run.sh`); when it's unset the endpoints return an actionable error and the
extension skips the job rather than failing silently.

#### Cover letter — `coverletter` package

- `POST /api/cover-letter` → `{ jobTitle, company, jobDescription }` ⇒
  `{ coverLetter, model, generatedAt }`. Combines the stored `RESUME` with the
  scraped job description and calls Chat Completions (`gpt-4o`).
- `POST /api/cover-letter/pdf` → `{ coverLetter, company, jobTitle }` ⇒ PDF bytes
  (OpenPDF render of the already-reviewed text; no OpenAI call).

#### Other required documents agent — `otherdocs` package

A retrieval-augmented (RAG) agent that drafts the *extra* document an employer
asks for ("other required documents") when the bot can't auto-fill it.

- `POST /api/other-docs/generate` → `{ jobTitle, company, jobDescription, instructions }`
  ⇒ `{ document, model, generatedAt, sources }`.
  - **Retrieval** (`UserDocsContext`): gathers the user's stored materials as
    grounding context — latest `RESUME`, `GITHUB_PROJECT`, `TRANSCRIPT`, and every
    `OTHER` upload (falling back to the pasted resume text). Each source is
    text-extracted (`DocumentTextExtractor`: PDF via PDFBox, or text/markdown) and
    capped at 6k chars.
  - **Generation** (`OtherDocsAgentService`): calls Chat Completions (`gpt-4o`)
    with the gathered sources + job description + the employer's `instructions`,
    instructed to write as the candidate and invent nothing.
  - `sources` echoes which stored documents the draft drew on (by label).
- `POST /api/other-docs/pdf` → `{ document, company, jobTitle }` ⇒ PDF bytes.
  Reuses the cover-letter `CoverLetterPdfRenderer` (it just lays out final text).

`DocumentsService` gained `getAllByType(docType)` (all matches, newest first, with
label) to feed the multi-document `OTHER` slot into the agent. `DocumentTextExtractor`
is a shared bean so the extraction logic lives in one place.

## Current API Surface

- `GET /api/health`
- `GET /api/settings`
- `POST /api/runs`
- `POST /api/runs/{runId}/outcomes`
- `PATCH /api/runs/{runId}`
- `GET /api/runs`
- `GET /api/content/screening`
- `PUT /api/content/screening`
- `GET /api/documents`
- `POST /api/documents`
- `GET /api/documents/{id}/content`
- `GET /api/documents/by-type/{docType}/content`
- `DELETE /api/documents/{id}`
- `POST /api/cover-letter`
- `POST /api/cover-letter/pdf`
- `POST /api/other-docs/generate`
- `POST /api/other-docs/pdf`

### SQLite user profile endpoints

Google onboarding now persists the verified account profile in SQLite:

- `POST /api/users/google` with the Google access token in the `Authorization:
  Bearer ...` header verifies the token with Google's user-info endpoint, upserts
  the account, and makes it the active local user.
- `GET /api/users/current` returns the active user, or `404` before sign-in.
- `PUT /api/users/current/onboarding` records onboarding completion.

The `users` table stores the Google subject, email, display name, picture URL,
authentication time, and onboarding-completion time. `current_user` identifies
the active account. OAuth access and refresh tokens are never stored, and
`/api/users/**` request/response bodies are redacted from backend logs.

## Local Run Notes

The project is scaffolded as a Maven-based Spring Boot app, but this machine currently does not have `mvn` installed.

To run it once Maven is installed:

```bash
cd /Users/yashponnaganti/Documents/dev/handshakeProject/backend
mvn spring-boot:run
```

Expected local address:

```text
http://127.0.0.1:8765/api/health
```

## Design Rules

- Bind only to `127.0.0.1`
- Do not store Handshake credentials
- Keep API contracts aligned with `MVP.md`
- Treat this backend as a local companion API only
