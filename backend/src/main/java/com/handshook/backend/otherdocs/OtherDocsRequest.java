package com.handshook.backend.otherdocs;

import java.util.List;

/**
 * Body for POST /api/other-docs/generate — the scraped job context, the
 * employer's instructions for the extra document they're asking for, and the
 * knowledge-base sources (resume, GitHub project, other documents) the extension
 * extracted from the user's locally stored documents. The agent drafts that
 * document grounded in those sources; nothing is persisted server-side.
 */
public record OtherDocsRequest(
    String jobTitle,
    String company,
    String jobDescription,
    String instructions,
    List<DocSource> sources
) {}
