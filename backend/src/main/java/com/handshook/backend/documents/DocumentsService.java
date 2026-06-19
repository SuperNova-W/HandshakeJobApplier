package com.handshook.backend.documents;

import java.io.IOException;
import java.sql.Types;
import java.time.Instant;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

/**
 * Stores and retrieves uploaded application documents in the documents table.
 * Fixed types (resume, cover letter, transcript, GitHub-project writeup) are
 * single-slot — re-uploading replaces the previous file. OTHER allows many.
 */
@Service
public class DocumentsService {

    private static final Logger log = LoggerFactory.getLogger(DocumentsService.class);

    /** Single-slot types: a new upload replaces any existing one. */
    private static final Set<String> FIXED_TYPES =
        Set.of("RESUME", "COVER_LETTER", "TRANSCRIPT", "GITHUB_PROJECT");
    private static final Set<String> ALL_TYPES =
        Set.of("RESUME", "COVER_LETTER", "TRANSCRIPT", "GITHUB_PROJECT", "OTHER");

    private final JdbcTemplate jdbcTemplate;

    public DocumentsService(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    public List<DocumentMeta> list() {
        List<DocumentMeta> docs = jdbcTemplate.query(
            "SELECT id, doc_type, label, filename, content_type, size_bytes, uploaded_at "
                + "FROM documents ORDER BY uploaded_at DESC",
            (rs, n) -> new DocumentMeta(
                rs.getString("id"),
                rs.getString("doc_type"),
                rs.getString("label"),
                rs.getString("filename"),
                rs.getString("content_type"),
                rs.getLong("size_bytes"),
                rs.getString("uploaded_at")
            )
        );
        log.info("DOCUMENT_LIST count={} docs={}", docs.size(), docs);
        return docs;
    }

    public DocumentMeta upload(String docTypeRaw, String label, MultipartFile file) {
        String docType = docTypeRaw == null ? "" : docTypeRaw.trim().toUpperCase();
        if (!ALL_TYPES.contains(docType)) {
            throw new IllegalArgumentException(
                "Unknown document type '" + docTypeRaw + "'. Expected one of " + ALL_TYPES + ".");
        }
        if (file == null || file.isEmpty()) {
            throw new IllegalArgumentException("No file was provided in the upload.");
        }

        byte[] data;
        try {
            data = file.getBytes();
        } catch (IOException e) {
            throw new IllegalStateException("Failed to read the uploaded file.", e);
        }

        String cleanLabel = (label == null || label.isBlank()) ? null : label.trim();
        String filename = file.getOriginalFilename() == null ? "upload" : file.getOriginalFilename();
        String contentType =
            file.getContentType() == null ? "application/octet-stream" : file.getContentType();
        String id = UUID.randomUUID().toString();
        String uploadedAt = Instant.now().toString();

        // Single-slot replacement for fixed types.
        if (FIXED_TYPES.contains(docType)) {
            int deleted = jdbcTemplate.update("DELETE FROM documents WHERE doc_type = ?", docType);
            log.info("DOCUMENT_UPLOAD replacing fixed slot type={} deletedExisting={}", docType, deleted);
        }

        jdbcTemplate.update(con -> {
            var ps = con.prepareStatement(
                "INSERT INTO documents "
                    + "(id, doc_type, label, filename, content_type, size_bytes, data, uploaded_at) "
                    + "VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
            ps.setString(1, id);
            ps.setString(2, docType);
            if (cleanLabel == null) {
                ps.setNull(3, Types.VARCHAR);
            } else {
                ps.setString(3, cleanLabel);
            }
            ps.setString(4, filename);
            ps.setString(5, contentType);
            ps.setLong(6, data.length);
            ps.setBytes(7, data);
            ps.setString(8, uploadedAt);
            return ps;
        });

        log.info("DOCUMENT_UPLOAD stored id={} type={} label={} filename='{}' contentType={} bytes={}",
            id, docType, cleanLabel, filename, contentType, data.length);
        return new DocumentMeta(id, docType, cleanLabel, filename, contentType, data.length, uploadedAt);
    }

    public DocumentContent getContent(String id) {
        log.info("DOCUMENT_GET id={}", id);
        List<DocumentContent> results = jdbcTemplate.query(
            "SELECT filename, content_type, data FROM documents WHERE id = ?",
            (rs, n) -> new DocumentContent(
                rs.getString("filename"),
                rs.getString("content_type"),
                rs.getBytes("data")
            ),
            id
        );
        if (results.isEmpty()) {
            log.warn("DOCUMENT_GET missing id={}", id);
            throw new IllegalArgumentException("No document found with id " + id + ".");
        }
        DocumentContent doc = results.get(0);
        log.info("DOCUMENT_GET hit id={} filename='{}' contentType={} bytes={}",
            id, doc.filename(), doc.contentType(), doc.data() == null ? 0 : doc.data().length);
        return doc;
    }

    /**
     * The most recent document of a given type, or null if none. Used by the
     * cover-letter generator to read the uploaded RESUME (a single-slot type, so
     * there is at most one). Returns bytes, not metadata.
     */
    public DocumentContent getLatestByType(String docType) {
        log.info("DOCUMENT_LATEST lookup type={}", docType);
        List<DocumentContent> results = jdbcTemplate.query(
            "SELECT filename, content_type, data FROM documents WHERE doc_type = ? "
                + "ORDER BY uploaded_at DESC LIMIT 1",
            (rs, n) -> new DocumentContent(
                rs.getString("filename"),
                rs.getString("content_type"),
                rs.getBytes("data")
            ),
            docType
        );
        DocumentContent doc = results.isEmpty() ? null : results.get(0);
        log.info("DOCUMENT_LATEST type={} found={} filename={} bytes={}",
            docType,
            doc != null,
            doc == null ? null : doc.filename(),
            doc == null || doc.data() == null ? 0 : doc.data().length);
        return doc;
    }

    /**
     * Every stored document of a given type, newest first, with bytes and label.
     * Unlike {@link #getLatestByType} this returns all matches — used to feed the
     * multi-document OTHER slot into the RAG document generator.
     */
    public List<NamedDocumentContent> getAllByType(String docType) {
        List<NamedDocumentContent> docs = jdbcTemplate.query(
            "SELECT filename, content_type, label, data FROM documents WHERE doc_type = ? "
                + "ORDER BY uploaded_at DESC",
            (rs, n) -> new NamedDocumentContent(
                rs.getString("filename"),
                rs.getString("content_type"),
                rs.getString("label"),
                rs.getBytes("data")
            ),
            docType
        );
        log.info("DOCUMENT_ALL_BY_TYPE type={} count={} files={}",
            docType,
            docs.size(),
            docs.stream().map(d -> d.filename() + "(" + (d.data() == null ? 0 : d.data().length) + " bytes)").toList());
        return docs;
    }

    public void delete(String id) {
        int rows = jdbcTemplate.update("DELETE FROM documents WHERE id = ?", id);
        if (rows == 0) {
            log.warn("DOCUMENT_DELETE missing id={}", id);
            throw new IllegalArgumentException("No document found with id " + id + ".");
        }
        log.info("DOCUMENT_DELETE deleted id={}", id);
    }

    /** File bytes plus the bits needed to serve a download. */
    public record DocumentContent(String filename, String contentType, byte[] data) {}

    /** Like {@link DocumentContent} but also carries the user's label (for RAG context). */
    public record NamedDocumentContent(String filename, String contentType, String label, byte[] data) {
        public DocumentContent toContent() {
            return new DocumentContent(filename, contentType, data);
        }
    }
}
