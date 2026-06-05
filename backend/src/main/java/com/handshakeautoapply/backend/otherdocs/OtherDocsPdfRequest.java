package com.handshakeautoapply.backend.otherdocs;

/**
 * Body for POST /api/other-docs/pdf. Carries the (possibly user-edited) document
 * text plus the company used only to name the file. Rendering does not call
 * OpenAI — the text is already final, having been reviewed in the extension.
 */
public record OtherDocsPdfRequest(String document, String company, String jobTitle) {}
