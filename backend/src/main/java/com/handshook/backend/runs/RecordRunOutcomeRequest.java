package com.handshook.backend.runs;

/**
 * Aggregate-only run telemetry. The backend deliberately does not receive or
 * persist a Handshake job id, title, company, URL, or per-job application row.
 */
public record RecordRunOutcomeRequest(String status) {}
