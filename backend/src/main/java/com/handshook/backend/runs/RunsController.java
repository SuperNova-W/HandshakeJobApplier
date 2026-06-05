package com.handshook.backend.runs;

import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/runs")
public class RunsController {

    private final RunsService runsService;

    public RunsController(RunsService runsService) {
        this.runsService = runsService;
    }

    @PostMapping
    public CreateRunResponse createRun(@RequestBody CreateRunRequest request) {
        return runsService.createRun(request);
    }

    @PatchMapping("/{runId}")
    public RunSummaryDto finalizeRun(@PathVariable String runId, @RequestBody FinalizeRunRequest request) {
        return runsService.finalizeRun(runId, request);
    }

    @GetMapping
    public List<RunSummaryDto> getRecentRuns(@RequestParam(defaultValue = "5") int limit) {
        return runsService.getRecentRuns(Math.min(limit, 50));
    }
}
