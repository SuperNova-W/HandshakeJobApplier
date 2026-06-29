package com.handshook.backend.users;

public record AuthSessionResponse(UserDto user, String token) {}
