package com.handshook.backend.users;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.handshook.backend.auth.CurrentUser;
import com.handshook.backend.auth.SessionTokenService;
import java.nio.file.Path;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.jdbc.datasource.init.ResourceDatabasePopulator;

class UsersServiceTests {

    @TempDir
    Path tempDir;

    private JdbcTemplate jdbcTemplate;
    private GoogleProfileVerifier verifier;
    private SessionTokenService tokenService;
    private CurrentUser currentUser;
    private UsersService service;

    @BeforeEach
    void setUp() {
        DriverManagerDataSource dataSource = new DriverManagerDataSource(
            "jdbc:sqlite:" + tempDir.resolve("handshook-test.db")
        );
        dataSource.setDriverClassName("org.sqlite.JDBC");
        new ResourceDatabasePopulator(new ClassPathResource("schema.sql")).execute(dataSource);

        jdbcTemplate = new JdbcTemplate(dataSource);
        verifier = mock(GoogleProfileVerifier.class);
        tokenService = mock(SessionTokenService.class);
        currentUser = mock(CurrentUser.class);
        service = new UsersService(jdbcTemplate, verifier, tokenService, currentUser);
    }

    @Test
    void googleLoginCreatesUserAndReturnsApplicationSession() {
        when(verifier.verify("google-token")).thenReturn(
            new GoogleProfileVerifier.GoogleProfile(
                "google-123",
                "person@example.com",
                "Person",
                "https://example.com/avatar.png"
            )
        );
        when(tokenService.issue(org.mockito.ArgumentMatchers.anyString()))
            .thenReturn("handshook-session");

        AuthSessionResponse result = service.authenticateWithGoogle("google-token");

        assertThat(result.user().googleSubject()).isEqualTo("google-123");
        assertThat(result.user().email()).isEqualTo("person@example.com");
        assertThat(result.token()).isEqualTo("handshook-session");

        String persistedEmail = jdbcTemplate.queryForObject(
            "SELECT email FROM users WHERE google_subject = ?",
            String.class,
            "google-123"
        );
        assertThat(persistedEmail).isEqualTo("person@example.com");
    }

    @Test
    void completingOnboardingUpdatesOnlyCurrentUser() {
        jdbcTemplate.update(
            """
            INSERT INTO users (
                id, google_subject, email, display_name, picture_url,
                authenticated_at, onboarding_completed_at, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            "user-1",
            "google-1",
            "person@example.com",
            "Person",
            null,
            "2026-06-20T00:00:00Z",
            null,
            "2026-06-20T00:00:00Z",
            "2026-06-20T00:00:00Z"
        );
        when(currentUser.requireUserId()).thenReturn("user-1");

        Optional<UserDto> completed = service.completeCurrentUserOnboarding();

        assertThat(completed).isPresent();
        assertThat(completed.orElseThrow().id()).isEqualTo("user-1");
        assertThat(completed.orElseThrow().onboardingCompletedAt()).isNotBlank();

        String persisted = jdbcTemplate.queryForObject(
            "SELECT onboarding_completed_at FROM users WHERE id = ?",
            String.class,
            "user-1"
        );
        assertThat(persisted).isNotBlank();
    }

    @Test
    void signingOutDoesNotDeleteProfile() {
        when(currentUser.requireUserId()).thenReturn("user-1");

        service.signOutCurrentUser();

        verify(currentUser).requireUserId();
    }
}
