-- 第二十六轮：关注/留言/评论/每日一题结算/教师角色

ALTER TABLE problems ADD COLUMN IF NOT EXISTS created_by BIGINT REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_problems_created_by ON problems (created_by);

CREATE TABLE IF NOT EXISTS follows (
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  follow_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, follow_user_id)
);
CREATE INDEX IF NOT EXISTS idx_follows_follow_user ON follows (follow_user_id);

CREATE TABLE IF NOT EXISTS profile_messages (
  id BIGSERIAL PRIMARY KEY,
  target_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  author_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_profile_messages_target ON profile_messages (target_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS solution_comments (
  id BIGSERIAL PRIMARY KEY,
  solution_id BIGINT NOT NULL REFERENCES solutions(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_solution_comments_solution ON solution_comments (solution_id, created_at ASC);

CREATE TABLE IF NOT EXISTS daily_problems (
  id BIGSERIAL PRIMARY KEY,
  date VARCHAR(10) NOT NULL UNIQUE,
  problem_id BIGINT NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  status VARCHAR(10) NOT NULL DEFAULT 'pending',
  end_type VARCHAR(10),
  ended_at TIMESTAMPTZ,
  ended_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_daily_problems_date ON daily_problems (date DESC);
