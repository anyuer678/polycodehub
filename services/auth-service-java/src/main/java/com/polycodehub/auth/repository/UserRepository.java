package com.polycodehub.auth.repository;

import com.polycodehub.auth.common.Constants;
import com.polycodehub.auth.entity.User;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.List;
import java.util.Optional;

@Repository
public class UserRepository {
    private static final String SELECT_COLUMNS = "id, email, username, password_hash, role";

    private final JdbcTemplate jdbcTemplate;

    public UserRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    public Optional<User> findByEmail(String email) {
        return findBy("email = ?", email);
    }

    public Optional<User> findByUsername(String username) {
        return findBy("username = ?", username);
    }

    public User create(String email, String username, String passwordHash) {
        Long id = jdbcTemplate.queryForObject(
                "INSERT INTO users(email, username, password_hash) VALUES (?, ?, ?) RETURNING id",
                Long.class,
                email,
                username,
                passwordHash
        );
        return new User(id, email, username, passwordHash, Constants.ROLE_USER);
    }

    private Optional<User> findBy(String whereClause, String value) {
        List<User> rows = jdbcTemplate.query(
                "SELECT " + SELECT_COLUMNS + " FROM users WHERE " + whereClause,
                new UserRowMapper(),
                value
        );
        return rows.stream().findFirst();
    }

    private static class UserRowMapper implements RowMapper<User> {
        @Override
        public User mapRow(ResultSet rs, int rowNum) throws SQLException {
            return new User(
                    rs.getLong("id"),
                    rs.getString("email"),
                    rs.getString("username"),
                    rs.getString("password_hash"),
                    rs.getString("role")
            );
        }
    }
}
