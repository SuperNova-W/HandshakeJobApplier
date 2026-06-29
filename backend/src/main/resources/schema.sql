-- HandShook local SQLite schema. Created automatically on startup
-- (spring.sql.init.mode=always). Every statement is idempotent.
--
-- The model is multi-user: rows are scoped by the authenticated user's id, and
-- ownership is enforced in the service layer via WHERE clauses. OAuth access
-- tokens are deliberately never stored. Uploaded documents and resume text are
-- kept in the browser's local store, not here.

-- Write-Ahead Logging improves read/write concurrency; it persists on the file.
PRAGMA journal_mode=WAL;

-- Google profiles that have signed in to this companion backend.
CREATE TABLE IF NOT EXISTS users (
    id                      TEXT PRIMARY KEY,
    google_subject          TEXT NOT NULL UNIQUE,
    email                   TEXT NOT NULL,
    display_name            TEXT,
    picture_url             TEXT,
    authenticated_at        TEXT,
    onboarding_completed_at TEXT,
    created_at              TEXT,
    updated_at              TEXT
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- Per-user answers to common Handshake screening questions. relocate_anywhere
-- short-circuits any location question to "Yes"; locations is a JSON array of
-- place strings matched against the question text.
CREATE TABLE IF NOT EXISTS screening_preferences (
    user_id                     TEXT PRIMARY KEY,
    us_work_authorized          INTEGER NOT NULL DEFAULT 1,
    software_engineering_degree INTEGER NOT NULL DEFAULT 1,
    speaks_english              INTEGER NOT NULL DEFAULT 1,
    relocate_anywhere           INTEGER NOT NULL DEFAULT 0,
    locations                   TEXT,
    updated_at                  TEXT,
    CHECK (us_work_authorized IN (0, 1)),
    CHECK (software_engineering_degree IN (0, 1)),
    CHECK (speaks_english IN (0, 1)),
    CHECK (relocate_anywhere IN (0, 1))
);

-- Aggregate per-run application history (no per-job rows are retained).
CREATE TABLE IF NOT EXISTS application_runs (
    id            TEXT PRIMARY KEY,
    user_id       TEXT NOT NULL,
    started_at    TEXT,
    ended_at      TEXT,
    status        TEXT NOT NULL,
    source_url    TEXT,
    applied_count INTEGER NOT NULL DEFAULT 0,
    skipped_count INTEGER NOT NULL DEFAULT 0,
    failed_count  INTEGER NOT NULL DEFAULT 0,
    error_message TEXT,
    CHECK (status IN ('RUNNING', 'COMPLETED', 'STOPPED', 'FAILED'))
);

CREATE INDEX IF NOT EXISTS idx_application_runs_user_started
    ON application_runs(user_id, started_at DESC);
