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
