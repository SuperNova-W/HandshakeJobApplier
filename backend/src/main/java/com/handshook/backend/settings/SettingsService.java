package com.handshook.backend.settings;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

@Service
public class SettingsService {

    private final JdbcTemplate jdbcTemplate;

    public SettingsService(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    public SettingsDto getSettings() {
        return jdbcTemplate.queryForObject(
            "SELECT apply_delay_ms, max_pages_per_run, stop_on_error FROM settings WHERE id = 1",
            (rs, rowNum) -> new SettingsDto(
                rs.getInt("apply_delay_ms"),
                rs.getInt("max_pages_per_run"),
                rs.getInt("stop_on_error") == 1
            )
        );
    }

    public SettingsDto updateSettings(UpdateSettingsRequest request) {
        jdbcTemplate.update(
            "UPDATE settings SET apply_delay_ms = ?, max_pages_per_run = ?, stop_on_error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1",
            request.applyDelayMs(),
            request.maxPagesPerRun(),
            request.stopOnError() ? 1 : 0
        );
        return getSettings();
    }
}
