package com.handshook.backend.coverletter;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/cover-letter")
public class CoverLetterController {

    private static final Logger log = LoggerFactory.getLogger(CoverLetterController.class);

    private final CoverLetterService coverLetterService;
    private final CoverLetterPdfRenderer pdfRenderer;

    public CoverLetterController(CoverLetterService coverLetterService, CoverLetterPdfRenderer pdfRenderer) {
        this.coverLetterService = coverLetterService;
        this.pdfRenderer = pdfRenderer;
    }

    @PostMapping
    public CoverLetterResponse generate(@RequestBody CoverLetterRequest request) {
        return coverLetterService.generate(request);
    }

    /**
     * Renders the already-reviewed letter text to a PDF the extension attaches to
     * Handshake's apply modal. Returns the raw bytes with a Content-Disposition
     * filename derived from the company.
     */
    @PostMapping("/pdf")
    public ResponseEntity<byte[]> renderPdf(@RequestBody CoverLetterPdfRequest request) {
        byte[] pdf = pdfRenderer.render(request.coverLetter());
        String filename = buildFilename(request.company());
        log.info("COVER_LETTER_PDF rendered filename={} company='{}' inputChars={} bytes={}",
            filename,
            request.company(),
            request.coverLetter() == null ? 0 : request.coverLetter().length(),
            pdf.length);

        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_PDF);
        headers.setContentDisposition(ContentDisposition.attachment().filename(filename).build());
        return new ResponseEntity<>(pdf, headers, 200);
    }

    private static String buildFilename(String company) {
        String slug = (company == null || company.isBlank()) ? "" : company.trim().replaceAll("[^A-Za-z0-9]+", "_");
        slug = slug.replaceAll("^_+|_+$", "");
        return slug.isEmpty() ? "Cover_Letter.pdf" : "Cover_Letter_" + slug + ".pdf";
    }
}
