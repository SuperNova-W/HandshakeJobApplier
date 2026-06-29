# HandShook Backend

The backend is a Java 21/Spring Boot API that runs locally for development and
on AWS Lambda behind API Gateway in production.

## Production architecture

- AWS Lambda (`java21`, ARM64) runs the Spring application through AWS
  Serverless Java Container.
- API Gateway REST API exposes `/api/**` and supports multipart/PDF binary data.
- MongoDB Atlas stores users, screening preferences, uploaded documents, and
  aggregate application-run history.
- Google access tokens are accepted only by `POST /api/users/google`. The
  backend validates the token audience, upserts the profile, and returns a
  signed HandShook session token.
- Every other non-health endpoint requires that HandShook session token and
  scopes MongoDB reads/writes to its user ID.

MongoDB collections:

- `users`
- `screening_preferences`
- `user_content`
- `documents`
- `application_runs`

OAuth tokens and per-job application history are never stored.

## Environment

Copy `.env.example` to `.env` and configure:

```text
MONGODB_URI
MONGODB_DATABASE
GOOGLE_OAUTH_CLIENT_ID
AUTH_TOKEN_SECRET
OPENAI_API_KEY
```

For Atlas/Lambda without private networking, Atlas requires an IP access-list
entry that permits Lambda's changing outbound addresses. The simple M0 setup
uses `0.0.0.0/0` with a strong database password. A production paid cluster
should use private networking or a NAT gateway with a fixed IP.

## Local run

```bash
./run.sh --build
curl http://127.0.0.1:8765/api/health
```

## Test and package

```bash
mvn test
mvn -Plambda clean package
```

The Lambda artifact is `target/handshook-lambda.zip`.

## Deploy

```bash
./deploy.sh
```

The script builds the Lambda ZIP, packages it through S3, deploys the
CloudFormation stack, and prints the API Gateway URL. Set that URL as
`VITE_BACKEND_BASE_URL` in `frontend/.env`, rebuild the extension, and reload it
in Chrome. If `AUTH_TOKEN_SECRET` is not in `.env`, the script creates a stable,
Git-ignored `backend/.auth-token-secret` automatically.

## Migrate the existing SQLite data

The legacy file stays untouched at `data/handshook.db`. After `MONGODB_URI` is
configured:

```bash
set -a
source .env
set +a
mvn -Pmigrate-sqlite exec:java \
  -Dexec.mainClass=com.handshook.backend.migration.SqliteToMongoMigration
```

The migration is idempotent and assigns the original single-user documents and
run history to the active local Google user.

## Upload limit

Lambda synchronous request and response payloads are limited to 6 MB. Because
API Gateway base64-encodes binary proxy events, document uploads are capped at
4 MB. Larger-file support should use direct S3 uploads rather than increasing
this setting.
