package com.handshook.backend.coverletter;

/**
 * Body for POST /api/cover-letter — the scraped job context plus the resume text
 * the extension extracted from the user's locally stored resume. The resume is
 * never persisted server-side; it arrives per request and is used only to ground
 * this generation.
 */
public record CoverLetterRequest(
    String jobTitle,
    String company,
    String jobDescription,
    String resumeText
) {}
