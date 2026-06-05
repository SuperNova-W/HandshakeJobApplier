package com.handshook.backend.content;

import java.util.List;

/**
 * Body for PUT /api/content/screening. Fields are boxed so an omitted value
 * falls back to a safe default in the service rather than NPE-ing.
 */
public record UpdateScreeningPrefsRequest(
    Boolean usWorkAuthorized,
    Boolean relocateAnywhere,
    List<String> locations
) {}
