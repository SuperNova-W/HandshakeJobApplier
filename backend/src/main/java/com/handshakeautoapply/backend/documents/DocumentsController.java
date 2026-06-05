package com.handshakeautoapply.backend.documents;

import java.util.List;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

@RestController
@RequestMapping("/api/documents")
public class DocumentsController {

    private final DocumentsService documentsService;

    public DocumentsController(DocumentsService documentsService) {
        this.documentsService = documentsService;
    }

    @GetMapping
    public List<DocumentMeta> list() {
        return documentsService.list();
    }

    @PostMapping(consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public DocumentMeta upload(
        @RequestParam("docType") String docType,
        @RequestParam(value = "label", required = false) String label,
        @RequestParam("file") MultipartFile file
    ) {
        return documentsService.upload(docType, label, file);
    }

    @GetMapping("/{id}/content")
    public ResponseEntity<byte[]> download(@PathVariable String id) {
        DocumentsService.DocumentContent doc = documentsService.getContent(id);
        return ResponseEntity.ok()
            .header(HttpHeaders.CONTENT_TYPE, doc.contentType())
            .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + doc.filename() + "\"")
            .body(doc.data());
    }

    /**
     * Serve the latest stored document of a given type (e.g. TRANSCRIPT) by its
     * bytes, or 404 if none is on file. Used by the auto-apply flow to attach the
     * user's saved transcript into Handshake's apply modal without knowing its id.
     */
    @GetMapping("/by-type/{docType}/content")
    public ResponseEntity<byte[]> downloadByType(@PathVariable String docType) {
        DocumentsService.DocumentContent doc =
            documentsService.getLatestByType(docType == null ? "" : docType.trim().toUpperCase());
        if (doc == null) {
            return ResponseEntity.notFound().build();
        }
        return ResponseEntity.ok()
            .header(HttpHeaders.CONTENT_TYPE, doc.contentType())
            .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + doc.filename() + "\"")
            .body(doc.data());
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@PathVariable String id) {
        documentsService.delete(id);
        return ResponseEntity.noContent().build();
    }
}
