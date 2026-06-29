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
            Integer ok = jdbcTemplate.queryForObject("SELECT 1", Integer.class);
            return ok != null && ok == 1 ? "CONNECTED" : "UNAVAILABLE";
        } catch (Exception exception) {
            log.error("DB_STATUS unavailable", exception);
            return "UNAVAILABLE";
        }
    }
}
