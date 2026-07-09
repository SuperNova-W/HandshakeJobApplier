package com.handshook.backend.users;

import java.util.Map;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.PostMapping;
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
