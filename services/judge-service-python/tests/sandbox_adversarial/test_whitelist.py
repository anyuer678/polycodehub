"""白名单模式对抗用例（SB_PROFILE opt-in）。

前置：与 test_blocked.py 相同（root + netblock + sandbox user）。
在 CI（ubuntu-latest + gcc + node）实测 curated bootstrap 名单是否够用：
- python / c / node 的"正常运行"用例是名单充分性的经验证；
- 阻断用例证明白名单收紧后网络/调试/未知 profile 语义不变（fail-closed）。
java 名单为 experimental：本机无 JDK 时自动跳过。
"""

from __future__ import annotations

import os
import shutil
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


def _full_env() -> bool:
    return _is_root() and _helper_ready() and _netblock_ready() and _sandbox_user_ready()


def _run_helper_cmd(argv: list[str], env_extra: dict | None = None) -> subprocess.CompletedProcess:
    """经 sandbox_helper 以指定 argv 运行（用户程序不必是 python）。"""
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
        [sys.executable, SANDBOX_HELPER, *argv],
        capture_output=True,
        text=True,
        timeout=30,
        env=env,
    )


pytestmark = pytest.mark.skipif(
    not (_helper_ready() and _netblock_ready()),
    reason="SANDBOX_HELPER / sandbox_netblock missing",
)


@pytest.mark.skipif(not _full_env(), reason="need root + netblock + sandbox user")
def test_whitelist_python_hello_runs(tmp_path: Path):
    """名单充分性：python 运行时在 SB_PROFILE=python 下完成 hello world。"""
    proc = _run_helper_cmd(
        [sys.executable, "-c", "print('HELLO_WL_PY')"],
        env_extra={"SB_PROFILE": "python"},
    )
    assert "HELLO_WL_PY" in (proc.stdout or ""), f"rc={proc.returncode} err={proc.stderr[-500:]}"


@pytest.mark.skipif(not _full_env(), reason="need root + netblock + sandbox user")
def test_whitelist_python_inet_socket_still_denied(tmp_path: Path):
    code = (
        "import socket\n"
        "s=socket.socket(socket.AF_INET, socket.SOCK_STREAM)\n"
        "s.connect(('1.1.1.1', 80))\n"
        "print('CONNECTED')\n"
    )
    proc = _run_helper_cmd(
        [sys.executable, "-c", code],
        env_extra={"SB_PROFILE": "python"},
    )
    assert "CONNECTED" not in (proc.stdout or "")
    assert proc.returncode != 0 or "CONNECTED" not in (proc.stdout or "")


@pytest.mark.skipif(not _full_env(), reason="need root + netblock + sandbox user")
def test_whitelist_python_unix_socket_allowed(tmp_path: Path):
    """AF_UNIX 域仍可用（socket 参数过滤放行），证明网络隔离粒度是域而非全禁。"""
    code = (
        "import socket\n"
        "s=socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)\n"
        "s.bind('\\0sb-wl-unix-test')\n"
        "print('UNIX_OK')\n"
    )
    proc = _run_helper_cmd(
        [sys.executable, "-c", code],
        env_extra={"SB_PROFILE": "python"},
    )
    assert "UNIX_OK" in (proc.stdout or ""), f"rc={proc.returncode} err={proc.stderr[-500:]}"


@pytest.mark.skipif(not _full_env(), reason="need root + netblock + sandbox user")
def test_whitelist_python_ptrace_still_denied(tmp_path: Path):
    """白名单默认拒绝下 ptrace 必须失败：直接断言返回值与 errno（rc 会被 print 掩盖）。"""
    code = (
        "import ctypes\n"
        "libc=ctypes.CDLL(None, use_errno=True)\n"
        "res=libc.ptrace(0,0,0,0)\n"
        "print('PTRACE_RES', res, ctypes.get_errno())\n"
    )
    proc = _run_helper_cmd(
        [sys.executable, "-c", code],
        env_extra={"SB_PROFILE": "python"},
    )
    out = proc.stdout or ""
    assert "PTRACE_RES -1 1" in out, f"rc={proc.returncode} out={out!r} err={proc.stderr[-300:]}"


@pytest.mark.skipif(not _full_env(), reason="need root + netblock + sandbox user")
def test_whitelist_unknown_profile_fails_closed(tmp_path: Path):
    """未知 SB_PROFILE：netblock 直接退出 125，绝不执行用户代码。"""
    proc = _run_helper_cmd(
        [sys.executable, "-c", "print('SHOULD_NOT_RUN_WL')"],
        env_extra={"SB_PROFILE": "doesnotexist"},
    )
    assert "SHOULD_NOT_RUN_WL" not in (proc.stdout or "")
    assert proc.returncode == 125
    assert "unknown SB_PROFILE" in (proc.stderr or "")


@pytest.mark.skipif(
    not (_full_env() and shutil.which("gcc")),
    reason="need root + netblock + sandbox user + gcc",
)
def test_whitelist_c_binary_runs(tmp_path: Path):
    src = tmp_path / "hello.c"
    src.write_text("#include <stdio.h>\nint main(void){printf(\"HELLO_WL_C\\n\");return 0;}\n",
                   encoding="utf-8")
    exe = tmp_path / "hello"
    subprocess.run(["gcc", "-O2", "-o", str(exe), str(src)], check=True, timeout=60)
    # pytest 的 tmp_path 属 root 且 0700：sandbox 用户需能穿越目录才能 execve
    os.chmod(tmp_path, 0o755)
    proc = _run_helper_cmd([str(exe)], env_extra={"SB_PROFILE": "c"})
    assert "HELLO_WL_C" in (proc.stdout or ""), f"rc={proc.returncode} err={proc.stderr[-500:]}"


@pytest.mark.skipif(
    not (_full_env() and shutil.which("node")),
    reason="need root + netblock + sandbox user + node",
)
def test_whitelist_node_runs(tmp_path: Path):
    proc = _run_helper_cmd(
        ["node", "-e", "console.log('HELLO_WL_NODE')"],
        env_extra={"SB_PROFILE": "node"},
    )
    assert "HELLO_WL_NODE" in (proc.stdout or ""), f"rc={proc.returncode} err={proc.stderr[-500:]}"


@pytest.mark.skipif(
    os.environ.get("SB_TEST_JAVA") != "1",
    reason="java 名单 experimental：GitHub runner 的 JDK 缺 server JVM，仅在有完整 JDK 的环境显式开启（SB_TEST_JAVA=1）",
)
def test_whitelist_java_runs_experimental(tmp_path: Path):
    if not (_full_env() and shutil.which("javac") and shutil.which("java")):
        pytest.skip("root + netblock + sandbox user + JDK required")
    src = tmp_path / "Main.java"
    src.write_text(
        "public class Main{public static void main(String[] a){System.out.println(\"HELLO_WL_JAVA\");}}\n",
        encoding="utf-8",
    )
    subprocess.run(["javac", "-d", str(tmp_path), str(src)], check=True, timeout=120)
    proc = _run_helper_cmd(
        ["java", "-cp", str(tmp_path), "Main"],
        env_extra={"SB_PROFILE": "java"},
    )
    assert "HELLO_WL_JAVA" in (proc.stdout or ""), f"rc={proc.returncode} err={proc.stderr[-1000:]}"
