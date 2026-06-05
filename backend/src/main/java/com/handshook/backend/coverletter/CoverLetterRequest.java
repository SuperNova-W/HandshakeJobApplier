package com.handshook.backend.coverletter;

/** Body for POST /api/cover-letter — the scraped job context. */
public record CoverLetterRequest(String jobTitle, String company, String jobDescription) {}
