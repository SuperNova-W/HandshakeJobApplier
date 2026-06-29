package com.handshook.backend.runs;

record ApplicationRunRecord(
    String id,
    String userId,
    String startedAt,
    String endedAt,
    String status,
    String sourceUrl,
    int appliedCount,
    int skippedCount,
    int failedCount,
    String errorMessage
) {
    RunSummaryDto toDto() {
        return new RunSummaryDto(
            id,
            startedAt,
            endedAt,
            status,
            sourceUrl,
            appliedCount,
            skippedCount,
            failedCount,
            errorMessage
        );
    }
}
