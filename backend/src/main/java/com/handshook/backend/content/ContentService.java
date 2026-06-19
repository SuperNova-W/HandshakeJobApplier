package com.handshook.backend.content;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.annotation.PostConstruct;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
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

    private static final Logger log = LoggerFactory.getLogger(ContentService.class);

    private final JdbcTemplate jdbcTemplate;
    private final ObjectMapper objectMapper;

    public ContentService(JdbcTemplate jdbcTemplate, ObjectMapper objectMapper) {
        this.jdbcTemplate = jdbcTemplate;
        this.objectMapper = objectMapper;
    }

    @PostConstruct
    void ensureScreeningPrefsColumns() {
        Set<String> columns = jdbcTemplate.queryForList("PRAGMA table_info(screening_prefs)").stream()
            .map(row -> String.valueOf(row.get("name")))
            .collect(Collectors.toSet());
        log.info("SCREENING_SCHEMA columns={}", columns);
        if (!columns.contains("software_engineering_degree")) {
            jdbcTemplate.execute(
                "ALTER TABLE screening_prefs ADD COLUMN software_engineering_degree INTEGER NOT NULL DEFAULT 1"
            );
            log.info("SCREENING_SCHEMA migrated column=software_engineering_degree default=1");
        }
        if (!columns.contains("speaks_english")) {
            jdbcTemplate.execute(
                "ALTER TABLE screening_prefs ADD COLUMN speaks_english INTEGER NOT NULL DEFAULT 1"
            );
            log.info("SCREENING_SCHEMA migrated column=speaks_english default=1");
        }
    }

    /** Raw resume text (may be null/blank if the user hasn't set one yet). */
    public String getResumeText() {
        String resumeText = jdbcTemplate.queryForObject(
            "SELECT resume_text FROM user_content WHERE id = 1",
            String.class
        );
        log.info("CONTENT_RESUME_TEXT loaded present={} chars={}",
            resumeText != null && !resumeText.isBlank(),
            resumeText == null ? 0 : resumeText.length());
        return resumeText;
    }

    // ─── Screening-question answers ──────────────────────────────────────────

    public ScreeningPrefsDto getScreeningPrefs() {
        ScreeningPrefsDto prefs = jdbcTemplate.queryForObject(
            "SELECT us_work_authorized, software_engineering_degree, speaks_english, "
                + "relocate_anywhere, relocate_locations FROM screening_prefs WHERE id = 1",
            (rs, rowNum) -> new ScreeningPrefsDto(
                rs.getInt("us_work_authorized") == 1,
                rs.getInt("software_engineering_degree") == 1,
                rs.getInt("speaks_english") == 1,
                rs.getInt("relocate_anywhere") == 1,
                parseLocations(rs.getString("relocate_locations"))
            )
        );
        log.info("SCREENING_PREFS_LOAD {}", prefs);
        return prefs;
    }

    public ScreeningPrefsDto updateScreeningPrefs(UpdateScreeningPrefsRequest request) {
        log.info("SCREENING_PREFS_UPDATE incoming {}", request);
        boolean authorized = request.usWorkAuthorized() == null || request.usWorkAuthorized();
        boolean softwareEngineeringDegree =
            request.softwareEngineeringDegree() == null || request.softwareEngineeringDegree();
        boolean speaksEnglish = request.speaksEnglish() == null || request.speaksEnglish();
        boolean anywhere = request.relocateAnywhere() != null && request.relocateAnywhere();
        List<String> locations = request.locations() == null
            ? List.of()
            : request.locations().stream()
                .filter(s -> s != null && !s.isBlank())
                .map(String::trim)
                .distinct()
                .toList();

        jdbcTemplate.update(
            "UPDATE screening_prefs SET us_work_authorized = ?, software_engineering_degree = ?, "
                + "speaks_english = ?, relocate_anywhere = ?, relocate_locations = ?, "
                + "updated_at = CURRENT_TIMESTAMP WHERE id = 1",
            authorized ? 1 : 0,
            softwareEngineeringDegree ? 1 : 0,
            speaksEnglish ? 1 : 0,
            anywhere ? 1 : 0,
            writeLocations(locations)
        );
        ScreeningPrefsDto updated = getScreeningPrefs();
        log.info("SCREENING_PREFS_UPDATE saved {}", updated);
        return updated;
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
