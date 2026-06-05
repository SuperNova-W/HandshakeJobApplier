package com.handshakeautoapply.backend.applications;

import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api")
public class ApplicationsController {

    private final ApplicationsService applicationsService;

    public ApplicationsController(ApplicationsService applicationsService) {
        this.applicationsService = applicationsService;
    }

    @PostMapping("/runs/{runId}/applications")
    public void recordApplication(@PathVariable String runId, @RequestBody CreateApplicationRequest request) {
        applicationsService.recordApplication(runId, request);
    }

    @GetMapping("/applications/exists")
    public ApplicationExistsResponse checkExists(@RequestParam String handshakeJobId) {
        return new ApplicationExistsResponse(applicationsService.checkExists(handshakeJobId));
    }
}
