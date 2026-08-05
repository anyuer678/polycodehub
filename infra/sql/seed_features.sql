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
