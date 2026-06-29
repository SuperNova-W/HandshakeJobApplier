package com.handshook.backend.settings;

import org.springframework.stereotype.Service;

@Service
public class SettingsService {

    private static final SettingsDto DEFAULTS = new SettingsDto(1500, 10, false);

    public SettingsDto getSettings() {
        return DEFAULTS;
    }
}
