package com.polycodehub.auth.dto;

public record AuthResponse(String message, String token, UserView user) {
    public record UserView(Long id, String email, String username, String role) {}
}
