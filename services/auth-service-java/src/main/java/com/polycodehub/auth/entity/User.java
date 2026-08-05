package com.polycodehub.auth.entity;

public record User(Long id, String email, String username, String passwordHash, String role) {}
