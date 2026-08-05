"""engine._strip_rusage 的单元测试（标准库 unittest，无外部依赖）。

运行: cd services/judge-service-python && python -m unittest discover -s tests -v
"""
import sys
import unittest

# engine 导入链依赖 psycopg2（本机/CI 可能未安装），stub 掉
class _FakePsycopg2:
    class pool:  # noqa: N801
        ThreadedConnectionPool = object
        SimpleConnectionPool = object

    class extensions:  # noqa: N801
        connection = object


sys.modules.setdefault("psycopg2", _FakePsycopg2())

from app.engine import RealJudgeEngine  # noqa: E402


class StripRusageTest(unittest.TestCase):
    def setUp(self):
        self.engine = RealJudgeEngine()

    def test_parse_and_strip_trailing_marker(self):
        err = "Traceback (most recent call last):\nZeroDivisionError\n__SB_RUSAGE__=8124\n"
        kb, cleaned = self.engine._strip_rusage(err)
        self.assertEqual(kb, 8124)
        self.assertNotIn("__SB_RUSAGE__", cleaned)
        self.assertTrue(cleaned.strip().endswith("ZeroDivisionError"))

    def test_no_marker_returns_none(self):
        kb, cleaned = self.engine._strip_rusage("just some stderr text")
        self.assertIsNone(kb)
        self.assertEqual(cleaned, "just some stderr text")

    def test_marker_in_middle_not_trusted(self):
        # 标记行不在末尾：可能是输出被截断后残留的干扰行，不采信
        err = "line1\n__SB_RUSAGE__=100\nline2\n"
        kb, cleaned = self.engine._strip_rusage(err)
        self.assertIsNone(kb)
        self.assertEqual(cleaned, err)

    def test_truncated_stderr_not_trusted(self):
        # stderr 达到 MAX_OUTPUT_CHARS：末尾标记必然被截断丢失，
        # 最后一行可能是用户伪造行，不采信（回退 _measure）
        from app.engine import MAX_OUTPUT_CHARS

        forged = "__SB_RUSAGE__=999999\n"
        err = "x" * (MAX_OUTPUT_CHARS - len(forged)) + forged
        self.assertEqual(len(err), MAX_OUTPUT_CHARS)
        kb, _ = self.engine._strip_rusage(err)
        self.assertIsNone(kb)

    def test_strips_all_marker_lines(self):
        # 真实标记在末尾：采信，且用户伪造的中间行也被剥离（不污染 RE/CE 输出）
        err = "__SB_RUSAGE__=999\nreal output\n__SB_RUSAGE__=12345\n"
        kb, cleaned = self.engine._strip_rusage(err)
        self.assertEqual(kb, 12345)
        self.assertEqual(cleaned, "real output\n")

    def test_marker_without_trailing_newline(self):
        err = "warn: something\n__SB_RUSAGE__=2048"
        kb, cleaned = self.engine._strip_rusage(err)
        self.assertEqual(kb, 2048)
        self.assertEqual(cleaned, "warn: something\n")

    def test_looks_like_marker_but_not_a_line(self):
        err = "my output starts with __SB_RUSAGE__=1 but continues"
        kb, cleaned = self.engine._strip_rusage(err)
        self.assertIsNone(kb)
        self.assertEqual(cleaned, err)

    def test_empty_stderr(self):
        kb, cleaned = self.engine._strip_rusage("")
        self.assertIsNone(kb)
        self.assertEqual(cleaned, "")


if __name__ == "__main__":
    unittest.main()
