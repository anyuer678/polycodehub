package com.polycodehub.auth.service;

import com.polycodehub.auth.dto.AuthResponse;
import com.polycodehub.auth.dto.LoginRequest;
import com.polycodehub.auth.dto.RegisterRequest;
import com.polycodehub.auth.entity.User;
import com.polycodehub.auth.repository.UserRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.util.Map;

@Service
public class AuthService {
    private static final Logger log = LoggerFactory.getLogger(AuthService.class);

    private final UserRepository userRepository;
    private final JwtService jwtService;
    private final PasswordEncoder passwordEncoder;

    public AuthService(UserRepository userRepository, JwtService jwtService, PasswordEncoder passwordEncoder) {
        this.userRepository = userRepository;
        this.jwtService = jwtService;
        this.passwordEncoder = passwordEncoder;
    }

    @Transactional
    public AuthResponse register(RegisterRequest req) {
        // 前置检查给出友好 409；DB 的 UNIQUE 约束作为并发兜底，
        // 捕获 DataIntegrityViolationException 转为业务 409 而非 500。
        if (userRepository.findByEmail(req.getEmail()).isPresent()) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "email already exists");
        }
        if (userRepository.findByUsername(req.getUsername()).isPresent()) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "username already exists");
        }

        String hashed = passwordEncoder.encode(req.getPassword());
        User user;
        try {
            user = userRepository.create(req.getEmail(), req.getUsername(), hashed);
        } catch (DataIntegrityViolationException ex) {
            // 并发场景下两个请求同时通过前置检查，DB 唯一约束拒绝其中一个
            String msg = ex.getMostSpecificCause().getMessage();
            if (msg != null && msg.contains("users_email_key")) {
                throw new ResponseStatusException(HttpStatus.CONFLICT, "email already exists");
            }
            if (msg != null && msg.contains("users_username_key")) {
                throw new ResponseStatusException(HttpStatus.CONFLICT, "username already exists");
            }
            throw new ResponseStatusException(HttpStatus.CONFLICT, "duplicate user");
        }
        String token = jwtService.generateToken(user.id(), user.email(), user.username(), user.role());
        log.info("register success: email={}, userId={}", req.getEmail(), user.id());
        return new AuthResponse("register success", token, toView(user));
    }

    public AuthResponse login(LoginRequest req) {
        User user = userRepository.findByEmail(req.getEmail())
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.UNAUTHORIZED, "invalid credentials"));

        if (!passwordEncoder.matches(req.getPassword(), user.passwordHash())) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "invalid credentials");
        }

        String token = jwtService.generateToken(user.id(), user.email(), user.username(), user.role());
        log.info("login success: email={}, userId={}", req.getEmail(), user.id());
        return new AuthResponse("login success", token, toView(user));
    }

    public Map<String, Object> verify(String token) {
        var claims = jwtService.parseToken(token);
        return Map.of(
                "valid", true,
                "claims", claims
        );
    }

    private AuthResponse.UserView toView(User user) {
        return new AuthResponse.UserView(user.id(), user.email(), user.username(), user.role());
    }
}
