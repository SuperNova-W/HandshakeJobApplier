package com.handshook.backend.health;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/health")
public class HealthController {

    private static final Logger log = LoggerFactory.getLogger(HealthController.class);

    private final String appVersion;

    public HealthController(@Value("${app.version:0.1.0}") String appVersion) {
        this.appVersion = appVersion;
    }

    @GetMapping
    public HealthResponse getHealth() {
        log.debug("HEALTH status=UP version={}", appVersion);
        return new HealthResponse("UP", appVersion);
    }
}
