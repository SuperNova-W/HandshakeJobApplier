package com.handshook.backend.settings;

public record SettingsDto(int applyDelayMs, int maxPagesPerRun, boolean stopOnError) {}
