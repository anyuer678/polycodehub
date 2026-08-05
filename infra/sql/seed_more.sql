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