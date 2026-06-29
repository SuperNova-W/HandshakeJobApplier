package com.handshook.backend.runs;

import com.handshook.backend.auth.CurrentUser;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Service;

@Service
public class RunsService {

    private static final Logger log = LoggerFactory.getLogger(RunsService.class);

    private static final RowMapper<ApplicationRunRecord> ROW_MAPPER = (rs, rowNum) ->
        new ApplicationRunRecord(
            rs.getString("id"),
            rs.getString("user_id"),
            rs.getString("started_at"),
            rs.getString("ended_at"),
            rs.getString("status"),
            rs.getString("source_url"),
            rs.getInt("applied_count"),
            rs.getInt("skipped_count"),
            rs.getInt("failed_count"),
            rs.getString("error_message")
        );

    private final JdbcTemplate jdbcTemplate;
    private final CurrentUser currentUser;

    public RunsService(JdbcTemplate jdbcTemplate, CurrentUser currentUser) {
        this.jdbcTemplate = jdbcTemplate;
        this.currentUser = currentUser;
    }

    public CreateRunResponse createRun(CreateRunRequest request) {
        String userId = currentUser.requireUserId();
        String id = UUID.randomUUID().toString();
        String startedAt = request.startedAt() != null
            ? request.startedAt()
            : Instant.now().toString();

        jdbcTemplate.update(
            """
            INSERT INTO application_runs (
                id, user_id, started_at, ended_at, status, source_url,
                applied_count, skipped_count, failed_count, error_message
            ) VALUES (?, ?, ?, NULL, 'RUNNING', ?, 0, 0, 0, NULL)
            """,
            id,
            userId,
            startedAt,
            request.sourceUrl()
        );
        log.info("RUN_CREATE userId={} runId={} sourceUrl={}", userId, id, request.sourceUrl());
        return new CreateRunResponse(id, "RUNNING", startedAt);
    }

    public void recordOutcome(String runId, RecordRunOutcomeRequest request) {
        String userId = currentUser.requireUserId();
        String status = request.status() == null ? "" : request.status().trim().toUpperCase();
        String counterColumn = switch (status) {
            case "APPLIED" -> "applied_count";
            case "SKIPPED" -> "skipped_count";
            case "FAILED" -> "failed_count";
            default -> throw new IllegalArgumentException(
                "Unknown outcome status '" + request.status()
                    + "'. Expected APPLIED, SKIPPED, or FAILED."
            );
        };

        int updated = jdbcTemplate.update(
            "UPDATE application_runs SET " + counterColumn + " = " + counterColumn
                + " + 1 WHERE id = ? AND user_id = ?",
            runId,
            userId
        );
        if (updated == 0) {
            throw new IllegalArgumentException("No application run found with id " + runId + ".");
        }
        log.info("RUN_OUTCOME userId={} runId={} status={}", userId, runId, status);
    }

    public RunSummaryDto finalizeRun(String runId, FinalizeRunRequest request) {
        String userId = currentUser.requireUserId();
        requireRun(runId, userId);

        jdbcTemplate.update(
            """
            UPDATE application_runs
            SET status = ?, ended_at = ?, error_message = ?
            WHERE id = ? AND user_id = ?
            """,
            request.status(),
            request.endedAt(),
            request.errorMessage(),
            runId,
            userId
        );
        return requireRun(runId, userId).toDto();
    }

    public RunSummaryDto getRun(String runId) {
        return requireRun(runId, currentUser.requireUserId()).toDto();
    }

    public List<RunSummaryDto> getRecentRuns(int limit) {
        String userId = currentUser.requireUserId();
        return jdbcTemplate.query(
            "SELECT * FROM application_runs WHERE user_id = ? "
                + "ORDER BY started_at DESC LIMIT ?",
            ROW_MAPPER,
            userId,
            Math.max(0, limit)
        ).stream().map(ApplicationRunRecord::toDto).toList();
    }

    private ApplicationRunRecord requireRun(String runId, String userId) {
        Optional<ApplicationRunRecord> run = jdbcTemplate.query(
            "SELECT * FROM application_runs WHERE id = ? AND user_id = ?",
            ROW_MAPPER,
            runId,
            userId
        ).stream().findFirst();
        return run.orElseThrow(() ->
            new IllegalArgumentException("No application run found with id " + runId + ".")
        );
    }
}
