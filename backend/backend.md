# HandShook Backend

A stateless Java 21 / Spring Boot 3.4 API. It runs locally for development
(`./run.sh`, `http://127.0.0.1:8765`) and on AWS Lambda behind API Gateway in
production (`./deploy.sh`). **It stores no user data and has no database** —
the extension keeps profile, screening preferences, run history, and all
documents in `chrome.storage.local`.

## What it does

| Endpoint | Purpose |
| --- | --- |
| `GET /api/health` | Service status + version |
| `POST /api/users/google` | Verify a Google access token (audience must match `GOOGLE_OAUTH_CLIENT_ID`), return the profile + a signed HandShook session token |
| `POST /api/cover-letter` | Generate a tailored cover letter (resume text + job context arrive in the request) |
| `POST /api/cover-letter/pdf` | Render reviewed letter text to a PDF |
| `POST /api/other-docs/generate` | Draft an employer-requested document grounded in the request's `sources` |
| `POST /api/other-docs/pdf` | Render reviewed document text to a PDF |

Everything except `/api/health` and `/api/users/google` requires the session
token (HMAC-signed JWT, subject = Google subject; see `auth/`). The
OpenAI-backed endpoints are additionally rate limited per user
(`AI_HOURLY_LIMIT`, default 30/hour, counted in-process — see
`config/AiRateLimitInterceptor`).

## Environment

Copy `.env.example` to `.env` and configure:

```text
GOOGLE_OAUTH_CLIENT_ID   # must match frontend/.env (token audience check)
AUTH_TOKEN_SECRET        # 32+ random chars; REQUIRED for Lambda deploys
OPENAI_API_KEY           # AI document generation
```

Optional: `ALLOWED_EXTENSION_ORIGIN` (CORS pin, defaults to
`chrome-extension://*`), `AI_HOURLY_LIMIT`.

## Local run

```bash
./run.sh --build
curl http://127.0.0.1:8765/api/health
```

## Test and package

```bash
mvn test                    # JAVA_HOME=/opt/homebrew/opt/openjdk@21
mvn -Plambda clean package  # → target/backend-0.1.0-lambda.zip
```

The Lambda zip contains compiled classes plus `lib/*.jar` with Tomcat excluded
— the AWS Serverless Java Container supplies the servlet runtime inside
Lambda. There is no handler class in this repo: `template.yaml` uses the
library's `SpringDelegatingLambdaContainerHandler` with `MAIN_CLASS` pointing
at `HandShookBackendApplication`.

## Deploy

```bash
./deploy.sh
```

The script builds the Lambda zip and deploys the `handshook-backend` SAM stack:
API Gateway REST API (throttled 10 rps / burst 25) → Lambda `java21` with
SnapStart. Copy the printed `ApiUrl` output into `frontend/.env` as
`VITE_BACKEND_BASE_URL`, rebuild the extension, and reload it in Chrome.

API Gateway caps synchronous requests at 29 seconds; AI generations normally
finish well under that. See `../PUBLISHING.md` for the full store-publishing
runbook.
