package com.handshook.backend.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

class SessionTokenServiceTests {

    private final SessionTokenService service = new SessionTokenService(
        new ObjectMapper(),
        "a-very-long-test-secret-that-is-at-least-thirty-two-characters",
        3600
    );

    @Test
    void issuesAndVerifiesUserToken() {
        String token = service.issue("user-123");

        assertThat(service.verifyAndGetUserId(token)).isEqualTo("user-123");
    }

    @Test
    void rejectsTamperedToken() {
        String token = service.issue("user-123");
        String tampered = token.substring(0, token.length() - 2) + "aa";

        assertThatThrownBy(() -> service.verifyAndGetUserId(tampered))
            .isInstanceOf(ApiAuthenticationException.class);
    }
}
