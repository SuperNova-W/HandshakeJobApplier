package com.handshakeautoapply.backend.otherdocs;

/**
 * Body for POST /api/other-docs/generate — the scraped job context plus the
 * employer's instructions for the extra document they're asking for. The agent
 * drafts that document grounded in the user's stored materials.
 */
public record OtherDocsRequest(
    String jobTitle,
    String company,
    String jobDescription,
    String instructions
) {}
