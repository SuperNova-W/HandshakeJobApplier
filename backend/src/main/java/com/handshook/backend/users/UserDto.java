package com.handshook.backend.users;

public record UserDto(
    String id,
    String googleSubject,
    String email,
    String displayName,
    String pictureUrl,
    String authenticatedAt
) {}
