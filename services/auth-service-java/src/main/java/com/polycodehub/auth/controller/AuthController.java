package com.polycodehub.auth.controller;

import com.polycodehub.auth.common.Constants;
import com.polycodehub.auth.dto.AuthResponse;
import com.polycodehub.auth.dto.LoginRequest;
import com.polycodehub.auth.dto.RegisterRequest;
import com.polycodehub.auth.service.AuthService;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.util.Map;

@RestController
@RequestMapping("/auth")
public class AuthController {

    private final AuthService authService;

    public AuthController(AuthService authService) {
        this.authService = authService;
    }

    @PostMapping("/register")
    public ResponseEntity<AuthResponse> register(@Valid @RequestBody RegisterRequest payload) {
        return ResponseEntity.ok(authService.register(payload));
    }

    @PostMapping("/login")
    public ResponseEntity<AuthResponse> login(@Valid @RequestBody LoginRequest payload) {
        return ResponseEntity.ok(authService.login(payload));
    }

    @GetMapping("/verify")
    public ResponseEntity<Map<String, Object>> verify(
            @RequestHeader(value = "Authorization", required = false) String authorization) {
        if (authorization == null || !authorization.startsWith(Constants.BEARER_PREFIX)) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "missing bearer token");
        }
        String token = authorization.substring(Constants.BEARER_PREFIX.length()).trim();
        return ResponseEntity.ok(authService.verify(token));
    }
}
