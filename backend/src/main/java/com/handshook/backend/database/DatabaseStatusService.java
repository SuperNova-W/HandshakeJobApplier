package com.handshook.backend.database;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

@Service
public class DatabaseStatusService {

    private final JdbcTemplate jdbcTemplate;

    public DatabaseStatusService(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    public String getStatus() {
        try {
            Integer probe = jdbcTemplate.queryForObject("SELECT 1", Integer.class);
            return Integer.valueOf(1).equals(probe) ? "CONNECTED" : "UNAVAILABLE";
        } catch (Exception exception) {
            return "UNAVAILABLE";
        }
    }
}
