package com.handshakeautoapply.backend.health;

public record HealthResponse(
    String status,
    String version,
    String database
) {
}
