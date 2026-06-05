package com.handshook.backend.otherdocs;

import com.handshook.backend.content.ContentService;
import com.handshook.backend.documents.DocumentTextExtractor;
import com.handshook.backend.documents.DocumentsService;
import com.handshook.backend.documents.DocumentsService.DocumentContent;
import com.handshook.backend.documents.DocumentsService.NamedDocumentContent;
import java.util.ArrayList;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * Builds the "knowledge base" the other-docs agent retrieves from: the user's
 * stored RESUME, GITHUB_PROJECT writeup, and any OTHER documents (plus the pasted
 * resume text as a fallback). This is the retrieval step of the RAG flow — the
 * gathered text becomes grounding context for the OpenAI generation that drafts
 * the employer-requested document.
 */
@Component
public class UserDocsContext {

    private static final Logger log = LoggerFactory.getLogger(UserDocsContext.class);

    // Cap each source so a long document can't blow past the model's context.
    private static final int PER_SOURCE_CHAR_CAP = 6000;

    private final DocumentsService documentsService;
    private final DocumentTextExtractor extractor;
    private final ContentService contentService;

    public UserDocsContext(
        DocumentsService documentsService,
        DocumentTextExtractor extractor,
        ContentService contentService
    ) {
        this.documentsService = documentsService;
        this.extractor = extractor;
        this.contentService = contentService;
    }

    /** A single retrieved source: a human label and its extracted text. */
    public record Source(String label, String text) {}

    /** Everything gathered, in the order it should appear in the prompt. */
    public List<Source> gather() {
        List<Source> sources = new ArrayList<>();

        addFixed(sources, "RESUME", "Resume");
        addFixed(sources, "GITHUB_PROJECT", "GitHub project");
        addFixed(sources, "TRANSCRIPT", "Transcript");

        for (NamedDocumentContent doc : documentsService.getAllByType("OTHER")) {
            String label = (doc.label() != null && !doc.label().isBlank())
                ? doc.label().trim()
                : doc.filename();
            addSource(sources, "Document: " + label, extractor.extract(doc.toContent()));
        }

        // Fallback: if no RESUME document extracted, use the pasted resume text.
        boolean haveResume = sources.stream().anyMatch(s -> s.label().equals("Resume"));
        if (!haveResume) {
            addSource(sources, "Resume", contentService.getResumeText());
        }

        log.info("Gathered {} document source(s) for the other-docs agent: {}",
            sources.size(), sources.stream().map(Source::label).toList());
        return sources;
    }

    private void addFixed(List<Source> sources, String docType, String label) {
        DocumentContent doc = documentsService.getLatestByType(docType);
        if (doc != null) {
            addSource(sources, label, extractor.extract(doc));
        }
    }

    private void addSource(List<Source> sources, String label, String text) {
        if (text == null || text.isBlank()) {
            return;
        }
        String trimmed = text.trim();
        if (trimmed.length() > PER_SOURCE_CHAR_CAP) {
            trimmed = trimmed.substring(0, PER_SOURCE_CHAR_CAP) + "\n[...truncated...]";
        }
        sources.add(new Source(label, trimmed));
    }
}
