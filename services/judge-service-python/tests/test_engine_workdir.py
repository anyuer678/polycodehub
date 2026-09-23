"""R-08：判题工作目录与路径卫生的单元测试（无需 root / 网络）。

运行: cd services/judge-service-python && python -m pytest tests/test_engine_workdir.py -q
"""

from __future__ import annotations

import os
import sys
import tempfile
import unittest
from pathlib import Path


class _FakePsycopg2:
    class pool:  # noqa: N801
        ThreadedConnectionPool = object
        SimpleConnectionPool = object

    class extensions:  # noqa: N801
        connection = object


sys.modules.setdefault("psycopg2", _FakePsycopg2())

from app import engine as engine_mod  # noqa: E402
from app.engine import RealJudgeEngine  # noqa: E402


class WorkdirSecurityTest(unittest.TestCase):
    def setUp(self):
        # 生产默认工作根是镜像内的 /app/judge-work，CI runner 上不可写。
        # 测试只验证「前缀 + 0700」这一契约，因此把工作根重定向到临时目录，
        # 生产默认值由 test_default_work_root_is_container_path 单独守护。
        self._orig_work_root = engine_mod.JUDGE_WORK_ROOT
        self._tmp_root = tempfile.mkdtemp(prefix="polycode-test-root-")
        engine_mod.JUDGE_WORK_ROOT = self._tmp_root
        self.engine = RealJudgeEngine()

    def tearDown(self):
        engine_mod.JUDGE_WORK_ROOT = self._orig_work_root
        try:
            os.rmdir(self._tmp_root)
        except OSError:
            pass

    def test_default_work_root_is_container_path(self):
        # 生产语义不得被测试改写：默认仍是镜像内可执行的 /app/judge-work，
        # 且必须能通过 JUDGE_WORK_ROOT 环境变量覆盖。
        self.assertEqual(self._orig_work_root, "/app/judge-work")
        src = Path(engine_mod.__file__).read_text(encoding="utf-8", errors="replace")
        self.assertIn('os.environ.get("JUDGE_WORK_ROOT"', src)

    def test_make_workdir_prefix_and_mode(self):
        path = self.engine._make_workdir()
        try:
            self.assertTrue(os.path.isdir(path))
            name = os.path.basename(path)
            self.assertTrue(name.startswith("polycode-judge-"), name)
            mode = os.stat(path).st_mode & 0o777
            if os.name == "nt":
                # Windows 对目录 chmod 语义有限：只要求实现调用了 chmod(0o700)
                src = Path(engine_mod.__file__).read_text(encoding="utf-8", errors="replace")
                self.assertIn("os.chmod(path, 0o700)", src)
            else:
                self.assertEqual(mode, 0o700, oct(mode))
        finally:
            try:
                os.rmdir(path)
            except OSError:
                pass

    def test_chown_workdir_sets_700_even_without_chown(self):
        with tempfile.TemporaryDirectory() as tmp:
            RealJudgeEngine._chown_sandbox_workdir(tmp)
            mode = os.stat(tmp).st_mode & 0o777
            if os.name == "nt":
                src = Path(engine_mod.__file__).read_text(encoding="utf-8", errors="replace")
                self.assertIn("os.chmod(path, 0o700)", src)
            else:
                self.assertEqual(mode, 0o700, oct(mode))

    def test_sandbox_env_has_no_secrets(self):
        env = engine_mod.SANDBOX_ENV
        for k in env:
            self.assertNotIn("PASSWORD", k.upper())
            self.assertNotIn("SECRET", k.upper())
            self.assertNotIn("TOKEN", k.upper())
        # 仅允许最小键集合
        allowed = {"PATH", "HOME", "LANG", "TMPDIR", "LC_ALL"}
        self.assertTrue(set(env.keys()).issubset(allowed), set(env.keys()))

    def test_sandbox_home_and_tmp_are_tmp(self):
        self.assertEqual(engine_mod.SANDBOX_ENV.get("HOME"), "/tmp")
        self.assertEqual(engine_mod.SANDBOX_ENV.get("TMPDIR"), "/tmp")

    def test_helper_path_lives_under_app(self):
        helper = Path(engine_mod.__file__).resolve().parent / "sandbox_helper.py"
        self.assertTrue(helper.is_file(), helper)

    def test_run_binary_default_cwd_tmp_or_workdir(self):
        # 源码约定：cwd or "/tmp"
        src = Path(engine_mod.__file__).read_text(encoding="utf-8", errors="replace")
        self.assertIn('cwd=cwd or "/tmp"', src.replace("'", '"'))

    def test_workdir_not_world_writable_prefix(self):
        # 防止退回 0o777
        src = Path(engine_mod.__file__).read_text(encoding="utf-8", errors="replace")
        self.assertIn("0o700", src)
        self.assertNotIn("0o777", src)


class SourcePathHygieneTest(unittest.TestCase):
    def test_repository_or_worker_no_world_777(self):
        root = Path(engine_mod.__file__).resolve().parents[1]
        offenders = []
        for p in root.rglob("*.py"):
            if "__pycache__" in p.parts or "tests" in p.parts:
                continue
            text = p.read_text(encoding="utf-8", errors="ignore")
            if "0o777" in text or "chmod(777" in text:
                offenders.append(str(p))
        self.assertEqual(offenders, [], offenders)


if __name__ == "__main__":
    unittest.main()
