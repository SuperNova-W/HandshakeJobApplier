package com.handshook.backend.auth;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.HttpHeaders;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;

@Component
public class SessionAuthenticationInterceptor implements HandlerInterceptor {

    private final SessionTokenService tokenService;
    private final CurrentUser currentUser;

    public SessionAuthenticationInterceptor(
        SessionTokenService tokenService,
        CurrentUser currentUser
    ) {
        this.tokenService = tokenService;
        this.currentUser = currentUser;
    }

    @Override
    public boolean preHandle(
        HttpServletRequest request,
        HttpServletResponse response,
        Object handler
    ) {
        if ("OPTIONS".equalsIgnoreCase(request.getMethod())) {
            return true;
        }

        String authorization = request.getHeader(HttpHeaders.AUTHORIZATION);
        if (authorization == null
            || !authorization.regionMatches(true, 0, "Bearer ", 0, 7)) {
            throw new ApiAuthenticationException("Sign in with Google before using HandShook.");
        }

        currentUser.setUserId(tokenService.verifyAndGetUserId(authorization.substring(7).trim()));
        return true;
    }

    @Override
    public void afterCompletion(
        HttpServletRequest request,
        HttpServletResponse response,
        Object handler,
        Exception exception
    ) {
        currentUser.clear();
    }
}
