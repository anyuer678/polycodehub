package com.polycodehub.auth.service;

import com.polycodehub.auth.common.Constants;
import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.SignatureAlgorithm;
import io.jsonwebtoken.security.Keys;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Date;
import java.util.Map;

@Service
public class JwtService {
    private static final SignatureAlgorithm ALGORITHM = SignatureAlgorithm.HS256;

    private final SecretKey secretKey;
    private final long expirationSeconds;

    public JwtService(
            @Value("${auth.jwt.secret}") String secret,
            @Value("${auth.jwt.expiration-seconds}") long expirationSeconds
    ) {
        if (secret == null || secret.isBlank()) {
            throw new IllegalArgumentException("AUTH_JWT_SECRET environment variable is required");
        }
        if (secret.contains("replace-with") || secret.length() < 32) {
            throw new IllegalArgumentException("AUTH_JWT_SECRET must be a secure random string (at least 32 characters)");
        }
        this.secretKey = Keys.hmacShaKeyFor(secret.getBytes(StandardCharsets.UTF_8));
        this.expirationSeconds = expirationSeconds;
    }

    public String generateToken(Long userId, String email, String username, String role) {
        Instant now = Instant.now();
        Instant exp = now.plusSeconds(expirationSeconds);

        return Jwts.builder()
                .issuer(Constants.JWT_ISSUER)
                .claims(Map.of(
                        "uid", userId,
                        "email", email,
                        "username", username,
                        "role", role != null ? role : Constants.ROLE_USER
                ))
                .subject(String.valueOf(userId))
                .issuedAt(Date.from(now))
                .expiration(Date.from(exp))
                .signWith(secretKey, ALGORITHM)
                .compact();
    }

    public Map<String, Object> parseToken(String token) {
        try {
            Claims claims = Jwts.parser()
                    .verifyWith(secretKey)
                    .requireIssuer(Constants.JWT_ISSUER)
                    .build()
                    .parseSignedClaims(token)
                    .getPayload();

            Object uidRaw = claims.get("uid");
            if (!(uidRaw instanceof Number)) {
                throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "invalid token: missing uid");
            }
            long uid = ((Number) uidRaw).longValue();
            Object email = claims.get("email");
            Object username = claims.get("username");
            Object roleRaw = claims.get("role");
            Object sub = claims.getSubject();
            Object exp = claims.getExpiration() != null ? claims.getExpiration().toInstant().getEpochSecond() : null;

            return Map.of(
                    "uid", uid,
                    "email", email != null ? email : "",
                    "username", username != null ? username : "",
                    "role", roleRaw != null ? roleRaw : Constants.ROLE_USER,
                    "sub", sub != null ? sub : String.valueOf(uid),
                    "exp", exp != null ? exp : 0L
            );
        } catch (ResponseStatusException e) {
            throw e;
        } catch (Exception e) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "invalid token");
        }
    }
}
