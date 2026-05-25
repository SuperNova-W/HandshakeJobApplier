CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY,
    apply_delay_ms INTEGER NOT NULL,
    max_pages_per_run INTEGER NOT NULL,
    stop_on_error INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CHECK (id = 1),
    CHECK (apply_delay_ms >= 1000),
    CHECK (max_pages_per_run >= 1),
    CHECK (stop_on_error IN (0, 1))
);

INSERT INTO settings (
    id,
    apply_delay_ms,
    max_pages_per_run,
    stop_on_error,
    created_at,
    updated_at
)
VALUES (
    1,
    1500,
    10,
    0,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS application_runs (
    id TEXT PRIMARY KEY,
    started_at TEXT NOT NULL,
    ended_at TEXT NULL,
    status TEXT NOT NULL,
    source_url TEXT NOT NULL,
    applied_count INTEGER NOT NULL DEFAULT 0,
    skipped_count INTEGER NOT NULL DEFAULT 0,
    failed_count INTEGER NOT NULL DEFAULT 0,
    error_message TEXT NULL,
    CHECK (status IN ('RUNNING', 'COMPLETED', 'STOPPED', 'FAILED'))
);

CREATE TABLE IF NOT EXISTS applications (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    handshake_job_id TEXT NOT NULL,
    job_url TEXT NOT NULL,
    title TEXT NOT NULL,
    company TEXT NOT NULL,
    status TEXT NOT NULL,
    skip_reason TEXT NULL,
    applied_at TEXT NOT NULL,
    error_message TEXT NULL,
    raw_job_snapshot_json TEXT NULL,
    FOREIGN KEY (run_id) REFERENCES application_runs(id) ON DELETE CASCADE,
    CHECK (status IN ('APPLIED', 'SKIPPED', 'FAILED')),
    CHECK (
        (status = 'SKIPPED' AND skip_reason IS NOT NULL)
        OR (status <> 'SKIPPED' AND skip_reason IS NULL)
    ),
    CHECK (
        (status = 'FAILED' AND error_message IS NOT NULL)
        OR (status <> 'FAILED' AND error_message IS NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_application_runs_started_at
    ON application_runs(started_at DESC);

CREATE INDEX IF NOT EXISTS idx_applications_run_id
    ON applications(run_id);

CREATE INDEX IF NOT EXISTS idx_applications_handshake_job_id
    ON applications(handshake_job_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_applications_unique_applied_job
    ON applications(handshake_job_id)
    WHERE status = 'APPLIED';
