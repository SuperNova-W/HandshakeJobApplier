package com.handshook.backend.users;

import com.fasterxml.jackson.databind.JsonNode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientResponseException;

@Service
public class GoogleProfileVerifier {

    private static final Logger log = LoggerFactory.getLogger(GoogleProfileVerifier.class);
    private static final String GOOGLE_API_BASE_URL = "https://www.googleapis.com";
    private static final String GOOGLE_OAUTH_BASE_URL = "https://oauth2.googleapis.com";

    private final RestClient oauthClient;
    private final RestClient apiClient;
    private final String expectedClientId;

    @Autowired
    public GoogleProfileVerifier(@Value("${google.oauth.client-id:}") String expectedClientId) {
        this(
            RestClient.builder()
                .baseUrl(GOOGLE_OAUTH_BASE_URL)
                .build(),
            RestClient.builder()
                .baseUrl(GOOGLE_API_BASE_URL)
                .build(),
            expectedClientId
        );
    }

    GoogleProfileVerifier(RestClient oauthClient, RestClient apiClient, String expectedClientId) {
        this.oauthClient = oauthClient;
        this.apiClient = apiClient;
        this.expectedClientId = expectedClientId == null ? "" : expectedClientId.trim();
    }

    public GoogleProfile verify(String accessToken) {
        if (accessToken == null || accessToken.isBlank()) {
            throw new UserAuthenticationException(HttpStatus.UNAUTHORIZED, "A Google access token is required.");
        }
        if (expectedClientId.isBlank()) {
            throw new UserAuthenticationException(
                HttpStatus.SERVICE_UNAVAILABLE,
                "Google sign-in is not configured on the backend. Set GOOGLE_OAUTH_CLIENT_ID and restart."
            );
        }

        String cleanToken = accessToken.trim();
        validateTokenAudience(cleanToken);

        JsonNode response;
        try {
            response = apiClient.get()
                .uri("/oauth2/v3/userinfo")
                .header(HttpHeaders.AUTHORIZATION, "Bearer " + cleanToken)
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

    private void validateTokenAudience(String accessToken) {
        JsonNode tokenInfo;
        try {
            tokenInfo = oauthClient.get()
                .uri(uriBuilder -> uriBuilder
                    .path("/tokeninfo")
                    .queryParam("access_token", accessToken)
                    .build())
                .retrieve()
                .body(JsonNode.class);
        } catch (RestClientResponseException ex) {
            log.warn("GOOGLE_TOKENINFO rejected status={}", ex.getStatusCode());
            throw new UserAuthenticationException(
                HttpStatus.UNAUTHORIZED,
                "Google could not verify this sign-in. Please try signing in again."
            );
        } catch (Exception ex) {
            log.error("GOOGLE_TOKENINFO unavailable", ex);
            throw new UserAuthenticationException(
                HttpStatus.BAD_GATEWAY,
                "Google sign-in verification is temporarily unavailable."
            );
        }

        String audience = text(tokenInfo, "aud");
        if (audience == null) {
            audience = text(tokenInfo, "audience");
        }
        long expiresIn = longValue(tokenInfo, "expires_in");

        if (!expectedClientId.equals(audience) || expiresIn <= 0) {
            log.warn("GOOGLE_TOKENINFO invalid audienceMatch={} expiresIn={}",
                expectedClientId.equals(audience), expiresIn);
            throw new UserAuthenticationException(
                HttpStatus.UNAUTHORIZED,
                "This Google token was not issued for HandShook or has expired."
            );
        }
    }

    private static String text(JsonNode node, String field) {
        if (node == null) {
            return null;
        }
        String value = node.path(field).asText("").trim();
        return value.isEmpty() ? null : value;
    }

    private static long longValue(JsonNode node, String field) {
        if (node == null) {
            return 0;
        }
        JsonNode value = node.path(field);
        if (value.isNumber()) {
            return value.asLong(0);
        }
        try {
            return Long.parseLong(value.asText("0"));
        } catch (NumberFormatException ignored) {
            return 0;
        }
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
