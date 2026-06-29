package com.handshook.backend.content;

import java.util.List;

record ScreeningPreferencesRecord(
    String userId,
    boolean usWorkAuthorized,
    boolean softwareEngineeringDegree,
    boolean speaksEnglish,
    boolean relocateAnywhere,
    List<String> locations,
    String updatedAt
) {
    ScreeningPrefsDto toDto() {
        return new ScreeningPrefsDto(
            usWorkAuthorized,
            softwareEngineeringDegree,
            speaksEnglish,
            relocateAnywhere,
            locations == null ? List.of() : locations
        );
    }
}
