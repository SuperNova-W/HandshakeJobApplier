package com.handshook.backend.users;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class UsersService {

    private static final Logger log = LoggerFactory.getLogger(UsersService.class);

    private static final String USER_COLUMNS =
        "id, google_subject, email, display_name, picture_url, authenticated_at, "
            + "onboarding_completed_at, created_at, updated_at";

    private final JdbcTemplate jdbcTemplate;
    private final GoogleProfileVerifier googleProfileVerifier;

    public UsersService(JdbcTemplate jdbcTemplate, GoogleProfileVerifier googleProfileVerifier) {
        this.jdbcTemplate = jdbcTemplate;
        this.googleProfileVerifier = googleProfileVerifier;
    }

    @Transactional
    public UserDto authenticateWithGoogle(String accessToken) {
        GoogleProfileVerifier.GoogleProfile profile = googleProfileVerifier.verify(accessToken);
        String now = Instant.now().toString();

        List<UserDto> existing = findByGoogleSubject(profile.subject());
        String userId;
        if (existing.isEmpty()) {
            userId = UUID.randomUUID().toString();
            jdbcTemplate.update(
                """
                INSERT INTO users (
                    id, google_subject, email, display_name, picture_url,
                    authenticated_at, onboarding_completed_at, created_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)
                """,
                userId,
                profile.subject(),
                profile.email(),
                profile.displayName(),
                profile.pictureUrl(),
                now,
                now,
                now
            );
            log.info("USER_CREATE id={} email={}", userId, profile.email());
        } else {
            userId = existing.get(0).id();
            jdbcTemplate.update(
                """
                UPDATE users
                SET email = ?, display_name = ?, picture_url = ?,
                    authenticated_at = ?, updated_at = ?
                WHERE id = ?
                """,
                profile.email(),
                profile.displayName(),
                profile.pictureUrl(),
                now,
                now,
                userId
            );
            log.info("USER_LOGIN id={} email={}", userId, profile.email());
        }

        jdbcTemplate.update(
            """
            INSERT INTO current_user (id, user_id, updated_at)
            VALUES (1, ?, ?)
            ON CONFLICT(id) DO UPDATE SET user_id = excluded.user_id, updated_at = excluded.updated_at
            """,
            userId,
            now
        );

        return requireUser(userId);
    }

    public Optional<UserDto> getCurrentUser() {
        List<UserDto> users = jdbcTemplate.query(
            "SELECT " + prefixedUserColumns("u") + " FROM current_user c "
                + "JOIN users u ON u.id = c.user_id WHERE c.id = 1",
            UsersService::mapUser
        );
        return users.stream().findFirst();
    }

    @Transactional
    public Optional<UserDto> completeCurrentUserOnboarding() {
        Optional<UserDto> current = getCurrentUser();
        if (current.isEmpty()) {
            return Optional.empty();
        }

        String now = Instant.now().toString();
        jdbcTemplate.update(
            "UPDATE users SET onboarding_completed_at = ?, updated_at = ? WHERE id = ?",
            now,
            now,
            current.get().id()
        );
        log.info("USER_ONBOARDING_COMPLETE id={} email={}", current.get().id(), current.get().email());
        return Optional.of(requireUser(current.get().id()));
    }

    private List<UserDto> findByGoogleSubject(String googleSubject) {
        return jdbcTemplate.query(
            "SELECT " + USER_COLUMNS + " FROM users WHERE google_subject = ?",
            UsersService::mapUser,
            googleSubject
        );
    }

    private UserDto requireUser(String id) {
        return jdbcTemplate.queryForObject(
            "SELECT " + USER_COLUMNS + " FROM users WHERE id = ?",
            UsersService::mapUser,
            id
        );
    }

    private static UserDto mapUser(java.sql.ResultSet rs, int rowNum) throws java.sql.SQLException {
        return new UserDto(
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
    }

    private static String prefixedUserColumns(String alias) {
        return alias + ".id, " + alias + ".google_subject, " + alias + ".email, "
            + alias + ".display_name, " + alias + ".picture_url, "
            + alias + ".authenticated_at, " + alias + ".onboarding_completed_at, "
            + alias + ".created_at, " + alias + ".updated_at";
    }
}
