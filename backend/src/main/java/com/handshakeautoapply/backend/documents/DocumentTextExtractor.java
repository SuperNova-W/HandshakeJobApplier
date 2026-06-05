package com.handshakeautoapply.backend.documents;

import com.handshakeautoapply.backend.documents.DocumentsService.DocumentContent;
import java.nio.charset.StandardCharsets;
import org.apache.pdfbox.Loader;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.text.PDFTextStripper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * Extracts plain text from a stored document's bytes so AI features can use it as
 * context. Handles PDFs (via PDFBox) and text/markdown; binary formats it can't
 * read (DOCX, images) yield null. Shared by the cover-letter and other-docs
 * generators so the extraction logic lives in one place.
 */
@Component
public class DocumentTextExtractor {

    private static final Logger log = LoggerFactory.getLogger(DocumentTextExtractor.class);

    /** Plain text of the document, or null if it can't be extracted. */
    public String extract(DocumentContent doc) {
        if (doc == null || doc.data() == null || doc.data().length == 0) {
            return null;
        }
        String contentType = doc.contentType() == null ? "" : doc.contentType().toLowerCase();
        String filename = doc.filename() == null ? "" : doc.filename().toLowerCase();

        if (contentType.contains("pdf") || filename.endsWith(".pdf")) {
            try (PDDocument pdf = Loader.loadPDF(doc.data())) {
                String text = new PDFTextStripper().getText(pdf).trim();
                return text.isBlank() ? null : text;
            } catch (Exception e) {
                log.error("Failed to extract text from PDF '{}'.", doc.filename(), e);
                return null;
            }
        }

        if (contentType.startsWith("text/") || filename.endsWith(".txt") || filename.endsWith(".md")) {
            String text = new String(doc.data(), StandardCharsets.UTF_8).trim();
            return text.isBlank() ? null : text;
        }

        log.warn("Document '{}' (type {}) is not a PDF or text file — cannot extract its text.",
            doc.filename(), contentType);
        return null;
    }
}
