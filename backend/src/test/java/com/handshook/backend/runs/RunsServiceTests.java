package com.handshook.backend.runs;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.SingleConnectionDataSource;
import org.springframework.jdbc.datasource.init.ScriptUtils;

class RunsServiceTests {

    private SingleConnectionDataSource dataSource;
    private JdbcTemplate jdbcTemplate;
    private RunsService service;

    @BeforeEach
    void setUp() throws Exception {
        dataSource = new SingleConnectionDataSource("jdbc:sqlite::memory:", true);
        jdbcTemplate = new JdbcTemplate(dataSource);
        ScriptUtils.executeSqlScript(dataSource.getConnection(), new ClassPathResource("schema.sql"));
        service = new RunsService(jdbcTemplate);
    }

    @AfterEach
    void tearDown() {
        dataSource.destroy();
    }

    @Test
    void recordsOnlyAggregateOutcomeCounts() {
        String runId = service.createRun(
            new CreateRunRequest("https://app.joinhandshake.com/stu/postings", "2026-06-19T00:00:00Z")
        ).runId();

        service.recordOutcome(runId, new RecordRunOutcomeRequest("APPLIED"));
        service.recordOutcome(runId, new RecordRunOutcomeRequest("SKIPPED"));
        service.recordOutcome(runId, new RecordRunOutcomeRequest("FAILED"));

        RunSummaryDto run = service.getRun(runId);
        assertThat(run.appliedCount()).isEqualTo(1);
        assertThat(run.skippedCount()).isEqualTo(1);
        assertThat(run.failedCount()).isEqualTo(1);

        Integer applicationTableCount = jdbcTemplate.queryForObject(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'applications'",
            Integer.class
        );
        assertThat(applicationTableCount).isZero();
    }

    @Test
    void finalizingRunPreservesAggregateCounts() {
        String runId = service.createRun(
            new CreateRunRequest("https://app.joinhandshake.com/stu/postings", "2026-06-19T00:00:00Z")
        ).runId();
        service.recordOutcome(runId, new RecordRunOutcomeRequest("APPLIED"));

        RunSummaryDto finalized = service.finalizeRun(
            runId,
            new FinalizeRunRequest("COMPLETED", "2026-06-19T00:01:00Z", null)
        );

        assertThat(finalized.status()).isEqualTo("COMPLETED");
        assertThat(finalized.appliedCount()).isEqualTo(1);
    }

    @Test
    void rejectsUnknownOutcomeStatus() {
        String runId = service.createRun(
            new CreateRunRequest("https://app.joinhandshake.com/stu/postings", "2026-06-19T00:00:00Z")
        ).runId();

        assertThatThrownBy(() -> service.recordOutcome(runId, new RecordRunOutcomeRequest("UNKNOWN")))
            .isInstanceOf(IllegalArgumentException.class);
    }
}
