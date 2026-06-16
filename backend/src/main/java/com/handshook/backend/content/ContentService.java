package com.handshook.backend.content;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.List;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

/**
 * Stores user-provided content in single-row tables. Screening-question answers
 * are editable from the extension's options page; resume text is retained only
 * as a fallback for existing local databases when no uploaded resume can be
 * extracted.
 */
@Service
public class ContentService {

    private final JdbcTemplate jdbcTemplate;
    private final ObjectMapper objectMapper;

    public ContentService(JdbcTemplate jdbcTemplate, ObjectMapper objectMapper) {
        this.jdbcTemplate = jdbcTemplate;
        this.objectMapper = objectMapper;
    }

    /** Raw resume text (may be null/blank if the user hasn't set one yet). */
    public String getResumeText() {
        return jdbcTemplate.queryForObject(
            "SELECT resume_text FROM user_content WHERE id = 1",
            String.class
        );
    }

    // ─── Screening-question answers ──────────────────────────────────────────

    public ScreeningPrefsDto getScreeningPrefs() {
        return jdbcTemplate.queryForObject(
            "SELECT us_work_authorized, relocate_anywhere, relocate_locations FROM screening_prefs WHERE id = 1",
            (rs, rowNum) -> new ScreeningPrefsDto(
                rs.getInt("us_work_authorized") == 1,
                rs.getInt("relocate_anywhere") == 1,
                parseLocations(rs.getString("relocate_locations"))
            )
        );
    }

    public ScreeningPrefsDto updateScreeningPrefs(UpdateScreeningPrefsRequest request) {
        boolean authorized = request.usWorkAuthorized() == null || request.usWorkAuthorized();
        boolean anywhere = request.relocateAnywhere() != null && request.relocateAnywhere();
        List<String> locations = request.locations() == null
            ? List.of()
            : request.locations().stream()
                .filter(s -> s != null && !s.isBlank())
                .map(String::trim)
                .distinct()
                .toList();

        jdbcTemplate.update(
            "UPDATE screening_prefs SET us_work_authorized = ?, relocate_anywhere = ?, "
                + "relocate_locations = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1",
            authorized ? 1 : 0,
            anywhere ? 1 : 0,
            writeLocations(locations)
        );
        return getScreeningPrefs();
    }

    private List<String> parseLocations(String json) {
        if (json == null || json.isBlank()) {
            return List.of();
        }
        try {
            return objectMapper.readValue(json, new TypeReference<List<String>>() {});
        } catch (Exception e) {
            return List.of();
        }
    }

    private String writeLocations(List<String> locations) {
        if (locations.isEmpty()) {
            return null;
        }
        try {
            return objectMapper.writeValueAsString(locations);
        } catch (Exception e) {
            return null;
        }
    }
}
