package com.handshook.backend.users;

import com.fasterxml.jackson.databind.JsonNode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientResponseException;

@Service
public class GoogleProfileVerifier {

    private static final Logger log = LoggerFactory.getLogger(GoogleProfileVerifier.class);
    private static final String GOOGLE_BASE_URL = "https://www.googleapis.com";

    private final RestClient client;

    public GoogleProfileVerifier() {
        this(
            RestClient.builder()
                .baseUrl(GOOGLE_BASE_URL)
                .build()
        );
    }

    GoogleProfileVerifier(RestClient client) {
        this.client = client;
    }

    public GoogleProfile verify(String accessToken) {
        if (accessToken == null || accessToken.isBlank()) {
            throw new UserAuthenticationException(HttpStatus.UNAUTHORIZED, "A Google access token is required.");
        }

        JsonNode response;
        try {
            response = client.get()
                .uri("/oauth2/v3/userinfo")
                .header(HttpHeaders.AUTHORIZATION, "Bearer " + accessToken.trim())
                .retrieve()
                .body(JsonNode.class);
        } catch (RestClientResponseException ex) {
            log.warn("GOOGLE_USERINFO rejected status={}", ex.getStatusCode());
            throw new UserAuthenticationException(
                HttpStatus.UNAUTHORIZED,
                "Google could not verify this sign-in. Please try signing in again."
            );
        } catch (Exception ex) {
            log.error("GOOGLE_USERINFO unavailable", ex);
            throw new UserAuthenticationException(
                HttpStatus.BAD_GATEWAY,
                "Google sign-in verification is temporarily unavailable."
            );
        }

        String subject = text(response, "sub");
        String email = text(response, "email");
        boolean emailVerified = response != null && response.path("email_verified").asBoolean(false);

        if (subject == null || email == null || !emailVerified) {
            throw new UserAuthenticationException(
                HttpStatus.UNAUTHORIZED,
                "Google did not return a verified account profile."
            );
        }

        return new GoogleProfile(
            subject,
            email,
            text(response, "name"),
            text(response, "picture")
        );
    }

    private static String text(JsonNode node, String field) {
        if (node == null) {
            return null;
        }
        String value = node.path(field).asText("").trim();
        return value.isEmpty() ? null : value;
    }

    public record GoogleProfile(String subject, String email, String displayName, String pictureUrl) {}
}

final class UserAuthenticationException extends RuntimeException {

    private final HttpStatus status;

    UserAuthenticationException(HttpStatus status, String message) {
        super(message);
        this.status = status;
    }

    HttpStatus status() {
        return status;
    }
}
