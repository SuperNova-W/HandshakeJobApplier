package com.handshook.backend.users;

record UserRecord(
    String id,
    String googleSubject,
    String email,
    String displayName,
    String pictureUrl,
    String authenticatedAt,
    String onboardingCompletedAt,
    String createdAt,
    String updatedAt
) {
    UserDto toDto() {
        return new UserDto(
            id,
            googleSubject,
            email,
            displayName,
            pictureUrl,
            authenticatedAt,
            onboardingCompletedAt,
            createdAt,
            updatedAt
        );
    }
}
