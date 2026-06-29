package com.handshook.backend.config;

import com.handshook.backend.auth.SessionAuthenticationInterceptor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

@Configuration
public class WebCorsConfig implements WebMvcConfigurer {

    private final SessionAuthenticationInterceptor authenticationInterceptor;
    private final String allowedOrigin;

    public WebCorsConfig(
        SessionAuthenticationInterceptor authenticationInterceptor,
        @Value("${app.cors.allowed-origin:chrome-extension://*}") String allowedOrigin
    ) {
        this.authenticationInterceptor = authenticationInterceptor;
        this.allowedOrigin = allowedOrigin;
    }

    @Override
    public void addCorsMappings(CorsRegistry registry) {
        registry.addMapping("/api/**")
            .allowedOriginPatterns(allowedOrigin)
            .allowedMethods("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS")
            .allowedHeaders("*");
    }

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(authenticationInterceptor)
            .addPathPatterns("/api/**")
            .excludePathPatterns("/api/health", "/api/users/google");
    }
}
