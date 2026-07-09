package com.handshook.backend.users;

import com.handshook.backend.auth.SessionTokenService;
import java.time.Instant;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

@Service
public class UsersService {

    private static final Logger log = LoggerFactory.getLogger(UsersService.class);

    private final GoogleProfileVerifier googleProfileVerifier;
    private final SessionTokenService sessionTokenService;

    public UsersService(
        GoogleProfileVerifier googleProfileVerifier,
        SessionTokenService sessionTokenService
    ) {
        this.googleProfileVerifier = googleProfileVerifier;
        this.sessionTokenService = sessionTokenService;
    }

    // Stateless: the verified Google profile IS the user. The extension keeps the
    // profile in chrome.storage.local; the backend stores nothing. The session
    // token's subject is the Google subject, which scopes rate limiting.
    public AuthSessionResponse authenticateWithGoogle(String accessToken) {
        GoogleProfileVerifier.GoogleProfile profile = googleProfileVerifier.verify(accessToken);
        UserDto user = new UserDto(
            profile.subject(),
            profile.subject(),
            profile.email(),
            profile.displayName(),
            profile.pictureUrl(),
            Instant.now().toString()
        );
        log.info("USER_LOGIN subject={}", user.googleSubject());
        return new AuthSessionResponse(user, sessionTokenService.issue(user.id()));
    }
}
