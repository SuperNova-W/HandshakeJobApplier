package com.handshook.backend.content;

import java.util.List;

/**
 * The user's stored answers to common Handshake screening questions. The content
 * script uses these to fill Yes/No radios instead of skipping the job.
 * {@code locations} are place strings ("Miami", "New York"); a question is
 * answered "Yes" when {@code relocateAnywhere} is set or the question text
 * mentions one of these places.
 */
public record ScreeningPrefsDto(
    boolean usWorkAuthorized,
    boolean softwareEngineeringDegree,
    boolean speaksEnglish,
    boolean relocateAnywhere,
    List<String> locations
) {}
