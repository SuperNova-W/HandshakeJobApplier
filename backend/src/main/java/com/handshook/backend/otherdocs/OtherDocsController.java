package com.handshook.backend.otherdocs;

import com.handshook.backend.coverletter.CoverLetterPdfRenderer;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

/**
 * Endpoints for the RAG document agent: {@code /generate} drafts the employer's
 * requested document from the user's stored materials, and {@code /pdf} renders
 * the (reviewed) text to a PDF the extension drops into Handshake's "other
 * required documents" upload field. PDF rendering reuses the cover-letter
 * renderer — it just lays out final text, no OpenAI involved.
 */
@RestController
@RequestMapping("/api/other-docs")
public class OtherDocsController {

    private final OtherDocsAgentService agentService;
    private final CoverLetterPdfRenderer pdfRenderer;

    public OtherDocsController(OtherDocsAgentService agentService, CoverLetterPdfRenderer pdfRenderer) {
        this.agentService = agentService;
        this.pdfRenderer = pdfRenderer;
    }

    @PostMapping("/generate")
    public OtherDocsResponse generate(@RequestBody OtherDocsRequest request) {
        return agentService.generate(request);
    }

    @PostMapping("/pdf")
    public ResponseEntity<byte[]> renderPdf(@RequestBody OtherDocsPdfRequest request) {
        byte[] pdf = pdfRenderer.render(request.document());
        String filename = buildFilename(request.company());

        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_PDF);
        headers.setContentDisposition(ContentDisposition.attachment().filename(filename).build());
        return new ResponseEntity<>(pdf, headers, 200);
    }

    private static String buildFilename(String company) {
        String slug = (company == null || company.isBlank()) ? "" : company.trim().replaceAll("[^A-Za-z0-9]+", "_");
        slug = slug.replaceAll("^_+|_+$", "");
        return slug.isEmpty() ? "Document.pdf" : "Document_" + slug + ".pdf";
    }
}
