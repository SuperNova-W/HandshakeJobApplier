package com.handshakeautoapply.backend.content;

import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/content")
public class ContentController {

    private final ContentService contentService;

    public ContentController(ContentService contentService) {
        this.contentService = contentService;
    }

    @GetMapping("/resume")
    public ResumeDto getResume() {
        return contentService.getResume();
    }

    @PutMapping("/resume")
    public ResumeDto updateResume(@RequestBody UpdateResumeRequest request) {
        return contentService.updateResume(request);
    }

    @GetMapping("/screening")
    public ScreeningPrefsDto getScreeningPrefs() {
        return contentService.getScreeningPrefs();
    }

    @PutMapping("/screening")
    public ScreeningPrefsDto updateScreeningPrefs(@RequestBody UpdateScreeningPrefsRequest request) {
        return contentService.updateScreeningPrefs(request);
    }
}
