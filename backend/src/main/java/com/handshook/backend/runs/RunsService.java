package com.handshook.backend.runs;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

@Service
public class RunsService {

    private static final Logger log = LoggerFactory.getLogger(RunsService.class);

    private final JdbcTemplate jdbcTemplate;

    public RunsService(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    public CreateRunResponse createRun(CreateRunRequest request) {
        String id = UUID.randomUUID().toString();
        String startedAt = request.startedAt() != null ? request.startedAt() : Instant.now().toString();

        log.info("RUN_CREATE requested sourceUrl={} startedAt={} assignedRunId={}",
            request.sourceUrl(), startedAt, id);

        jdbcTemplate.update(
            "INSERT INTO application_runs (id, started_at, status, source_url, applied_count, skipped_count, failed_count) VALUES (?, ?, 'RUNNING', ?, 0, 0, 0)",
            id, startedAt, request.sourceUrl()
        );

        log.info("RUN_CREATE inserted runId={} status=RUNNING sourceUrl={}", id, request.sourceUrl());
        return new CreateRunResponse(id, "RUNNING", startedAt);
    }

    public void recordOutcome(String runId, RecordRunOutcomeRequest request) {
        String status = request.status() == null ? "" : request.status().trim().toUpperCase();
        String counterColumn = switch (status) {
            case "APPLIED" -> "applied_count";
            case "SKIPPED" -> "skipped_count";
            case "FAILED" -> "failed_count";
            default -> throw new IllegalArgumentException(
                "Unknown outcome status '" + request.status() + "'. Expected APPLIED, SKIPPED, or FAILED."
            );
        };

        int updated = jdbcTemplate.update(
            "UPDATE application_runs SET " + counterColumn + " = " + counterColumn + " + 1 WHERE id = ?",
            runId
        );
        if (updated == 0) {
            throw new IllegalArgumentException("No application run found with id " + runId + ".");
        }
        log.info("RUN_OUTCOME runId={} status={} incremented={}", runId, status, counterColumn);
    }

    public RunSummaryDto finalizeRun(String runId, FinalizeRunRequest request) {
        RunSummaryDto before = getRun(runId);
        log.info("RUN_FINALIZE requested runId={} currentStatus={} targetStatus={} endedAt={} error={}",
            runId, before.status(), request.status(), request.endedAt(), request.errorMessage());

        jdbcTemplate.update(
            """
            UPDATE application_runs
            SET status        = ?,
                ended_at      = ?,
                error_message = ?
            WHERE id = ?
            """,
            request.status(), request.endedAt(), request.errorMessage(),
            runId
        );
        RunSummaryDto after = getRun(runId);
        log.info("RUN_FINALIZE complete runId={} status={} applied={} skipped={} failed={} error={}",
            after.runId(), after.status(), after.appliedCount(), after.skippedCount(),
            after.failedCount(), after.errorMessage());
        return after;
    }

    public RunSummaryDto getRun(String runId) {
        RunSummaryDto run = jdbcTemplate.queryForObject(
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
        log.debug("RUN_GET runId={} status={} applied={} skipped={} failed={} sourceUrl={}",
            run.runId(), run.status(), run.appliedCount(), run.skippedCount(),
            run.failedCount(), run.sourceUrl());
        return run;
    }

    public List<RunSummaryDto> getRecentRuns(int limit) {
        List<RunSummaryDto> runs = jdbcTemplate.query(
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
        log.debug("RUN_RECENT limit={} returned={} top={}", limit, runs.size(),
            runs.isEmpty() ? null : runs.get(0));
        return runs;
    }
}
