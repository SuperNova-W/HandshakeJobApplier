package com.handshook.backend.users;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.SingleConnectionDataSource;
import org.springframework.jdbc.datasource.init.ScriptUtils;

class UsersServiceTests {

    private SingleConnectionDataSource dataSource;
    private JdbcTemplate jdbcTemplate;
    private GoogleProfileVerifier verifier;
    private UsersService service;

    @BeforeEach
    void setUp() throws Exception {
        dataSource = new SingleConnectionDataSource("jdbc:sqlite::memory:", true);
        jdbcTemplate = new JdbcTemplate(dataSource);
        ScriptUtils.executeSqlScript(dataSource.getConnection(), new ClassPathResource("schema.sql"));
        verifier = mock(GoogleProfileVerifier.class);
        service = new UsersService(jdbcTemplate, verifier);
    }

    @AfterEach
    void tearDown() {
        dataSource.destroy();
    }

    @Test
    void googleLoginCreatesCurrentUserAndUpdatesSameRecord() {
        when(verifier.verify("token-1")).thenReturn(
            new GoogleProfileVerifier.GoogleProfile(
                "google-123",
                "person@example.com",
                "First Name",
                "https://example.com/one.png"
            )
        );

        UserDto created = service.authenticateWithGoogle("token-1");

        when(verifier.verify("token-2")).thenReturn(
            new GoogleProfileVerifier.GoogleProfile(
                "google-123",
                "person@example.com",
                "Updated Name",
                "https://example.com/two.png"
            )
        );
        UserDto updated = service.authenticateWithGoogle("token-2");

        assertThat(updated.id()).isEqualTo(created.id());
        assertThat(updated.displayName()).isEqualTo("Updated Name");
        assertThat(updated.pictureUrl()).isEqualTo("https://example.com/two.png");
        assertThat(service.getCurrentUser()).contains(updated);

        Integer count = jdbcTemplate.queryForObject("SELECT COUNT(*) FROM users", Integer.class);
        assertThat(count).isEqualTo(1);
    }

    @Test
    void completingOnboardingPersistsTimestamp() {
        when(verifier.verify("token")).thenReturn(
            new GoogleProfileVerifier.GoogleProfile(
                "google-456",
                "candidate@example.com",
                "Candidate",
                null
            )
        );
        service.authenticateWithGoogle("token");

        UserDto completed = service.completeCurrentUserOnboarding().orElseThrow();

        assertThat(completed.onboardingCompletedAt()).isNotBlank();
        assertThat(service.getCurrentUser().orElseThrow().onboardingCompletedAt())
            .isEqualTo(completed.onboardingCompletedAt());
    }

    @Test
    void noOAuthTokenColumnIsStored() {
        var columns = jdbcTemplate.queryForList("PRAGMA table_info(users)");

        assertThat(columns)
            .extracting(row -> String.valueOf(row.get("name")))
            .doesNotContain("access_token", "refresh_token", "oauth_token");
    }
}
