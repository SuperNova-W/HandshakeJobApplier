package com.handshook.backend.otherdocs;

/**
 * A single knowledge-base source the extension extracted from one of the user's
 * locally stored documents: a human label (e.g. "Resume", "GitHub project") and
 * its plain text. Supplied per request — nothing is stored server-side.
 */
public record DocSource(String label, String text) {}
