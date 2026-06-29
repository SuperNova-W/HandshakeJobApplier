package com.handshook.backend.users;

import java.util.Map;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/users")
public class UsersController {

    private final UsersService usersService;

    public UsersController(UsersService usersService) {
        this.usersService = usersService;
    }

    @PostMapping("/google")
    public AuthSessionResponse authenticateGoogle(
        @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization
    ) {
        return usersService.authenticateWithGoogle(bearerToken(authorization));
    }

    @GetMapping("/current")
    public ResponseEntity<UserDto> currentUser() {
        return usersService.getCurrentUser()
            .map(ResponseEntity::ok)
            .orElseGet(() -> ResponseEntity.notFound().build());
    }

    @PutMapping("/current/onboarding")
    public ResponseEntity<UserDto> completeOnboarding() {
        return usersService.completeCurrentUserOnboarding()
            .map(ResponseEntity::ok)
            .orElseGet(() -> ResponseEntity.notFound().build());
    }

    @DeleteMapping("/current")
    public ResponseEntity<Void> signOutCurrentUser() {
        usersService.signOutCurrentUser();
        return ResponseEntity.noContent().build();
    }

    @ExceptionHandler(UserAuthenticationException.class)
    public ResponseEntity<Map<String, String>> handleAuthentication(UserAuthenticationException ex) {
        return ResponseEntity.status(ex.status()).body(Map.of(
            "error", "Google authentication failed",
            "message", ex.getMessage()
        ));
    }

    private static String bearerToken(String authorization) {
        if (authorization == null || !authorization.regionMatches(true, 0, "Bearer ", 0, 7)) {
            throw new UserAuthenticationException(
                org.springframework.http.HttpStatus.UNAUTHORIZED,
                "A Google bearer token is required."
            );
        }
        String token = authorization.substring(7).trim();
        if (token.isEmpty()) {
            throw new UserAuthenticationException(
                org.springframework.http.HttpStatus.UNAUTHORIZED,
                "A Google bearer token is required."
            );
        }
        return token;
    }
}
