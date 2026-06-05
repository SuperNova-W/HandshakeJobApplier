package com.handshakeautoapply.backend.runs;

public record FinalizeRunRequest(String status, String endedAt, String errorMessage) {}
