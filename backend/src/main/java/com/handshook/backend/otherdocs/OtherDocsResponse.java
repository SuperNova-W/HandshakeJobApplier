package com.handshook.backend.otherdocs;

import java.util.List;

/**
 * The agent-drafted document plus generation metadata. {@code sources} lists the
 * stored materials (by filename) the RAG context was built from, so the user can
 * see what the draft was grounded in.
 */
public record OtherDocsResponse(
    String document,
    String model,
    String generatedAt,
    List<String> sources
) {}
