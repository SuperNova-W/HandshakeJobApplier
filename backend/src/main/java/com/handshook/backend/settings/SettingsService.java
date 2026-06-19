package com.handshook.backend.settings;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

@Service
public class SettingsService {

    private static final Logger log = LoggerFactory.getLogger(SettingsService.class);

    private final JdbcTemplate jdbcTemplate;

    public SettingsService(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    public SettingsDto getSettings() {
        SettingsDto settings = jdbcTemplate.queryForObject(
            "SELECT apply_delay_ms, max_pages_per_run, stop_on_error FROM settings WHERE id = 1",
            (rs, rowNum) -> new SettingsDto(
                rs.getInt("apply_delay_ms"),
                rs.getInt("max_pages_per_run"),
                rs.getInt("stop_on_error") == 1
            )
        );
        log.info("SETTINGS_LOAD applyDelayMs={} maxPagesPerRun={} stopOnError={}",
            settings.applyDelayMs(), settings.maxPagesPerRun(), settings.stopOnError());
        return settings;
    }
}
