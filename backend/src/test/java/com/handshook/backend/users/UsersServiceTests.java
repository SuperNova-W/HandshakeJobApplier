package com.handshook.backend.users;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.handshook.backend.auth.SessionTokenService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class UsersServiceTests {

    private GoogleProfileVerifier verifier;
    private SessionTokenService tokenService;
    private UsersService service;

    @BeforeEach
    void setUp() {
        verifier = mock(GoogleProfileVerifier.class);
        tokenService = mock(SessionTokenService.class);
        service = new UsersService(verifier, tokenService);
    }

    @Test
    void googleLoginReturnsProfileAndApplicationSession() {
        when(verifier.verify("google-token")).thenReturn(
            new GoogleProfileVerifier.GoogleProfile(
                "google-123",
                "person@example.com",
                "Person",
                "https://example.com/avatar.png"
            )
        );
        when(tokenService.issue("google-123")).thenReturn("handshook-session");

        AuthSessionResponse result = service.authenticateWithGoogle("google-token");

        assertThat(result.user().id()).isEqualTo("google-123");
        assertThat(result.user().googleSubject()).isEqualTo("google-123");
        assertThat(result.user().email()).isEqualTo("person@example.com");
        assertThat(result.user().displayName()).isEqualTo("Person");
        assertThat(result.user().pictureUrl()).isEqualTo("https://example.com/avatar.png");
        assertThat(result.user().authenticatedAt()).isNotBlank();
        assertThat(result.token()).isEqualTo("handshook-session");
    }

    @Test
    void sessionSubjectIsTheGoogleSubjectSoRateLimitingScopesPerAccount() {
        when(verifier.verify("google-token")).thenReturn(
            new GoogleProfileVerifier.GoogleProfile("google-456", "p2@example.com", null, null)
        );
        when(tokenService.issue("google-456")).thenReturn("session-2");

        AuthSessionResponse result = service.authenticateWithGoogle("google-token");

        assertThat(result.token()).isEqualTo("session-2");
        assertThat(result.user().displayName()).isNull();
        assertThat(result.user().pictureUrl()).isNull();
    }
}
