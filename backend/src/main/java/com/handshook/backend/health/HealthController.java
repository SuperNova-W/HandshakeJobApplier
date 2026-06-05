package com.handshook.backend.health;

import com.handshook.backend.database.DatabaseStatusService;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/health")
public class HealthController {

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
        return new HealthResponse("UP", appVersion, databaseStatusService.getStatus());
    }
}
