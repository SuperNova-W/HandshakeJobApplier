package com.handshook.backend.config;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;
import org.springframework.web.util.ContentCachingRequestWrapper;
import org.springframework.web.util.ContentCachingResponseWrapper;

/**
 * Logs every HTTP request/response pair hitting the backend: method, path, query
 * string, request body, response status, and duration. This is the single most
 * useful artefact when debugging the extension end-to-end — it shows exactly
 * which API calls the Chrome extension is (or is not) making, with their bodies.
 *
 * Bodies are buffered via Spring's content-caching wrappers so reading them here
 * does not consume the stream the controllers need. Bodies are truncated to keep
 * the logs readable.
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public class RequestLoggingFilter extends OncePerRequestFilter {

    private static final Logger log = LoggerFactory.getLogger("com.handshook.http");
    private static final int MAX_BODY_CHARS = 12000;

    @Override
    protected void doFilterInternal(
            HttpServletRequest request, HttpServletResponse response, FilterChain filterChain)
            throws ServletException, IOException {

        ContentCachingRequestWrapper req = new ContentCachingRequestWrapper(request);
        ContentCachingResponseWrapper res = new ContentCachingResponseWrapper(response);

        long start = System.nanoTime();
        String query = request.getQueryString() == null ? "" : "?" + request.getQueryString();
        log.info("--> {} {}{} (origin={} contentType={} userAgent={})",
                request.getMethod(),
                request.getRequestURI(),
                query,
                request.getHeader("Origin"),
                request.getContentType(),
                truncateHeader(request.getHeader("User-Agent")));

        try {
            filterChain.doFilter(req, res);
        } finally {
            long tookMs = (System.nanoTime() - start) / 1_000_000;
            boolean sensitivePath = request.getRequestURI().startsWith("/api/users");

            if (sensitivePath) {
                if (req.getContentAsByteArray().length > 0) {
                    log.info("    request  body: [redacted user data]");
                }
            } else if (isTextLike(request.getContentType())) {
                String reqBody = bodyToString(req.getContentAsByteArray());
                if (!reqBody.isBlank()) {
                    log.info("    request  body: {}", truncate(reqBody));
                }
            } else if (req.getContentAsByteArray().length > 0) {
                log.info("    request  body: [{} bytes, {}]",
                        req.getContentAsByteArray().length, request.getContentType());
            }

            log.info("<-- {} {}{} -> {} ({} ms)",
                    request.getMethod(), request.getRequestURI(), query, res.getStatus(), tookMs);
            if (sensitivePath) {
                if (res.getContentAsByteArray().length > 0) {
                    log.info("    response body: [redacted user data]");
                }
            } else if (isTextLike(res.getContentType())) {
                String resBody = bodyToString(res.getContentAsByteArray());
                if (!resBody.isBlank()) {
                    log.info("    response body: {}", truncate(resBody));
                }
            } else if (res.getContentAsByteArray().length > 0) {
                log.info("    response body: [{} bytes, {}]",
                        res.getContentAsByteArray().length, res.getContentType());
            }
            if (res.getStatus() >= 400) {
                log.warn("    ^^ {} {}{} returned error status {}",
                        request.getMethod(), request.getRequestURI(), query, res.getStatus());
            }

            // Must copy the cached body back onto the real response or the client
            // receives an empty payload.
            res.copyBodyToResponse();
        }
    }

    /** Only log bodies we can read as text — skips multipart uploads and binary downloads. */
    private static boolean isTextLike(String contentType) {
        if (contentType == null) {
            return false;
        }
        String ct = contentType.toLowerCase();
        return ct.contains("json")
            || ct.startsWith("text/")
            || ct.contains("xml")
            || ct.contains("x-www-form-urlencoded");
    }

    private static String bodyToString(byte[] bytes) {
        if (bytes == null || bytes.length == 0) {
            return "";
        }
        return new String(bytes, StandardCharsets.UTF_8).trim();
    }

    private static String truncate(String value) {
        if (value.length() <= MAX_BODY_CHARS) {
            return value;
        }
        return value.substring(0, MAX_BODY_CHARS) + "…(" + (value.length() - MAX_BODY_CHARS) + " more chars)";
    }

    private static String truncateHeader(String value) {
        if (value == null || value.isBlank()) {
            return null;
        }
        return value.length() <= 160 ? value : value.substring(0, 160) + "…";
    }
}
