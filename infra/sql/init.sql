-- PolyCodeHub initial schema

CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  username VARCHAR(100) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(20) NOT NULL DEFAULT 'user',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_role CHECK (role IN ('user', 'teacher', 'admin'))
);

CREATE TABLE IF NOT EXISTS problems (
  id BIGSERIAL PRIMARY KEY,
  title VARCHAR(255) NOT NULL UNIQUE,
  difficulty VARCHAR(20) NOT NULL,
  description TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_difficulty CHECK (difficulty IN ('EASY', 'MEDIUM', 'HARD'))
);

CREATE TABLE IF NOT EXISTS test_cases (
  id BIGSERIAL PRIMARY KEY,
  problem_id BIGINT NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  input_data TEXT NOT NULL,
  expected_output TEXT NOT NULL,
  is_sample BOOLEAN NOT NULL DEFAULT FALSE,
  CONSTRAINT uq_problem_input UNIQUE (problem_id, input_data)
);

CREATE TABLE IF NOT EXISTS submissions (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  problem_id BIGINT NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  language VARCHAR(30) NOT NULL,
  source_code TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  runtime_ms INT,
  memory_kb INT,
  error_message TEXT,
  failed_case_input TEXT,
  expected_output TEXT,
  actual_output TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_submission_status CHECK (status IN ('PENDING', 'AC', 'WA', 'CE', 'RE', 'TLE', 'MLE')),
  CONSTRAINT chk_submission_language CHECK (language IN ('python', 'javascript', 'java', 'cpp', 'c', 'go', 'rust'))
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGSERIAL PRIMARY KEY,
  action VARCHAR(100) NOT NULL,
  actor_user_id BIGINT,
  actor_username VARCHAR(100),
  resource_type VARCHAR(50) NOT NULL,
  resource_id VARCHAR(100),
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_submissions_user_id ON submissions(user_id);
CREATE INDEX IF NOT EXISTS idx_submissions_problem_id ON submissions(problem_id);
CREATE INDEX IF NOT EXISTS idx_submissions_status ON submissions(status);
CREATE INDEX IF NOT EXISTS idx_submissions_created_at ON submissions(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_user_id ON audit_logs(actor_user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_problems_updated_at
  BEFORE UPDATE ON problems
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_submissions_updated_at
  BEFORE UPDATE ON submissions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

INSERT INTO problems(title, difficulty, description)
VALUES
('Two Sum', 'EASY', 'Given an integer array nums and an integer target, return indices of the two numbers that add up to target. Input: first line is the array like [3,2,4], second line is the target. Multiple cases are separated by blank lines. Output one pair of indices per case.'),
('Longest Substring Without Repeating Characters', 'MEDIUM', 'Given a string s, find the length of the longest substring without repeating characters.'),
('Number of Islands', 'MEDIUM', 'Given an m x n 2D binary grid grid which represents a map of 1s (land) and 0s (water), return the number of islands.'),
('Course Schedule', 'MEDIUM', 'There are a total of numCourses courses you have to take, labeled from 0 to numCourses - 1.')
ON CONFLICT (title) DO NOTHING;

INSERT INTO test_cases(problem_id, input_data, expected_output, is_sample)
SELECT p.id, t.input_data, t.expected_output, t.is_sample
FROM (VALUES
  ('Two Sum', E'[2,7,11,15]\n9', '[0,1]', true),
  ('Two Sum', E'[3,2,4]\n6', '[1,2]', false),
  ('Longest Substring Without Repeating Characters', 'abcabcbb', '3', true),
  ('Longest Substring Without Repeating Characters', 'bbbbb', '1', false)
) AS t(title, input_data, expected_output, is_sample)
JOIN problems p ON p.title = t.title
ON CONFLICT (problem_id, input_data) DO NOTHING;
-- 题库扩充：补充既有题目输入格式与用例，新增 10 道题

UPDATE problems SET description = $d$Given a string s, find the length of the longest substring without repeating characters.

输入格式：一行字符串 s。
输出格式：最长无重复字符子串的长度（整数）。

示例：
输入 bbbbb，输出 1
输入 abcabcbb，输出 3$d$ WHERE id = 2;

UPDATE problems SET description = $d$Given an m x n 2D binary grid which represents a map of 1s (land) and 0s (water), return the number of islands. An island is surrounded by water and is formed by connecting adjacent lands horizontally or vertically.

输入格式：第一行两个整数 m n（空格分隔），接下来 m 行，每行是一个长度为 n 的 01 字符串（1=陆地，0=水域）。
输出格式：岛屿数量（整数）。

示例：
输入：
4 5
11000
11000
00100
00011
输出 3$d$ WHERE id = 3;

UPDATE problems SET description = $d$There are a total of numCourses courses you have to take, labeled from 0 to numCourses - 1. Some courses may have prerequisites. Return true if you can finish all courses.

输入格式：第一行整数 numCourses；第二行整数 k（依赖关系数量）；接下来 k 行，每行两个整数 a b（表示课程 a 依赖课程 b，即必须先修 b）。
输出格式：true 或 false。

示例：
输入：
2
1
1 0
输出 true
输入：
2
2
1 0
0 1
输出 false（存在环）$d$ WHERE id = 4;

INSERT INTO test_cases (problem_id, input_data, expected_output, is_sample) VALUES
(3, E'4 5\n11000\n11000\n00100\n00011', '3', true),
(3, E'1 1\n0', '0', false),
(3, E'3 3\n111\n010\n111', '1', false),
(4, E'2\n1\n1 0', 'true', true),
(4, E'2\n2\n1 0\n0 1', 'false', false),
(4, E'4\n3\n1 0\n2 1\n3 2', 'true', false);

INSERT INTO problems (title, difficulty, description) VALUES
('反转字符串', 'EASY', $d$给定一个字符串，将其反转后输出。

输入格式：一行字符串（不含空格）。
输出格式：反转后的字符串。

示例：输入 hello，输出 olleh$d$),
('有效括号', 'EASY', $d$给定一个只包含括号字符 ( ) [ ] { } 的字符串，判断括号是否有效匹配（括号必须按正确顺序闭合）。

输入格式：一行括号字符串。
输出格式：true 或 false。

示例：输入 () 输出 true；输入 ([)] 输出 false$d$),
('爬楼梯', 'EASY', $d$假设你正在爬楼梯，需要 n 阶才能到达楼顶。每次可以爬 1 或 2 个台阶，计算有多少种不同的方法可以爬到楼顶。

输入格式：一行整数 n（1 <= n <= 45）。
输出格式：方法总数（整数）。

示例：输入 3，输出 3$d$),
('回文数', 'EASY', $d$给定一个整数，判断它是否是回文数。回文数是指正序（从左向右）和倒序（从右向左）读都一样。

输入格式：一行整数（可能为负）。
输出格式：true 或 false。

示例：输入 121 输出 true；输入 -121 输出 false$d$),
('只出现一次的数字', 'EASY', $d$给定一个非空整数数组，除某个元素只出现一次外，其余每个元素均出现两次。找出那个只出现一次的元素。

输入格式：一行 JSON 数组，如 [2,2,1]。
输出格式：只出现一次的数字。

示例：输入 [2,2,1] 输出 1；输入 [4,1,2,1,2] 输出 4$d$),
('判断素数', 'EASY', $d$给定一个正整数，判断它是否为素数（质数）。素数指大于 1 且只能被 1 和自身整除的自然数。

输入格式：一行整数 n（1 <= n <= 100000）。
输出格式：true 或 false。

示例：输入 7 输出 true；输入 1 输出 false$d$),
('斐波那契数', 'EASY', $d$斐波那契数列由 F(0)=0, F(1)=1, F(n)=F(n-1)+F(n-2) 定义。给定 n，求 F(n)。

输入格式：一行整数 n（0 <= n <= 40）。
输出格式：F(n)（整数）。

示例：输入 10 输出 55$d$),
('最大子数组和', 'MEDIUM', $d$给定一个整数数组 nums，找出一个具有最大和的连续子数组（子数组最少包含一个元素），返回其最大和。

输入格式：一行 JSON 数组，如 [-2,1,-3,4,-1,2,1,-5,4]。
输出格式：最大子数组和（整数）。

示例：输入 [-2,1,-3,4,-1,2,1,-5,4] 输出 6$d$),
('买卖股票的最佳时机', 'MEDIUM', $d$给定一个数组 prices，prices[i] 表示第 i 天某支股票的价格。只能选择某一天买入，并在之后的某一天卖出，计算能获得的最大利润。如果不能获得任何利润，返回 0。

输入格式：一行 JSON 数组，如 [7,1,5,3,6,4]。
输出格式：最大利润（整数）。

示例：输入 [7,1,5,3,6,4] 输出 5；输入 [7,6,4,3,1] 输出 0$d$),
('整数反转', 'MEDIUM', $d$给定一个有符号 32 位整数 x，将 x 中的数字反转。如果反转后超出 32 位有符号整数范围则返回 0（本题数据不会触发溢出）。

输入格式：一行整数。
输出格式：反转后的整数。

示例：输入 123 输出 321；输入 -123 输出 -321；输入 120 输出 21$d$);

INSERT INTO test_cases (problem_id, input_data, expected_output, is_sample) VALUES
((SELECT id FROM problems WHERE title = '反转字符串'), 'hello', 'olleh', true),
((SELECT id FROM problems WHERE title = '反转字符串'), 'PolyCodeHub', 'buHedoCyloP', false),
((SELECT id FROM problems WHERE title = '反转字符串'), 'racecar', 'racecar', false),
((SELECT id FROM problems WHERE title = '有效括号'), '()', 'true', true),
((SELECT id FROM problems WHERE title = '有效括号'), '()[]{}', 'true', false),
((SELECT id FROM problems WHERE title = '有效括号'), '([)]', 'false', false),
((SELECT id FROM problems WHERE title = '有效括号'), '{[]}', 'true', false),
((SELECT id FROM problems WHERE title = '爬楼梯'), '1', '1', true),
((SELECT id FROM problems WHERE title = '爬楼梯'), '3', '3', false),
((SELECT id FROM problems WHERE title = '爬楼梯'), '10', '89', false),
((SELECT id FROM problems WHERE title = '回文数'), '121', 'true', true),
((SELECT id FROM problems WHERE title = '回文数'), '-121', 'false', false),
((SELECT id FROM problems WHERE title = '回文数'), '12321', 'true', false),
((SELECT id FROM problems WHERE title = '只出现一次的数字'), '[2,2,1]', '1', true),
((SELECT id FROM problems WHERE title = '只出现一次的数字'), '[4,1,2,1,2]', '4', false),
((SELECT id FROM problems WHERE title = '只出现一次的数字'), '[1]', '1', false),
((SELECT id FROM problems WHERE title = '判断素数'), '7', 'true', true),
((SELECT id FROM problems WHERE title = '判断素数'), '1', 'false', false),
((SELECT id FROM problems WHERE title = '判断素数'), '97', 'true', false),
((SELECT id FROM problems WHERE title = '斐波那契数'), '10', '55', true),
((SELECT id FROM problems WHERE title = '斐波那契数'), '0', '0', false),
((SELECT id FROM problems WHERE title = '斐波那契数'), '1', '1', false),
((SELECT id FROM problems WHERE title = '最大子数组和'), '[-2,1,-3,4,-1,2,1,-5,4]', '6', true),
((SELECT id FROM problems WHERE title = '最大子数组和'), '[1]', '1', false),
((SELECT id FROM problems WHERE title = '最大子数组和'), '[-1]', '-1', false),
((SELECT id FROM problems WHERE title = '最大子数组和'), '[5,4,-1,7,8]', '23', false),
((SELECT id FROM problems WHERE title = '买卖股票的最佳时机'), '[7,1,5,3,6,4]', '5', true),
((SELECT id FROM problems WHERE title = '买卖股票的最佳时机'), '[7,6,4,3,1]', '0', false),
((SELECT id FROM problems WHERE title = '买卖股票的最佳时机'), '[2,4,1]', '2', false),
((SELECT id FROM problems WHERE title = '整数反转'), '123', '321', true),
((SELECT id FROM problems WHERE title = '整数反转'), '-123', '-321', false),
((SELECT id FROM problems WHERE title = '整数反转'), '120', '21', false);

-- 功能扩充：题目标签、收藏表、新增 8 道题（含 HARD）

ALTER TABLE problems ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS favorites (
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  problem_id BIGINT NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, problem_id)
);

INSERT INTO problems (title, difficulty, description) VALUES
('合并两个有序数组', 'EASY', $d$给定两个按非递减顺序排列的整数数组 nums1 和 nums2，将两个数组合并为一个新的有序数组并返回。

输入格式：两行，每行一个 JSON 数组。
输出格式：合并后的 JSON 数组。

示例：
输入：
[1,2,3]
[2,5,6]
输出 [1,2,2,3,5,6]$d$),
('两数之和 II - 输入有序数组', 'EASY', $d$给定一个按非递减顺序排列的整数数组 numbers 和一个整数 target，找出两个数使其和等于 target，返回它们的下标（从 0 开始）。

输入格式：第一行一个 JSON 数组，第二行整数 target。保证恰好有一个解。
输出格式：JSON 数组 [i, j]。

示例：
输入：
[2,7,11,15]
9
输出 [0,1]$d$),
('盛最多水的容器', 'MEDIUM', $d$给定一个长度为 n 的整数数组 height，height[i] 表示第 i 条垂直线的高度。找出两条线，使它们与 x 轴共同构成的容器可以容纳最多的水，返回最大水量。

输入格式：一行 JSON 数组。
输出格式：最大水量（整数）。

示例：输入 [1,8,6,2,5,4,8,3,7] 输出 49$d$),
('最长递增子序列', 'MEDIUM', $d$给定一个整数数组 nums，找到其中最长的严格递增子序列的长度。

输入格式：一行 JSON 数组。
输出格式：最长递增子序列长度（整数）。

示例：输入 [10,9,2,5,3,7,101,18] 输出 4$d$),
('最长连续序列', 'MEDIUM', $d$给定一个未排序的整数数组 nums，找出数字连续的最长序列的长度（要求 O(n) 复杂度）。

输入格式：一行 JSON 数组。
输出格式：最长连续序列长度（整数）。

示例：输入 [100,4,200,1,3,2] 输出 4$d$),
('编辑距离', 'HARD', $d$给定两个字符串 word1 和 word2，返回将 word1 转换成 word2 所使用的最少操作数。可以对一个字符串进行：插入一个字符、删除一个字符、替换一个字符。

输入格式：两行，每行一个字符串（不含空格）。
输出格式：最少操作数（整数）。

示例：
输入：
horse
ros
输出 3$d$),
('接雨水', 'HARD', $d$给定 n 个非负整数表示每个宽度为 1 的柱子的高度图，计算按此排列的柱子下雨之后能接多少雨水。

输入格式：一行 JSON 数组。
输出格式：接雨水总量（整数）。

示例：输入 [0,1,0,2,1,0,1,3,2,1,2,1] 输出 6$d$),
('滑动窗口最大值', 'HARD', $d$给定一个整数数组 nums 和一个大小为 k 的滑动窗口，窗口从数组最左端滑动到最右端，每次移动一格，返回滑动窗口中的最大值数组。

输入格式：第一行一个 JSON 数组，第二行整数 k（1 <= k <= 数组长度）。
输出格式：JSON 数组，每个窗口的最大值按序排列。

示例：
输入：
[1,3,-1,-3,5,3,6,7]
3
输出 [3,3,5,5,6,7]$d$);

INSERT INTO test_cases (problem_id, input_data, expected_output, is_sample) VALUES
((SELECT id FROM problems WHERE title = '合并两个有序数组'), E'[1,2,3]\n[2,5,6]', '[1,2,2,3,5,6]', true),
((SELECT id FROM problems WHERE title = '合并两个有序数组'), E'[0]\n[1]', '[0,1]', false),
((SELECT id FROM problems WHERE title = '合并两个有序数组'), E'[1,1]\n[1,1]', '[1,1,1,1]', false),
((SELECT id FROM problems WHERE title = '两数之和 II - 输入有序数组'), E'[2,7,11,15]\n9', '[0,1]', true),
((SELECT id FROM problems WHERE title = '两数之和 II - 输入有序数组'), E'[1,2,3,4,5]\n9', '[3,4]', false),
((SELECT id FROM problems WHERE title = '两数之和 II - 输入有序数组'), E'[-3,0,3]\n0', '[0,2]', false),
((SELECT id FROM problems WHERE title = '盛最多水的容器'), '[1,8,6,2,5,4,8,3,7]', '49', true),
((SELECT id FROM problems WHERE title = '盛最多水的容器'), '[1,1]', '1', false),
((SELECT id FROM problems WHERE title = '盛最多水的容器'), '[4,3,2,1,4]', '16', false),
((SELECT id FROM problems WHERE title = '最长递增子序列'), '[10,9,2,5,3,7,101,18]', '4', true),
((SELECT id FROM problems WHERE title = '最长递增子序列'), '[7,7,7,7,7]', '1', false),
((SELECT id FROM problems WHERE title = '最长递增子序列'), '[0,1,0,3,2,3]', '4', false),
((SELECT id FROM problems WHERE title = '最长连续序列'), '[100,4,200,1,3,2]', '4', true),
((SELECT id FROM problems WHERE title = '最长连续序列'), '[1,2,0,1]', '3', false),
((SELECT id FROM problems WHERE title = '最长连续序列'), '[0]', '1', false),
((SELECT id FROM problems WHERE title = '编辑距离'), E'horse\nros', '3', true),
((SELECT id FROM problems WHERE title = '编辑距离'), E'intention\nexecution', '5', false),
((SELECT id FROM problems WHERE title = '编辑距离'), E'abc\nabc', '0', false),
((SELECT id FROM problems WHERE title = '接雨水'), '[0,1,0,2,1,0,1,3,2,1,2,1]', '6', true),
((SELECT id FROM problems WHERE title = '接雨水'), '[4,2,0,3,2,5]', '9', false),
((SELECT id FROM problems WHERE title = '接雨水'), '[1,1,1]', '0', false),
((SELECT id FROM problems WHERE title = '滑动窗口最大值'), E'[1,3,-1,-3,5,3,6,7]\n3', '[3,3,5,5,6,7]', true),
((SELECT id FROM problems WHERE title = '滑动窗口最大值'), E'[1]\n1', '[1]', false),
((SELECT id FROM problems WHERE title = '滑动窗口最大值'), E'[1,-1]\n1', '[1,-1]', false);

UPDATE problems SET tags = ARRAY['数组','哈希表'] WHERE title = 'Two Sum';
UPDATE problems SET tags = ARRAY['字符串','滑动窗口'] WHERE title = 'Longest Substring Without Repeating Characters';
UPDATE problems SET tags = ARRAY['数组','矩阵','深度优先搜索'] WHERE title = 'Number of Islands';
UPDATE problems SET tags = ARRAY['图','拓扑排序'] WHERE title = 'Course Schedule';
UPDATE problems SET tags = ARRAY['字符串'] WHERE title = '反转字符串';
UPDATE problems SET tags = ARRAY['字符串','栈'] WHERE title = '有效括号';
UPDATE problems SET tags = ARRAY['动态规划'] WHERE title = '爬楼梯';
UPDATE problems SET tags = ARRAY['数学'] WHERE title = '回文数';
UPDATE problems SET tags = ARRAY['数组','位运算'] WHERE title = '只出现一次的数字';
UPDATE problems SET tags = ARRAY['数学'] WHERE title = '判断素数';
UPDATE problems SET tags = ARRAY['数学','动态规划'] WHERE title = '斐波那契数';
UPDATE problems SET tags = ARRAY['数组','动态规划'] WHERE title = '最大子数组和';
UPDATE problems SET tags = ARRAY['数组','动态规划'] WHERE title = '买卖股票的最佳时机';
UPDATE problems SET tags = ARRAY['数学'] WHERE title = '整数反转';
UPDATE problems SET tags = ARRAY['数组','双指针'] WHERE title = '合并两个有序数组';
UPDATE problems SET tags = ARRAY['数组','双指针','二分查找'] WHERE title = '两数之和 II - 输入有序数组';
UPDATE problems SET tags = ARRAY['数组','双指针','贪心'] WHERE title = '盛最多水的容器';
UPDATE problems SET tags = ARRAY['数组','动态规划','二分查找'] WHERE title = '最长递增子序列';
UPDATE problems SET tags = ARRAY['数组','哈希表'] WHERE title = '最长连续序列';
UPDATE problems SET tags = ARRAY['字符串','动态规划'] WHERE title = '编辑距离';
UPDATE problems SET tags = ARRAY['数组','双指针','栈'] WHERE title = '接雨水';
UPDATE problems SET tags = ARRAY['数组','队列','滑动窗口'] WHERE title = '滑动窗口最大值';

-- 管理员端功能：用户封禁、公告、系统设置（每日一题）、批量导入支持

ALTER TABLE users ADD COLUMN IF NOT EXISTS banned BOOLEAN NOT NULL DEFAULT FALSE;
-- 封号透明化：记录封禁原因与解封时间，使封禁可见、可追溯、可过期自动解封
ALTER TABLE users ADD COLUMN IF NOT EXISTS banned_until TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS ban_reason TEXT;

CREATE TABLE IF NOT EXISTS announcements (
  id BIGSERIAL PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  content TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  pinned BOOLEAN NOT NULL DEFAULT FALSE,
  category VARCHAR(32) NOT NULL DEFAULT 'general',
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 公告增强：置顶/分类/过期时间（兼容已有库）
ALTER TABLE announcements ADD COLUMN IF NOT EXISTS pinned BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE announcements ADD COLUMN IF NOT EXISTS category VARCHAR(32) NOT NULL DEFAULT 'general';
ALTER TABLE announcements ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
-- 公告创建者：追溯发布人，删除用户时置空
ALTER TABLE announcements ADD COLUMN IF NOT EXISTS created_by BIGINT REFERENCES users(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 站内信：管理员向用户推送通知（系统/公告/判题等类型），用户可标记已读
CREATE TABLE IF NOT EXISTS notifications (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type VARCHAR(32) NOT NULL DEFAULT 'system',
  title VARCHAR(255) NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- 站内信发送者：追溯发送人（system 类型可为空），删除用户时置空
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS sender_id BIGINT REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_announcements_active ON announcements (is_active, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_announcements_pinned ON announcements (pinned, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_announcements_category ON announcements (category);
CREATE INDEX IF NOT EXISTS idx_users_banned ON users (banned);
-- 站内信：按用户拉取未读数与列表，按时间倒序
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications (user_id, is_read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON notifications (user_id, created_at DESC);

-- 默认管理员（admin / admin123456，BCrypt hash）——重建环境保证存在
INSERT INTO users(email, username, password_hash, role)
VALUES ('admin@polycodehub.dev', 'admin', '$2a$10$1FuPAmhDh6gLJn6Ik/lvtO4Ccc9RwGlWGpj9Tba29Dicpoe8S97ey', 'admin')
ON CONFLICT (username) DO NOTHING;

-- 新增 10 道题（EASY 7 + MEDIUM 3）
INSERT INTO problems (title, difficulty, description) VALUES
('二分查找', 'EASY', $d$给定一个按升序排列的整数数组 nums（无重复元素）和一个整数 target，返回 target 在数组中的下标；若不存在返回 -1。

输入格式：第一行一个 JSON 数组，第二行整数 target。
输出格式：下标（整数）或 -1。

示例：
输入：
[-1,0,3,5,9,12]
9
输出 4$d$),
('删除有序数组中的重复项', 'EASY', $d$给定一个升序排列的整数数组 nums，原地移除重复元素使每个元素只出现一次，返回新数组的元素个数。

输入格式：一行 JSON 数组。
输出格式：去重后的元素个数（整数）。

例如：输入 [1,1,2] 输出 2；输入 [0,0,1,1,1,2,2,3,3,4] 输出 5$d$),
('多数元素', 'EASY', $d$给定一个大小为 n 的数组，找出其中出现次数大于 n/2 的元素（保证存在）。

输入格式：一行 JSON 数组。
输出格式：多数元素（整数）。

例如：输入 [3,2,3] 输出 3；输入 [2,2,1,1,1,2,2] 输出 2$d$),
('快乐数', 'EASY', $d$编写一个算法判断一个数 n 是不是快乐数。快乐数的定义：对一个正整数反复将每个位置上的数字平方后求和，直到结果为 1（此时是快乐数），或陷入不包含 1 的循环。

输入格式：一行整数。
输出格式：小写 true 或 false。

例如：输入 19 输出 true；输入 2 输出 false；输入 7 输出 true$d$),
('位 1 的个数', 'EASY', $d$给定一个非负整数 n，返回其二进制表示中位为 1 的个数（即汉明重量）。

输入格式：一行整数。
输出格式：1 的个数（整数）。

例如：输入 11（二进制 1011）输出 3；输入 128 输出 1；输入 0 输出 0$d$),
('两个数组的交集', 'EASY', $d$给定两个整数数组 nums1 和 nums2，返回它们的交集，结果中每个元素唯一，升序排列。

输入格式：两行，各为一个 JSON 数组。
输出格式：升序的 JSON 数组（无交集输出 []）。

例如：
输入：
[1,2,2,1]
[2,2]
输出 [2]；输入 [4,9,5] 与 [9,4,9,8,4] 输出 [4,9]$d$),
('最大公约数', 'EASY', $d$给定两个正整数 a 和 b，返回它们的最大公约数（GCD）。

输入格式：一行两个整数，空格分隔。
输出格式：最大公约数（整数）。

例如：输入 12 18 输出 6；输入 7 13 输出 1；输入 100 25 输出 25$d$),
('合并区间', 'MEDIUM', $d$以二维数组 intervals 表示若干闭区间，其中单个区间为 [start_i, end_i]。请合并所有重叠的区间，返回不重叠的二维数组（按起始升序）。

输入格式：一行 JSON 二维数组，如 [[1,3],[2,6],[8,10],[15,18]]。
输出格式：合并后的 JSON 二维数组。

例如：输入 [[1,3],[2,6],[8,10],[15,18]] 输出 [[1,6],[8,10],[15,18]]；输入 [[1,4],[4,5]] 输出 [[1,5]]；输入 [[5,5]] 输出 [[5,5]]$d$),
('旋转数组', 'MEDIUM', $d$给定一个整数数组 nums 和一个非负整数 k，将数组整体向右平移 k 位（周期循环），返回平移后的新数组。

输入格式：第一行 JSON 数组，第二行整数 k。
输出格式：平移后的 JSON 数组。

例如：
输入：
[1,2,3,4,5]
2
输出 [4,5,1,2,3]；k 可为 0 或大于数组长度。$d$),
('杨辉三角', 'MEDIUM', $d$给定非负整数 numRows，生成杨辉三角的前 numRows 行并返回二维数组。

输入格式：一行整数 numRows（0 <= numRows <= 20）。
输出格式：前 numRows 行的 JSON 二维数组。

例如：输入 5 输出 [[1],[1,1],[1,2,1],[1,3,3,1],[1,4,6,4,1]]；输入 1 输出 [[1]]；输入 0 输出 []$d$);

INSERT INTO test_cases (problem_id, input_data, expected_output, is_sample) VALUES
((SELECT id FROM problems WHERE title = '二分查找'), E'[-1,0,3,5,9,9]\n9', '4', true),
((SELECT id FROM problems WHERE title = '二分查找'), E'[-1,0,3,5,9,9]\n2', '-1', false),
((SELECT id FROM problems WHERE title = '二分查找'), E'[5]\n5', '0', false),
((SELECT id FROM problems WHERE title = '删除有序数组中的重复项'), E'[0,0,1,1,1,2,2,3,3,4]', '5', true),
((SELECT id FROM problems WHERE title = '删除有序数组中的重复项'), E'[1]\n0', '1', false),
((SELECT id FROM problems WHERE title = '多数元素'), '[3,2,3]', '3', true),
((SELECT id FROM problems WHERE title = '多数元素'), '[2,2,1,1,1,2,2]', '2', false),
((SELECT id FROM problems WHERE title = '多数元素'), '[1]', '1', false),
((SELECT id FROM problems WHERE title = '快乐数'), '19', 'true', true),
((SELECT id FROM problems WHERE title = '快乐数'), '7', 'true', false),
((SELECT id FROM problems WHERE title = '快乐数'), '20', 'false', false),
((SELECT id FROM problems WHERE title = '位 1 的个数'), '11', '3', true),
((SELECT id FROM problems WHERE title = '位 1 的个数'), '128', '1', false),
((SELECT id FROM problems WHERE title = '位 1 的个数'), '0', '0', false),
((SELECT id FROM problems WHERE title = '两个数组的交集'), E'[1,2,2,1]\n[2,2]', '[2]', true),
((SELECT id FROM problems WHERE title = '两个数组的交集'), E'[4,2,5]\n[9,4,9,2,4]', '[2,4]', false),
((SELECT id FROM problems WHERE title = '两个数组的交集'), E'[1,2,3]\n[4,5]', '[]', false),
((SELECT id FROM problems WHERE title = '最大公约数'), '12 18', '6', true),
((SELECT id FROM problems WHERE title = '最大公约数'), '7 13', '1', false),
((SELECT id FROM problems WHERE title = '最大公约数'), '100 0', '100', false),
((SELECT id FROM problems WHERE title = '合并区间'), E'[[1,2],[2,6],[8,10],[15,18]]\n', '[[1,6],[8,10],[15,18]]', true),
((SELECT id FROM problems WHERE title = '合并区间'), E'[[1,4],[4,5]]\n', '[[1,5]]', false),
((SELECT id FROM problems WHERE title = '合并区间'), '[[5,5]]', '[[5,5]]', false),
((SELECT id FROM problems WHERE title = '旋转数组'), E'[1,2,3,4,5]\n2', '[4,5,1,2,3]', true),
((SELECT id FROM problems WHERE title = '旋转数组'), E'[1,2]\n3', '[2,1]', false),
((SELECT id FROM problems WHERE title = '旋转数组'), E'[1,2,3]\n0', '[1,2,3]', false),
((SELECT id FROM problems WHERE title = '杨辉三角'), '5', '[[1],[1,1],[1,2,1],[1,3,3,1],[1,4,6,4,1]]', true),
((SELECT id FROM problems WHERE title = '杨辉三角'), '1', '[[1]]', false),
((SELECT id FROM problems WHERE title = '杨辉三角'), '0', '[]', false);

-- 功能扩充：试运行、题解、比赛、分享、徽章

CREATE TABLE IF NOT EXISTS contests (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS contest_problems (
  contest_id BIGINT NOT NULL REFERENCES contests(id) ON DELETE CASCADE,
  problem_id BIGINT NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  sort_order INT NOT NULL DEFAULT 0,
  PRIMARY KEY (contest_id, problem_id)
);

ALTER TABLE submissions ADD COLUMN IF NOT EXISTS share_token VARCHAR(64);
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS contest_id BIGINT REFERENCES contests(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_submissions_share_token ON submissions (share_token) WHERE share_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_submissions_contest ON submissions (contest_id, status);
-- S2 修复：AC 计数幂等字段。worker 仅在 (新状态=AC 且 ac_counted=FALSE) 时 increment Redis 并置 TRUE；
-- 状态从 AC 转为非 AC 时 decrement 并置 FALSE。rejudge 重置为 FALSE 由 admin rejudge 接口处理。
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS ac_counted BOOLEAN NOT NULL DEFAULT FALSE;
-- 已 AC 的历史提交置为已计数，避免回填数据触发误 increment
UPDATE submissions SET ac_counted = TRUE WHERE status = 'AC';

CREATE TABLE IF NOT EXISTS runs (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  language VARCHAR(20) NOT NULL,
  source_code TEXT NOT NULL,
  stdin TEXT NOT NULL DEFAULT '',
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  stdout TEXT,
  stderr TEXT,
  runtime_ms INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS solutions (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  problem_id BIGINT NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  content TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_solutions_problem ON solutions (problem_id, status);

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

-- 用户公开主页模块可见性（三态：public 所有人可见 / hidden 所有人隐藏 / self 仅本人可见）
CREATE TABLE IF NOT EXISTS user_profile_modules (
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  module_key TEXT NOT NULL,
  visibility VARCHAR(10) NOT NULL DEFAULT 'public'
    CHECK (visibility IN ('public', 'hidden', 'self')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, module_key)
);

