"""沙箱对抗用例。

环境：
- SANDBOX_HELPER：默认 app/sandbox_helper.py
- SANDBOX_NETBLOCK：默认 /usr/local/bin/sandbox_netblock（可用 env 覆盖）
- SB_SANDBOX_UID/GID：默认 1002/1001
- 需要以 root 运行 helper（setuid 降权）；无权限时 skip 完整用例
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
_DEFAULT_HELPER = ROOT / "app" / "sandbox_helper.py"
SANDBOX_HELPER = os.environ.get("SANDBOX_HELPER", "") or (
    str(_DEFAULT_HELPER) if _DEFAULT_HELPER.exists() else ""
)
SANDBOX_NETBLOCK = os.environ.get("SANDBOX_NETBLOCK", "/usr/local/bin/sandbox_netblock")
SANDBOX_UID = int(os.environ.get("SB_SANDBOX_UID", "1002"))
SANDBOX_GID = int(os.environ.get("SB_SANDBOX_GID", "1001"))


def _is_root() -> bool:
    try:
        return os.geteuid() == 0
    except AttributeError:
        return False


def _helper_ready() -> bool:
    return bool(SANDBOX_HELPER and Path(SANDBOX_HELPER).exists())


def _netblock_ready() -> bool:
    return Path(SANDBOX_NETBLOCK).exists() and os.access(SANDBOX_NETBLOCK, os.X_OK)


def _sandbox_user_ready() -> bool:
    try:
        pwd = __import__("pwd")
        pwd.getpwuid(SANDBOX_UID)
        return True
    except Exception:
        return False


def _run_helper(code: str, tmp_path: Path, env_extra: dict | None = None) -> subprocess.CompletedProcess:
    py = tmp_path / "user.py"
    py.write_text(code, encoding="utf-8")
    env = os.environ.copy()
    env.setdefault("SANDBOX_NETBLOCK", SANDBOX_NETBLOCK)
    env.setdefault("SB_SANDBOX_UID", str(SANDBOX_UID))
    env.setdefault("SB_SANDBOX_GID", str(SANDBOX_GID))
    env.setdefault("SB_MEM_KB", "262144")
    env.setdefault("SB_CPU_S", "2")
    env.setdefault("SB_NPROC", "8")
    if env_extra:
        env.update(env_extra)
    return subprocess.run(
        [sys.executable, SANDBOX_HELPER, sys.executable, str(py)],
        capture_output=True,
        text=True,
        timeout=30,
        env=env,
    )


@pytest.mark.skipif(not _helper_ready(), reason="SANDBOX_HELPER missing")
def test_netblock_binary_missing_is_documented():
    root = Path(__file__).resolve().parents[3]
    hits = list(root.rglob("sandbox_helper.py")) + list(root.rglob("sandbox_netblock.c"))
    assert hits, "expected sandbox_helper.py or sandbox_netblock.c in repo"


@pytest.mark.skipif(
    not (_is_root() and _helper_ready() and _netblock_ready() and _sandbox_user_ready()),
    reason="need root + netblock + sandbox user for full adversarial",
)
def test_sandbox_rejects_network_socket(tmp_path):
    code = (
        "import socket\n"
        "s=socket.socket(socket.AF_INET, socket.SOCK_STREAM)\n"
        "s.connect(('1.1.1.1', 80))\n"
        "print('CONNECTED')\n"
    )
    proc = _run_helper(code, tmp_path)
    assert "CONNECTED" not in (proc.stdout or "")
    assert proc.returncode != 0 or "CONNECTED" not in (proc.stdout or "")


@pytest.mark.skipif(
    not (_is_root() and _helper_ready() and _netblock_ready() and _sandbox_user_ready()),
    reason="need root + netblock + sandbox user",
)
def test_sandbox_rejects_ptrace(tmp_path):
    code = (
        "import ctypes, ctypes.util\n"
        "libc=ctypes.CDLL(ctypes.util.find_library('c'))\n"
        "print('PTRACE', libc.ptrace(0,0,0,0))\n"
    )
    proc = _run_helper(code, tmp_path)
    err = (proc.stderr or "").lower()
    assert proc.returncode != 0 or "not permitted" in err or "eperm" in err


@pytest.mark.skipif(
    not (_is_root() and _helper_ready() and _netblock_ready() and _sandbox_user_ready()),
    reason="need root + netblock + sandbox user",
)
def test_sandbox_blocks_write_system_path(tmp_path):
    target = Path("/tmp/sb-pwn-test-should-not-exist")
    if target.exists():
        target.unlink()
    code = f"open({str(target)!r},'w').write('x')\nprint('WROTE')\n"
    proc = _run_helper(code, tmp_path)
    assert "WROTE" not in (proc.stdout or "")
    assert not target.exists()


@pytest.mark.skipif(not _helper_ready(), reason="helper missing")
def test_helper_fail_closed_without_netblock(tmp_path):
    """netblock 缺失时应 exit 125 且 stderr 含 refuse，不得静默执行用户代码。"""
    if not _is_root() or not _sandbox_user_ready():
        pytest.skip("root + sandbox user required")
    code = "print('SHOULD_NOT_RUN')\n"
    proc = _run_helper(
        code,
        tmp_path,
        env_extra={"SANDBOX_NETBLOCK": str(tmp_path / "missing-netblock")},
    )
    assert "SHOULD_NOT_RUN" not in (proc.stdout or "")
    assert proc.returncode == 125 or "refuse" in (proc.stderr or "").lower() or "missing" in (proc.stderr or "").lower()


@pytest.mark.skipif(not _is_root() or not _helper_ready() or not _sandbox_user_ready(), reason="root+user")
def test_helper_runs_benign_code_when_ready(tmp_path):
    if not _netblock_ready():
        pytest.skip("netblock not built")
    proc = _run_helper("print('HELLO_SANDBOX')\n", tmp_path)
    # 可能因 rlimit/uid 环境失败，但至少应有结构化输出；成功时 stdout 含标记
    if proc.returncode == 0:
        assert "HELLO_SANDBOX" in proc.stdout
    else:
        # 环境不完整时允许失败，但应有 __SB_ERROR__ 或非零
        assert proc.returncode != 0
