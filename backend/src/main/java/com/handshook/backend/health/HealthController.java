package com.handshook.backend.health;

import com.handshook.backend.database.DatabaseStatusService;
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
    private final DatabaseStatusService databaseStatusService;

    public HealthController(
        @Value("${app.version:0.1.0}") String appVersion,
        DatabaseStatusService databaseStatusService
    ) {
        this.appVersion = appVersion;
        this.databaseStatusService = databaseStatusService;
    }

    @GetMapping
    public HealthResponse getHealth() {
        String database = databaseStatusService.getStatus();
        log.debug("HEALTH status=UP version={} database={}", appVersion, database);
        return new HealthResponse("UP", appVersion, database);
    }
}
