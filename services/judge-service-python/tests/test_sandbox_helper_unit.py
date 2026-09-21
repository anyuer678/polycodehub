"""sandbox_helper 纯逻辑单元测试：无需 root / seccomp / Docker。

覆盖：env 覆盖 uid/gid/netblock、SB_* 限制解析、环境清洗、fail-closed（mock/fs）。
运行: cd services/judge-service-python && python -m pytest tests/test_sandbox_helper_unit.py -q
"""

from __future__ import annotations

import importlib.util
import os
import sys
import types
from pathlib import Path
from unittest import mock

HELPER_PATH = Path(__file__).resolve().parents[1] / "app" / "sandbox_helper.py"


def _load_helper():
    """在无 resource 模块的 Windows 上也能导入 helper。"""
    if "resource" not in sys.modules:
        fake = types.ModuleType("resource")
        for name in (
            "RLIMIT_AS",
            "RLIMIT_CPU",
            "RLIMIT_FSIZE",
            "RLIMIT_NOFILE",
            "RLIMIT_CORE",
            "RLIMIT_NPROC",
        ):
            setattr(fake, name, name)

        def _setrlimit(*_a, **_k):
            return None

        fake.setrlimit = _setrlimit
        sys.modules["resource"] = fake
    spec = importlib.util.spec_from_file_location("sandbox_helper_under_test", HELPER_PATH)
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


helper = _load_helper()


def _patch_os_fork(value=0):
    """Windows 无 os.fork：create=True 注入。"""
    return mock.patch.object(os, "fork", lambda: value, create=True)


class TestDefaultsAndEnvOverride:
    def test_default_uid_gid(self):
        uid, gid = helper.resolve_sandbox_ids({})
        assert uid == 1002
        assert gid == 1001

    def test_env_override_uid_gid(self):
        uid, gid = helper.resolve_sandbox_ids(
            {"SB_SANDBOX_UID": "2001", "SB_SANDBOX_GID": "2002"}
        )
        assert uid == 2001
        assert gid == 2002

    def test_default_netblock_path(self):
        assert helper.resolve_netblock({}) == "/usr/local/bin/sandbox_netblock"

    def test_env_override_netblock(self):
        p = helper.resolve_netblock({"SANDBOX_NETBLOCK": "/opt/custom/netblock"})
        assert p == "/opt/custom/netblock"

    def test_parse_limits_defaults(self):
        lim = helper.parse_sb_limits({})
        assert lim["SB_MEM_KB"] == 1048576
        assert lim["SB_CPU_S"] == 2
        assert lim["SB_FSIZE_KB"] == 65536
        assert lim["SB_NPROC"] == 1
        assert lim["SB_NOFILE"] == 64

    def test_parse_limits_from_env(self):
        lim = helper.parse_sb_limits(
            {
                "SB_MEM_KB": "262144",
                "SB_CPU_S": "3",
                "SB_FSIZE_KB": "1024",
                "SB_NPROC": "8",
                "SB_NOFILE": "32",
            }
        )
        assert lim == {
            "SB_MEM_KB": 262144,
            "SB_CPU_S": 3,
            "SB_FSIZE_KB": 1024,
            "SB_NPROC": 8,
            "SB_NOFILE": 32,
        }

    def test_parse_limits_rejects_garbage(self):
        try:
            helper.parse_sb_limits({"SB_MEM_KB": "not-a-number"})
        except ValueError as exc:
            assert "SB_MEM_KB" in str(exc)
        else:
            raise AssertionError("expected ValueError")


class TestEnvClean:
    def test_allowed_keys_are_minimal(self):
        assert helper.ALLOWED_SANDBOX_ENV_KEYS == frozenset(
            {"PATH", "HOME", "LANG", "TMPDIR"}
        )

    def test_scrub_drops_secrets(self):
        dirty = {
            "PATH": "/usr/bin",
            "HOME": "/tmp",
            "LANG": "C.UTF-8",
            "TMPDIR": "/tmp",
            "DB_PASSWORD": "supersecret",
            "REDIS_URL": "redis://:pw@redis:6379/0",
            "AMQP_URL": "amqp://user:pass@mq:5672",
            "AUTH_JWT_SECRET": "jwt-secret-value",
            "AWS_SECRET_ACCESS_KEY": "aws",
        }
        clean = helper.scrubbed_sandbox_env(dirty)
        assert set(clean.keys()) == {"PATH", "HOME", "LANG", "TMPDIR"}
        joined = repr(clean)
        for leak in ("supersecret", "redis://", "amqp://", "jwt-secret", "aws"):
            assert leak not in joined

    def test_scrub_empty_input(self):
        assert helper.scrubbed_sandbox_env({}) == {}


class TestFailClosed:
    def test_netblock_ready_false_when_missing(self, tmp_path):
        assert helper.netblock_ready(str(tmp_path / "nope")) is False

    def test_netblock_ready_false_when_not_executable(self, tmp_path):
        p = tmp_path / "netblock"
        p.write_text("#!/bin/sh\n", encoding="utf-8")
        os.chmod(p, 0o644)
        if os.name == "nt":
            # Windows 无 unix 可执行位：isfile True 且 access X_OK 常为 True
            assert helper.netblock_ready(str(p)) is True
        else:
            assert helper.netblock_ready(str(p)) is False

    def test_netblock_ready_true_when_executable(self, tmp_path):
        p = tmp_path / "netblock"
        p.write_text("#!/bin/sh\necho ok\n", encoding="utf-8")
        os.chmod(p, 0o755)
        assert helper.netblock_ready(str(p)) is True

    def test_netblock_ready_false_empty_path(self):
        assert helper.netblock_ready("") is False

    def test_source_fail_closed_refuses_without_netblock(self):
        src = HELPER_PATH.read_text(encoding="utf-8", errors="replace")
        assert "refuse to judge" in src
        assert "netblock_ready" in src
        assert "if not netblock_ready(netblock_bin):" in src

    def test_main_empty_args_returns_2(self):
        with mock.patch.object(sys, "argv", ["sandbox_helper.py"]):
            assert helper.main() == 2

    def test_main_fail_closed_exit_125_when_child_skips_netblock(self, tmp_path):
        """mock fork 子进程路径：netblock 缺失 → _exit(125)。"""
        missing = str(tmp_path / "missing-netblock")
        exits: list[int] = []
        writes: list[bytes] = []

        def fake_exit(code):
            exits.append(code)
            raise SystemExit(code)

        with mock.patch.dict(
            os.environ,
            {
                "SANDBOX_NETBLOCK": missing,
                "SB_SANDBOX_UID": "1002",
                "SB_SANDBOX_GID": "1001",
                "SB_MEM_KB": "1024",
                "SB_CPU_S": "1",
                "SB_NPROC": "1",
            },
            clear=False,
        ), mock.patch.object(
            sys, "argv", ["sandbox_helper.py", "python3", "-c", "print(1)"]
        ), _patch_os_fork(0), mock.patch.object(
            os, "setgroups", lambda *_: None, create=True
        ), mock.patch.object(
            os, "setgid", lambda *_: None, create=True
        ), mock.patch.object(
            os, "setuid", lambda *_: None, create=True
        ), mock.patch.object(
            os, "write", lambda _fd, data: writes.append(data), create=True
        ), mock.patch.object(
            os, "_exit", fake_exit, create=True
        ):
            try:
                helper.main()
            except SystemExit:
                pass

        assert exits and exits[-1] == 125
        assert any(b"refuse to judge" in w for w in writes)

    def test_main_setuid_failure_exit_126(self):
        exits: list[int] = []

        def fake_exit(code):
            exits.append(code)
            raise SystemExit(code)

        with mock.patch.dict(
            os.environ,
            {"SANDBOX_NETBLOCK": "/usr/local/bin/sandbox_netblock"},
            clear=False,
        ), mock.patch.object(
            sys, "argv", ["sandbox_helper.py", "true"]
        ), _patch_os_fork(0), mock.patch.object(
            os, "setgroups", lambda *_: None, create=True
        ), mock.patch.object(
            os, "setgid", mock.Mock(side_effect=OSError("eperm")), create=True
        ), mock.patch.object(
            os, "write", lambda *_: None, create=True
        ), mock.patch.object(
            os, "_exit", fake_exit, create=True
        ):
            try:
                helper.main()
            except SystemExit:
                pass

        assert exits and exits[-1] == 126

    def test_module_defaults_match_production_ids(self):
        assert helper.resolve_sandbox_ids({}) == (1002, 1001)


class TestSourceContract:
    def test_helper_calls_setgroups_before_setuid(self):
        src = HELPER_PATH.read_text(encoding="utf-8", errors="replace")
        g = src.find("os.setgroups([])")
        u = src.find("os.setuid(")
        assert g != -1 and u != -1 and g < u

    def test_helper_writes_rusage_marker(self):
        src = HELPER_PATH.read_text(encoding="utf-8", errors="replace")
        assert "__SB_RUSAGE__=" in src

    def test_helper_propagates_sigxcpu(self):
        src = HELPER_PATH.read_text(encoding="utf-8", errors="replace")
        assert "WTERMSIG" in src
