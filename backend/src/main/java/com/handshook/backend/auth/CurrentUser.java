package com.handshook.backend.auth;

import org.springframework.stereotype.Component;

@Component
public class CurrentUser {

    private final ThreadLocal<String> userId = new ThreadLocal<>();

    public String requireUserId() {
        String current = userId.get();
        if (current == null || current.isBlank()) {
            throw new ApiAuthenticationException("Sign in with Google before using HandShook.");
        }
        return current;
    }

    public void setUserId(String value) {
        userId.set(value);
    }

    public void clear() {
        userId.remove();
    }
}
