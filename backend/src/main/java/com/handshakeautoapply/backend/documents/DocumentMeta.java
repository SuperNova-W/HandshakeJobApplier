package com.handshakeautoapply.backend.documents;

/** Metadata for an uploaded document (no file bytes). */
public record DocumentMeta(
    String id,
    String docType,
    String label,
    String filename,
    String contentType,
    long sizeBytes,
    String uploadedAt
) {}
