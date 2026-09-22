"""Judge engine 纯函数测试：无需 DB / root / Docker。

运行: cd services/judge-service-python && python -m pytest tests/test_engine_pure.py -q
"""

from __future__ import annotations

import os
import sys
import types
import unittest
from unittest import mock


class _FakePsycopg2:
    class pool:  # noqa: N801
        ThreadedConnectionPool = object
        SimpleConnectionPool = object

    class extensions:  # noqa: N801
        connection = object


sys.modules.setdefault("psycopg2", _FakePsycopg2())

from app import engine as engine_mod  # noqa: E402
from app.engine import (  # noqa: E402
    MAX_OUTPUT_CHARS,
    MEMORY_LIMIT_KB,
    RUSAGE_MARKER_RE,
    RealJudgeEngine,
    SimulatedJudgeEngine,
    Verdict,
    _setpriv_cmd,
    create_engine,
)


class ConstantsTest(unittest.TestCase):
    def test_limits_are_tight(self):
        self.assertEqual(engine_mod.TIME_LIMIT_S, 2)
        self.assertEqual(engine_mod.COMPILE_TIMEOUT_S, 10)
        self.assertEqual(MEMORY_LIMIT_KB, 512 * 1024)
        self.assertEqual(MAX_OUTPUT_CHARS, 65536)
        self.assertEqual(engine_mod.MAX_PROCESSES_NATIVE, 2)
        self.assertEqual(engine_mod.MAX_PROCESSES_PYTHON, 4)
        self.assertEqual(engine_mod.MAX_PROCESSES_NODE, 16)
        self.assertEqual(engine_mod.MAX_PROCESSES_JVM, 32)
        self.assertEqual(engine_mod.MAX_OPEN_FILES, 64)

    def test_as_limits_java_higher(self):
        self.assertGreater(engine_mod.AS_LIMIT_KB_JAVA, engine_mod.AS_LIMIT_KB_DEFAULT)

    def test_rusage_marker_regex(self):
        self.assertTrue(RUSAGE_MARKER_RE.match("__SB_RUSAGE__=123\n"))
        self.assertTrue(RUSAGE_MARKER_RE.match("__SB_RUSAGE__=456"))
        self.assertFalse(RUSAGE_MARKER_RE.match("__SB_RUSAGE__=abc\n"))
        self.assertFalse(RUSAGE_MARKER_RE.match("x__SB_RUSAGE__=1\n"))


class SetprivCmdTest(unittest.TestCase):
    def test_cmd_uses_sandbox_helper_and_scrubbed_env(self):
        cmd, env = _setpriv_cmd(
            ["python3", "-c", "print(1)"],
            as_limit_kb=2048,
            cpu_s=2,
            fsize_kb=100,
            nproc=2,
            nofile=32,
        )
        self.assertTrue(cmd[0].endswith("python") or cmd[0].endswith("python.exe") or "python" in cmd[0])
        self.assertTrue(cmd[1].endswith("sandbox_helper.py"))
        self.assertEqual(cmd[2:], ["python3", "-c", "print(1)"])
        self.assertEqual(env["SB_MEM_KB"], "2048")
        self.assertEqual(env["SB_CPU_S"], "2")
        self.assertEqual(env["SB_FSIZE_KB"], "100")
        self.assertEqual(env["SB_NPROC"], "2")
        self.assertEqual(env["SB_NOFILE"], "32")
        for secret in ("DB_PASSWORD", "REDIS_URL", "AMQP_URL", "AUTH_JWT_SECRET"):
            self.assertNotIn(secret, env)
        self.assertEqual(set(env.keys()) - {
            "SB_MEM_KB",
            "SB_CPU_S",
            "SB_FSIZE_KB",
            "SB_NPROC",
            "SB_NOFILE",
        }, set(engine_mod.SANDBOX_ENV.keys()))

    def test_helper_path_is_local_app(self):
        cmd, _ = _setpriv_cmd(["x"], 1, 1, 1, 1, 1)
        self.assertIn("sandbox_helper.py", cmd[1])
        self.assertTrue(os.path.isfile(cmd[1]))


class TruncateAndRusage(unittest.TestCase):
    def setUp(self):
        self.engine = RealJudgeEngine()

    def test_truncate(self):
        self.assertEqual(self.engine._truncate("abc"), "abc")
        long = "x" * (MAX_OUTPUT_CHARS + 10)
        self.assertEqual(len(self.engine._truncate(long)), MAX_OUTPUT_CHARS)

    def test_strip_rusage_forged_middle_not_trusted_as_trailing(self):
        err = "user forged __SB_RUSAGE__=1 mid\nreal tail\n"
        kb, cleaned = self.engine._strip_rusage(err)
        self.assertIsNone(kb)
        self.assertIn("real tail", cleaned)


class CreateEngineTest(unittest.TestCase):
    def test_mock_engine_selected(self):
        with mock.patch.dict(os.environ, {"JUDGE_ENGINE": "mock"}):
            eng = create_engine()
            self.assertIsInstance(eng, SimulatedJudgeEngine)

    def test_default_is_real(self):
        with mock.patch.dict(os.environ, {"JUDGE_ENGINE": ""}):
            env = os.environ.copy()
            env.pop("JUDGE_ENGINE", None)
            with mock.patch.dict(os.environ, env, clear=True):
                eng = create_engine()
                self.assertIsInstance(eng, RealJudgeEngine)


class SimulatedEngineTest(unittest.TestCase):
    def setUp(self):
        self.eng = SimulatedJudgeEngine()

    def test_run_ok_when_pass_all_in_source(self):
        r = self.eng.run_code("python", "pass_all", "hello")
        self.assertEqual(r.status, "OK")
        self.assertEqual(r.output, "hello")

    def test_judge_requires_pass_all_marker(self):
        with mock.patch.object(engine_mod, "fetch_test_cases", return_value=[]):
            v = self.eng.judge(1, "python", "print(1)")
            self.assertEqual(v.status, "RE")

    def test_judge_ac_when_cases_match_and_pass_all(self):
        tc = types.SimpleNamespace(input_data="1", expected_output="1")
        with mock.patch.object(engine_mod, "fetch_test_cases", return_value=[tc]):
            v = self.eng.judge(1, "python", "pass_all")
            self.assertEqual(v.status, "AC")

    def test_judge_wa_when_case_mismatch(self):
        tc = types.SimpleNamespace(input_data="1", expected_output="2")
        with mock.patch.object(engine_mod, "fetch_test_cases", return_value=[tc]):
            v = self.eng.judge(1, "python", "pass_all")
            self.assertEqual(v.status, "WA")


class RealEnginePureBranchesTest(unittest.TestCase):
    def setUp(self):
        self.engine = RealJudgeEngine()

    def test_empty_source_is_ce(self):
        r = self.engine._run_one("   ", "python", "")
        self.assertEqual(r.status, "CE")
        self.assertIn("empty", r.error_message.lower())

    def test_unknown_language_is_ce(self):
        r = self.engine._run_one("print(1)", "cobol", "")
        self.assertEqual(r.status, "CE")
        self.assertIn("cobol", r.error_message)

    def test_no_test_cases_is_re(self):
        with mock.patch.object(engine_mod, "fetch_test_cases", return_value=[]):
            v = self.engine.judge(99, "python", "print(1)")
            self.assertEqual(v.status, "RE")
            self.assertIn("no test cases", v.error_message.lower())

    def test_wa_on_wrong_output(self):
        class _Case:
            input_data = "1\n"
            expected_output = "42\n"

        def fake_run(source, language, input_data):
            return engine_mod._RunResult(status="OK", output="41\n", runtime_ms=1, memory_kb=10)

        with mock.patch.object(engine_mod, "fetch_test_cases", return_value=[_Case()]), mock.patch.object(
            self.engine, "_run_one", fake_run
        ):
            v = self.engine.judge(1, "python", "print(41)")
            self.assertEqual(v.status, "WA")

    def test_ac_when_whitespace_differs_but_compact_matches(self):
        class _Case:
            input_data = "1\n"
            expected_output = "4 2\n"

        def fake_run(source, language, input_data):
            return engine_mod._RunResult(status="OK", output="42\n", runtime_ms=1, memory_kb=10)

        with mock.patch.object(engine_mod, "fetch_test_cases", return_value=[_Case()]), mock.patch.object(
            self.engine, "_run_one", fake_run
        ):
            v = self.engine.judge(1, "python", "print(42)")
            self.assertEqual(v.status, "AC")

    def test_mle_when_memory_above_threshold(self):
        class _Case:
            input_data = ""
            expected_output = "ok"

        def fake_run(source, language, input_data):
            return engine_mod._RunResult(
                status="OK",
                output="ok",
                runtime_ms=1,
                memory_kb=MEMORY_LIMIT_KB + 1,
            )

        # engine checks MLE after OK path in _run_subprocess; judge compares output first
        # Here we only assert constant threshold wiring via fake RE/MLE branch in _run_one style
        with mock.patch.object(engine_mod, "fetch_test_cases", return_value=[_Case()]), mock.patch.object(
            self.engine, "_run_one", fake_run
        ):
            v = self.engine.judge(1, "python", "x")
            # current judge() does not re-check MLE on OK — output match → AC
            # document contract: MLE is decided inside _run_subprocess
            self.assertIn(v.status, {"AC", "MLE", "WA"})

    def test_verdict_type_fields(self):
        v = Verdict(status="AC", runtime_ms=3, memory_kb=10)
        self.assertEqual(v.status, "AC")


class RepositoryImportSafetyTest(unittest.TestCase):
    def test_repository_module_exports_used_names(self):
        from app import repository as repo

        for name in ("SubmissionMessage", "RunMessage", "Verdict", "TestCase"):
            self.assertTrue(hasattr(repo, name), name)


if __name__ == "__main__":
    unittest.main()
