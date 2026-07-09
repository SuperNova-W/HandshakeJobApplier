#!/usr/bin/env bash
# Builds the Lambda jar and deploys the HandShook backend with AWS SAM.
#
# One-time prerequisites:
#   brew install aws-sam-cli
#   aws configure        # or: aws login
#
# Usage:
#   ./deploy.sh
#
# Afterwards, copy the ApiUrl stack output into frontend/.env as
# VITE_BACKEND_BASE_URL and rebuild the extension (npm run build).
set -euo pipefail

cd "$(dirname "$0")"

export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@21}"
export PATH="$JAVA_HOME/bin:/opt/homebrew/bin:$PATH"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

: "${GOOGLE_OAUTH_CLIENT_ID:?Set GOOGLE_OAUTH_CLIENT_ID in backend/.env}"
: "${OPENAI_API_KEY:?Set OPENAI_API_KEY in backend/.env}"
# Random per-process secrets don't work in Lambda: containers must share the
# signing key or they reject each other's session tokens.
: "${AUTH_TOKEN_SECRET:?Set AUTH_TOKEN_SECRET in backend/.env (generate one: openssl rand -base64 48)}"

echo "Building Lambda jar (lambda profile)…"
mvn -q -Plambda clean package

echo "Deploying stack handshook-backend…"
sam deploy \
  --template-file template.yaml \
  --stack-name handshook-backend \
  --resolve-s3 \
  --capabilities CAPABILITY_IAM \
  --no-confirm-changeset \
  --no-fail-on-empty-changeset \
  --parameter-overrides \
    GoogleOauthClientId="$GOOGLE_OAUTH_CLIENT_ID" \
    AuthTokenSecret="$AUTH_TOKEN_SECRET" \
    OpenAiApiKey="$OPENAI_API_KEY" \
    AllowedExtensionOrigin="${ALLOWED_EXTENSION_ORIGIN:-chrome-extension://eacnhbojhiplfeaddmnfmhihkabajodb}" \
    AiHourlyLimit="${AI_HOURLY_LIMIT:-30}"

echo
echo "✅ Deployed. Next steps:"
echo "   1. Copy the ApiUrl output above into frontend/.env as VITE_BACKEND_BASE_URL."
echo "   2. cd ../frontend && npm run build   (bakes the URL + host permission into the bundle)"
echo "   3. Reload the extension (or repackage the store zip)."
