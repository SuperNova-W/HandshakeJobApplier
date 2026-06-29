package com.handshook.backend.runs;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.handshook.backend.auth.CurrentUser;
import java.nio.file.Path;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.jdbc.datasource.init.ResourceDatabasePopulator;

class RunsServiceTests {

    @TempDir
    Path tempDir;

    private JdbcTemplate jdbcTemplate;
    private RunsService service;

    @BeforeEach
    void setUp() {
        DriverManagerDataSource dataSource = new DriverManagerDataSource(
            "jdbc:sqlite:" + tempDir.resolve("handshook-test.db")
        );
        dataSource.setDriverClassName("org.sqlite.JDBC");
        new ResourceDatabasePopulator(new ClassPathResource("schema.sql")).execute(dataSource);

        jdbcTemplate = new JdbcTemplate(dataSource);
        CurrentUser currentUser = mock(CurrentUser.class);
        when(currentUser.requireUserId()).thenReturn("user-1");
        service = new RunsService(jdbcTemplate, currentUser);
    }

    @Test
    void createsRunOwnedByAuthenticatedUser() {
        CreateRunResponse response = service.createRun(
            new CreateRunRequest("https://app.joinhandshake.com/stu/postings", "2026-06-20T00:00:00Z")
        );

        assertThat(response.status()).isEqualTo("RUNNING");

        String ownerId = jdbcTemplate.queryForObject(
            "SELECT user_id FROM application_runs WHERE id = ?",
            String.class,
            response.runId()
        );
        assertThat(ownerId).isEqualTo("user-1");

        Integer appliedCount = jdbcTemplate.queryForObject(
            "SELECT applied_count FROM application_runs WHERE id = ?",
            Integer.class,
            response.runId()
        );
        assertThat(appliedCount).isZero();
    }

    @Test
    void recordsAggregateOutcomeCount() {
        CreateRunResponse run = service.createRun(
            new CreateRunRequest("https://app.joinhandshake.com/stu/postings", null)
        );

        service.recordOutcome(run.runId(), new RecordRunOutcomeRequest("APPLIED"));
        service.recordOutcome(run.runId(), new RecordRunOutcomeRequest("APPLIED"));

        Integer appliedCount = jdbcTemplate.queryForObject(
            "SELECT applied_count FROM application_runs WHERE id = ?",
            Integer.class,
            run.runId()
        );
        assertThat(appliedCount).isEqualTo(2);
    }

    @Test
    void rejectsUnknownOutcomeStatus() {
        assertThatThrownBy(() ->
            service.recordOutcome("run-1", new RecordRunOutcomeRequest("UNKNOWN"))
        ).isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void recordingOutcomeForMissingRunFails() {
        assertThatThrownBy(() ->
            service.recordOutcome("does-not-exist", new RecordRunOutcomeRequest("APPLIED"))
        ).isInstanceOf(IllegalArgumentException.class);
    }
}
