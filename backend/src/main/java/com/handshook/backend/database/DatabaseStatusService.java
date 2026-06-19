package com.handshook.backend.database;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

@Service
public class DatabaseStatusService {

    private static final Logger log = LoggerFactory.getLogger(DatabaseStatusService.class);

    private final JdbcTemplate jdbcTemplate;

    public DatabaseStatusService(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    public String getStatus() {
        try {
            Integer probe = jdbcTemplate.queryForObject("SELECT 1", Integer.class);
            String status = Integer.valueOf(1).equals(probe) ? "CONNECTED" : "UNAVAILABLE";
            log.debug("DB_STATUS probe={} status={}", probe, status);
            return status;
        } catch (Exception exception) {
            log.error("DB_STATUS unavailable", exception);
            return "UNAVAILABLE";
        }
    }
}
