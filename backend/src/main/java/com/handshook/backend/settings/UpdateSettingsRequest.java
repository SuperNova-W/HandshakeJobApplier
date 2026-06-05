package com.handshook.backend.settings;

import jakarta.validation.constraints.Min;

public record UpdateSettingsRequest(
    @Min(1000) int applyDelayMs,
    @Min(1) int maxPagesPerRun,
    boolean stopOnError
) {}
