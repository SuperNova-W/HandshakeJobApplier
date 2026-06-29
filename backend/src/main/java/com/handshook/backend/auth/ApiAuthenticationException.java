package com.handshook.backend.auth;

public class ApiAuthenticationException extends RuntimeException {

    public ApiAuthenticationException(String message) {
        super(message);
    }
}
