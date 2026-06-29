package com.handshook.backend.content;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.handshook.backend.auth.CurrentUser;
import java.time.Instant;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Service;

@Service
public class ContentService {

    private static final Logger log = LoggerFactory.getLogger(ContentService.class);

    private final JdbcTemplate jdbcTemplate;
    private final CurrentUser currentUser;
    private final ObjectMapper objectMapper;
    private final RowMapper<ScreeningPreferencesRecord> rowMapper = (rs, rowNum) ->
        new ScreeningPreferencesRecord(
            rs.getString("user_id"),
            rs.getBoolean("us_work_authorized"),
            rs.getBoolean("software_engineering_degree"),
            rs.getBoolean("speaks_english"),
            rs.getBoolean("relocate_anywhere"),
            readLocations(rs.getString("locations")),
            rs.getString("updated_at")
        );

    public ContentService(
        JdbcTemplate jdbcTemplate,
        CurrentUser currentUser,
        ObjectMapper objectMapper
    ) {
        this.jdbcTemplate = jdbcTemplate;
        this.currentUser = currentUser;
        this.objectMapper = objectMapper;
    }

    public ScreeningPrefsDto getScreeningPrefs() {
        String userId = currentUser.requireUserId();
        ScreeningPrefsDto prefs = jdbcTemplate
            .query("SELECT * FROM screening_preferences WHERE user_id = ?", rowMapper, userId)
            .stream()
            .findFirst()
            .map(ScreeningPreferencesRecord::toDto)
            .orElseGet(ContentService::defaults);
        log.info("SCREENING_PREFS_LOAD userId={} prefs={}", userId, prefs);
        return prefs;
    }

    public ScreeningPrefsDto updateScreeningPrefs(UpdateScreeningPrefsRequest request) {
        String userId = currentUser.requireUserId();
        boolean authorized = request.usWorkAuthorized() == null || request.usWorkAuthorized();
        boolean softwareEngineeringDegree =
            request.softwareEngineeringDegree() == null || request.softwareEngineeringDegree();
        boolean speaksEnglish = request.speaksEnglish() == null || request.speaksEnglish();
        boolean anywhere = request.relocateAnywhere() != null && request.relocateAnywhere();
        List<String> locations = request.locations() == null
            ? List.of()
            : request.locations().stream()
                .filter(value -> value != null && !value.isBlank())
                .map(String::trim)
                .distinct()
                .toList();

        ScreeningPreferencesRecord saved = new ScreeningPreferencesRecord(
            userId,
            authorized,
            softwareEngineeringDegree,
            speaksEnglish,
            anywhere,
            locations,
            Instant.now().toString()
        );

        jdbcTemplate.update(
            """
            INSERT INTO screening_preferences (
                user_id, us_work_authorized, software_engineering_degree,
                speaks_english, relocate_anywhere, locations, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(user_id) DO UPDATE SET
                us_work_authorized = excluded.us_work_authorized,
                software_engineering_degree = excluded.software_engineering_degree,
                speaks_english = excluded.speaks_english,
                relocate_anywhere = excluded.relocate_anywhere,
                locations = excluded.locations,
                updated_at = excluded.updated_at
            """,
            saved.userId(),
            saved.usWorkAuthorized() ? 1 : 0,
            saved.softwareEngineeringDegree() ? 1 : 0,
            saved.speaksEnglish() ? 1 : 0,
            saved.relocateAnywhere() ? 1 : 0,
            writeLocations(saved.locations()),
            saved.updatedAt()
        );
        log.info("SCREENING_PREFS_UPDATE userId={} prefs={}", userId, saved.toDto());
        return saved.toDto();
    }

    private List<String> readLocations(String json) {
        if (json == null || json.isBlank()) {
            return List.of();
        }
        try {
            return objectMapper.readValue(json, new TypeReference<List<String>>() {});
        } catch (Exception exception) {
            log.warn("SCREENING_PREFS_LOCATIONS_PARSE failed value={}", json, exception);
            return List.of();
        }
    }

    private String writeLocations(List<String> locations) {
        try {
            return objectMapper.writeValueAsString(locations == null ? List.of() : locations);
        } catch (Exception exception) {
            // List<String> serialization cannot realistically fail; fall back to empty.
            return "[]";
        }
    }

    private static ScreeningPrefsDto defaults() {
        return new ScreeningPrefsDto(true, true, true, false, List.of());
    }
}
