package com.handshakeautoapply.backend.applications;

public record CreateApplicationRequest(
    String handshakeJobId,
    String jobUrl,
    String title,
    String company,
    String status,
    String skipReason,
    String errorMessage,
    String appliedAt
) {}
