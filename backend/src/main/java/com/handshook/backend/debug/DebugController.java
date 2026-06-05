package com.handshook.backend.debug;

import com.fasterxml.jackson.databind.JsonNode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Sink for client-side diagnostics forwarded by the extension's background
 * worker. The content script can only reach the backend via the background
 * worker (CORS allows the chrome-extension origin, not app.joinhandshake.com),
 * so the content script posts diagnostics to the worker, which relays them here.
 *
 * This exists purely so we can read live DOM/structure dumps from the Handshake
 * page directly in backend/logs/backend.log instead of asking the user to copy
 * console output. The full JSON is logged untruncated (the request-logging
 * filter truncates bodies; this does not).
 */
@RestController
@RequestMapping("/api/debug")
public class DebugController {

    private static final Logger log = LoggerFactory.getLogger("com.handshook.clientlog");

    @PostMapping("/client-log")
    public void clientLog(@RequestBody JsonNode body) {
        String label = body.path("label").asText("(no label)");
        log.info("CLIENT-LOG [{}]\n{}", label, body.toPrettyString());
    }
}
