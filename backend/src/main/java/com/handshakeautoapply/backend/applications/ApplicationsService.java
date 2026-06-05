package com.handshakeautoapply.backend.applications;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.UUID;

@Service
public class ApplicationsService {

    private final JdbcTemplate jdbcTemplate;

    public ApplicationsService(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    public void recordApplication(String runId, CreateApplicationRequest request) {
        String appliedAt = request.appliedAt() != null ? request.appliedAt() : Instant.now().toString();
        jdbcTemplate.update(
            """
            INSERT INTO applications
                (id, run_id, handshake_job_id, job_url, title, company, status, skip_reason, error_message, applied_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            UUID.randomUUID().toString(),
            runId,
            request.handshakeJobId(),
            request.jobUrl(),
            request.title(),
            request.company(),
            request.status(),
            request.skipReason(),
            request.errorMessage(),
            appliedAt
        );
    }

    public boolean checkExists(String handshakeJobId) {
        Integer count = jdbcTemplate.queryForObject(
            "SELECT COUNT(*) FROM applications WHERE handshake_job_id = ? AND status = 'APPLIED'",
            Integer.class,
            handshakeJobId
        );
        return count != null && count > 0;
    }
}
