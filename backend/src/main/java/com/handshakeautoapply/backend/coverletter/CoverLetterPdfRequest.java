package com.handshakeautoapply.backend.coverletter;

/**
 * Body for POST /api/cover-letter/pdf. Carries the (possibly user-edited) letter
 * text plus the company/role used only to name the file. Rendering does not call
 * OpenAI — the text is already final, having been reviewed in the extension.
 */
public record CoverLetterPdfRequest(String coverLetter, String company, String jobTitle) {}
