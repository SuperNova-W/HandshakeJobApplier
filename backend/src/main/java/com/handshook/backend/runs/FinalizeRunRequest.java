package com.handshook.backend.runs;

public record FinalizeRunRequest(String status, String endedAt, String errorMessage) {}
