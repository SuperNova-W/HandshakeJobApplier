package com.handshook.backend.runs;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

@Service
public class RunsService {

    private final JdbcTemplate jdbcTemplate;

    public RunsService(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    public CreateRunResponse createRun(CreateRunRequest request) {
        String id = UUID.randomUUID().toString();
        String startedAt = request.startedAt() != null ? request.startedAt() : Instant.now().toString();

        jdbcTemplate.update(
            "INSERT INTO application_runs (id, started_at, status, source_url, applied_count, skipped_count, failed_count) VALUES (?, ?, 'RUNNING', ?, 0, 0, 0)",
            id, startedAt, request.sourceUrl()
        );

        return new CreateRunResponse(id, "RUNNING", startedAt);
    }

    public RunSummaryDto finalizeRun(String runId, FinalizeRunRequest request) {
        jdbcTemplate.update(
            """
            UPDATE application_runs
            SET status        = ?,
                ended_at      = ?,
                error_message = ?,
                applied_count  = (SELECT COUNT(*) FROM applications WHERE run_id = ? AND status = 'APPLIED'),
                skipped_count  = (SELECT COUNT(*) FROM applications WHERE run_id = ? AND status = 'SKIPPED'),
                failed_count   = (SELECT COUNT(*) FROM applications WHERE run_id = ? AND status = 'FAILED')
            WHERE id = ?
            """,
            request.status(), request.endedAt(), request.errorMessage(),
            runId, runId, runId,
            runId
        );
        return getRun(runId);
    }

    public RunSummaryDto getRun(String runId) {
        return jdbcTemplate.queryForObject(
            "SELECT id, started_at, ended_at, status, source_url, applied_count, skipped_count, failed_count, error_message FROM application_runs WHERE id = ?",
            (rs, rowNum) -> new RunSummaryDto(
                rs.getString("id"),
                rs.getString("started_at"),
                rs.getString("ended_at"),
                rs.getString("status"),
                rs.getString("source_url"),
                rs.getInt("applied_count"),
                rs.getInt("skipped_count"),
                rs.getInt("failed_count"),
                rs.getString("error_message")
            ),
            runId
        );
    }

    public List<RunSummaryDto> getRecentRuns(int limit) {
        return jdbcTemplate.query(
            "SELECT id, started_at, ended_at, status, source_url, applied_count, skipped_count, failed_count, error_message FROM application_runs ORDER BY started_at DESC LIMIT ?",
            (rs, rowNum) -> new RunSummaryDto(
                rs.getString("id"),
                rs.getString("started_at"),
                rs.getString("ended_at"),
                rs.getString("status"),
                rs.getString("source_url"),
                rs.getInt("applied_count"),
                rs.getInt("skipped_count"),
                rs.getInt("failed_count"),
                rs.getString("error_message")
            ),
            limit
        );
    }
}
