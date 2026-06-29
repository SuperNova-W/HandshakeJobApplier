package com.handshook.backend.users;

import com.handshook.backend.auth.CurrentUser;
import com.handshook.backend.auth.SessionTokenService;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Service;

@Service
public class UsersService {

    private static final Logger log = LoggerFactory.getLogger(UsersService.class);

    private static final RowMapper<UserRecord> ROW_MAPPER = (rs, rowNum) -> new UserRecord(
        rs.getString("id"),
        rs.getString("google_subject"),
        rs.getString("email"),
        rs.getString("display_name"),
        rs.getString("picture_url"),
        rs.getString("authenticated_at"),
        rs.getString("onboarding_completed_at"),
        rs.getString("created_at"),
        rs.getString("updated_at")
    );

    private final JdbcTemplate jdbcTemplate;
    private final GoogleProfileVerifier googleProfileVerifier;
    private final SessionTokenService sessionTokenService;
    private final CurrentUser currentUser;

    public UsersService(
        JdbcTemplate jdbcTemplate,
        GoogleProfileVerifier googleProfileVerifier,
        SessionTokenService sessionTokenService,
        CurrentUser currentUser
    ) {
        this.jdbcTemplate = jdbcTemplate;
        this.googleProfileVerifier = googleProfileVerifier;
        this.sessionTokenService = sessionTokenService;
        this.currentUser = currentUser;
    }

    public AuthSessionResponse authenticateWithGoogle(String accessToken) {
        GoogleProfileVerifier.GoogleProfile profile = googleProfileVerifier.verify(accessToken);
        String now = Instant.now().toString();

        UserRecord existing = findByGoogleSubject(profile.subject()).orElse(null);

        UserRecord saved;
        if (existing == null) {
            saved = new UserRecord(
                UUID.randomUUID().toString(),
                profile.subject(),
                profile.email(),
                profile.displayName(),
                profile.pictureUrl(),
                now,
                null,
                now,
                now
            );
            jdbcTemplate.update(
                """
                INSERT INTO users (
                    id, google_subject, email, display_name, picture_url,
                    authenticated_at, onboarding_completed_at, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                saved.id(),
                saved.googleSubject(),
                saved.email(),
                saved.displayName(),
                saved.pictureUrl(),
                saved.authenticatedAt(),
                saved.onboardingCompletedAt(),
                saved.createdAt(),
                saved.updatedAt()
            );
            log.info("USER_CREATE id={} email={}", saved.id(), saved.email());
        } else {
            saved = new UserRecord(
                existing.id(),
                existing.googleSubject(),
                profile.email(),
                profile.displayName(),
                profile.pictureUrl(),
                now,
                existing.onboardingCompletedAt(),
                existing.createdAt(),
                now
            );
            jdbcTemplate.update(
                """
                UPDATE users
                SET email = ?, display_name = ?, picture_url = ?,
                    authenticated_at = ?, updated_at = ?
                WHERE id = ?
                """,
                saved.email(),
                saved.displayName(),
                saved.pictureUrl(),
                saved.authenticatedAt(),
                saved.updatedAt(),
                saved.id()
            );
            log.info("USER_LOGIN id={} email={}", saved.id(), saved.email());
        }

        return new AuthSessionResponse(saved.toDto(), sessionTokenService.issue(saved.id()));
    }

    public Optional<UserDto> getCurrentUser() {
        return findUser(currentUser.requireUserId()).map(UserRecord::toDto);
    }

    public Optional<UserDto> completeCurrentUserOnboarding() {
        String userId = currentUser.requireUserId();
        Optional<UserRecord> current = findUser(userId);
        if (current.isEmpty()) {
            return Optional.empty();
        }

        String now = Instant.now().toString();
        jdbcTemplate.update(
            "UPDATE users SET onboarding_completed_at = ?, updated_at = ? WHERE id = ?",
            now,
            now,
            userId
        );
        UserRecord saved = findUser(userId).orElseThrow();
        log.info("USER_ONBOARDING_COMPLETE id={} email={}", saved.id(), saved.email());
        return Optional.of(saved.toDto());
    }

    public void signOutCurrentUser() {
        log.info("USER_LOGOUT id={}", currentUser.requireUserId());
    }

    private Optional<UserRecord> findByGoogleSubject(String googleSubject) {
        List<UserRecord> rows = jdbcTemplate.query(
            "SELECT * FROM users WHERE google_subject = ?",
            ROW_MAPPER,
            googleSubject
        );
        return rows.stream().findFirst();
    }

    private Optional<UserRecord> findUser(String id) {
        List<UserRecord> rows =
            jdbcTemplate.query("SELECT * FROM users WHERE id = ?", ROW_MAPPER, id);
        return rows.stream().findFirst();
    }
}
