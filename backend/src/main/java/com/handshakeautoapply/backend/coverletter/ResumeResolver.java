package com.handshakeautoapply.backend.coverletter;

import com.handshakeautoapply.backend.content.ContentService;
import com.handshakeautoapply.backend.documents.DocumentsService;
import com.handshakeautoapply.backend.documents.DocumentsService.DocumentContent;
import java.nio.charset.StandardCharsets;
import org.apache.pdfbox.Loader;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.text.PDFTextStripper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * Resolves the resume text used as context for cover-letter generation. Prefers
 * the uploaded RESUME document (extracting text from a PDF via PDFBox) and falls
 * back to the resume text pasted in the extension's Resume panel. This lets the
 * generator use the user's full resume PDF rather than a short pasted snippet.
 */
@Component
public class ResumeResolver {

    private static final Logger log = LoggerFactory.getLogger(ResumeResolver.class);

    private final DocumentsService documentsService;
    private final ContentService contentService;

    public ResumeResolver(DocumentsService documentsService, ContentService contentService) {
        this.documentsService = documentsService;
        this.contentService = contentService;
    }

    /** Best available resume text, or null/blank if neither source has one. */
    public String resolve() {
        DocumentContent doc = documentsService.getLatestByType("RESUME");
        if (doc != null && doc.data() != null && doc.data().length > 0) {
            String extracted = extractText(doc);
            if (extracted != null && !extracted.isBlank()) {
                log.info("Using uploaded RESUME document '{}' ({} chars) as cover-letter context.",
                    doc.filename(), extracted.length());
                return extracted;
            }
            log.warn("Uploaded RESUME '{}' yielded no extractable text — falling back to pasted resume text.",
                doc.filename());
        }
        return contentService.getResumeText();
    }

    private String extractText(DocumentContent doc) {
        String contentType = doc.contentType() == null ? "" : doc.contentType().toLowerCase();
        String filename = doc.filename() == null ? "" : doc.filename().toLowerCase();

        if (contentType.contains("pdf") || filename.endsWith(".pdf")) {
            try (PDDocument pdf = Loader.loadPDF(doc.data())) {
                return new PDFTextStripper().getText(pdf).trim();
            } catch (Exception e) {
                log.error("Failed to extract text from resume PDF '{}'.", doc.filename(), e);
                return null;
            }
        }

        if (contentType.startsWith("text/") || filename.endsWith(".txt") || filename.endsWith(".md")) {
            return new String(doc.data(), StandardCharsets.UTF_8).trim();
        }

        // DOCX and other binary formats aren't supported for extraction here.
        log.warn("Resume document '{}' (type {}) is not a PDF or text file — cannot extract its text.",
            doc.filename(), contentType);
        return null;
    }
}
