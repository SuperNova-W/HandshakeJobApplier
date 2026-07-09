package com.handshook.backend.health;

public record HealthResponse(
    String status,
    String version
) {
}
