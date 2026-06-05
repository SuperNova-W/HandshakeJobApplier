package com.handshook.backend.runs;

public record RunSummaryDto(
    String runId,
    String startedAt,
    String endedAt,
    String status,
    String sourceUrl,
    int appliedCount,
    int skippedCount,
    int failedCount,
    String errorMessage
) {}
