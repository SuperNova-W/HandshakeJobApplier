#!/usr/bin/env bash
# Launches the HandShook backend with local configuration loaded from .env.
#
# This script sources .env and exports its variables before starting the jar.
#
# Usage:
#   ./run.sh            # build if needed, then run
#   ./run.sh --build    # force a clean rebuild first
set -euo pipefail

cd "$(dirname "$0")"

# Java 21 (Homebrew openjdk@21 is keg-only, so set JAVA_HOME explicitly).
export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@21}"
export PATH="$JAVA_HOME/bin:/opt/homebrew/bin:$PATH"

# Load .env if present (export every var defined in it).
if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
else
  echo "⚠️  No .env file found. Copy .env.example to .env and configure Google auth." >&2
fi

if [[ -z "${GOOGLE_OAUTH_CLIENT_ID:-}" ]]; then
  echo "⚠️  GOOGLE_OAUTH_CLIENT_ID is empty — Google sign-in will be disabled." >&2
  echo "    Add the same Chrome Extension OAuth client ID to backend/.env and frontend/.env.local." >&2
fi

if [[ -z "${AUTH_TOKEN_SECRET:-}" ]]; then
  echo "⚠️  AUTH_TOKEN_SECRET is empty — local sessions will reset on every restart." >&2
fi

if [[ -z "${OPENAI_API_KEY:-}" ]]; then
  echo "⚠️  OPENAI_API_KEY is empty — cover-letter generation will be disabled." >&2
  echo "    Add it to backend/.env and re-run. (The rest of the backend still works.)" >&2
fi

JAR="target/backend-0.1.0.jar"
if [[ "${1:-}" == "--build" || ! -f "$JAR" ]]; then
  echo "Building backend…"
  mvn clean package
fi

echo "Starting backend on http://127.0.0.1:8765 …"
exec java -jar "$JAR"
