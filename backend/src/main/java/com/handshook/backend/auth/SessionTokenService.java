package com.handshook.backend.auth;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Instant;
import java.util.Base64;
import java.util.Map;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

@Service
public class SessionTokenService {

    private static final Logger log = LoggerFactory.getLogger(SessionTokenService.class);
    private static final Base64.Encoder ENCODER = Base64.getUrlEncoder().withoutPadding();
    private static final Base64.Decoder DECODER = Base64.getUrlDecoder();

    private final ObjectMapper objectMapper;
    private final byte[] secret;
    private final long ttlSeconds;

    public SessionTokenService(
        ObjectMapper objectMapper,
        @Value("${auth.token.secret:}") String configuredSecret,
        @Value("${auth.token.ttl-seconds:2592000}") long ttlSeconds
    ) {
        this.objectMapper = objectMapper;
        this.ttlSeconds = Math.max(300, ttlSeconds);

        if (configuredSecret == null || configuredSecret.isBlank()) {
            byte[] generated = new byte[48];
            new SecureRandom().nextBytes(generated);
            this.secret = generated;
            log.warn("AUTH_TOKEN_SECRET is not configured. Session tokens will be invalidated "
                + "whenever this process restarts.");
        } else {
            this.secret = configuredSecret.trim().getBytes(StandardCharsets.UTF_8);
            if (this.secret.length < 32) {
                throw new IllegalStateException("AUTH_TOKEN_SECRET must contain at least 32 characters.");
            }
        }
    }

    public String issue(String userId) {
        long issuedAt = Instant.now().getEpochSecond();
        String header = encodeJson(Map.of("alg", "HS256", "typ", "JWT"));
        String payload = encodeJson(Map.of(
            "iss", "handshook",
            "sub", userId,
            "iat", issuedAt,
            "exp", issuedAt + ttlSeconds
        ));
        String unsigned = header + "." + payload;
        return unsigned + "." + ENCODER.encodeToString(sign(unsigned));
    }

    public String verifyAndGetUserId(String token) {
        if (token == null || token.isBlank()) {
            throw new ApiAuthenticationException("A HandShook session token is required.");
        }

        String[] parts = token.trim().split("\\.");
        if (parts.length != 3) {
            throw invalidToken();
        }

        String unsigned = parts[0] + "." + parts[1];
        byte[] suppliedSignature;
        try {
            suppliedSignature = DECODER.decode(parts[2]);
        } catch (IllegalArgumentException exception) {
            throw invalidToken();
        }
        if (!MessageDigest.isEqual(sign(unsigned), suppliedSignature)) {
            throw invalidToken();
        }

        try {
            JsonNode payload = objectMapper.readTree(DECODER.decode(parts[1]));
            String issuer = payload.path("iss").asText("");
            String userId = payload.path("sub").asText("").trim();
            long expiresAt = payload.path("exp").asLong(0);
            if (!"handshook".equals(issuer)
                || userId.isEmpty()
                || expiresAt <= Instant.now().getEpochSecond()) {
                throw invalidToken();
            }
            return userId;
        } catch (ApiAuthenticationException exception) {
            throw exception;
        } catch (Exception exception) {
            throw invalidToken();
        }
    }

    private String encodeJson(Map<String, Object> value) {
        try {
            return ENCODER.encodeToString(objectMapper.writeValueAsBytes(value));
        } catch (Exception exception) {
            throw new IllegalStateException("Could not create a HandShook session token.", exception);
        }
    }

    private byte[] sign(String unsigned) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(secret, "HmacSHA256"));
            return mac.doFinal(unsigned.getBytes(StandardCharsets.UTF_8));
        } catch (Exception exception) {
            throw new IllegalStateException("Could not sign a HandShook session token.", exception);
        }
    }

    private static ApiAuthenticationException invalidToken() {
        return new ApiAuthenticationException("Your HandShook session has expired. Sign in again.");
    }
}
