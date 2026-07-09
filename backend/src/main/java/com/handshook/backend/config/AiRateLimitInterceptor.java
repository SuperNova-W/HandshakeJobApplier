package com.handshook.backend.config;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.handshook.backend.auth.CurrentUser;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.time.Instant;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;

// Caps how often one signed-in user can hit the OpenAI-backed endpoints, so a
// public deployment can't be used to drain the API key. Fixed one-hour windows
// counted in process memory: each Lambda container (or the single local process)
// keeps its own counts, so the effective global cap is limit × warm containers —
// coarse, but it bounds a single account's spend without needing a database.
@Component
public class AiRateLimitInterceptor implements HandlerInterceptor {

    private static final Logger log = LoggerFactory.getLogger(AiRateLimitInterceptor.class);

    private final CurrentUser currentUser;
    private final ObjectMapper objectMapper;
    private final int hourlyLimit;
    private final ConcurrentHashMap<String, Window> windows = new ConcurrentHashMap<>();

    public AiRateLimitInterceptor(
        CurrentUser currentUser,
        ObjectMapper objectMapper,
        @Value("${app.ai.hourly-limit:30}") int hourlyLimit
    ) {
        this.currentUser = currentUser;
        this.objectMapper = objectMapper;
        this.hourlyLimit = hourlyLimit;
    }

    @Override
    public boolean preHandle(
        HttpServletRequest request,
        HttpServletResponse response,
        Object handler
    ) throws Exception {
        if ("OPTIONS".equalsIgnoreCase(request.getMethod()) || hourlyLimit <= 0) {
            return true;
        }

        long hour = Instant.now().getEpochSecond() / 3600;
        Window window = windows.compute(
            currentUser.requireUserId(),
            (id, existing) -> existing == null || existing.hour != hour
                ? new Window(hour)
                : existing
        );

        if (window.count.incrementAndGet() > hourlyLimit) {
            log.warn("AI_RATE_LIMITED path={}", request.getRequestURI());
            response.setStatus(429);
            response.setContentType(MediaType.APPLICATION_JSON_VALUE);
            objectMapper.writeValue(response.getWriter(), Map.of(
                "error", "Too many requests",
                "message", "You've reached the hourly limit for AI document generation. "
                    + "Please try again in a little while."
            ));
            return false;
        }
        return true;
    }

    private record Window(long hour, AtomicInteger count) {
        Window(long hour) {
            this(hour, new AtomicInteger());
        }
    }
}
