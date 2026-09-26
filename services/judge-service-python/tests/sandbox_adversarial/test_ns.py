"""ns/jail 模式对抗用例（SB_NS=1，root + ubuntu runner 可实测）。

验证 M3 的核心语义：
- jail 内正常运行（python 经 /usr RO bind、工作目录 RW bind）
- PID 隔离：用户代码是 ns 内 PID 1，宿主进程不可见
- 文件系统收敛：/etc/shadow 等未 bind 的宿主文件不存在
- 网络双重封锁：空 netns（无任何接口）+ seccomp socket 拒绝
- 与 cgroup 叠加：ns + fork 炸弹被 pids.max 拦截
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
import sys
import tempfile
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


def _run_ns(code: str, tmp_path: Path, env_extra: dict | None = None,
            argv: list[str] | None = None) -> subprocess.CompletedProcess:
    """建 jail 根 + 工作目录（0755 供 sandbox 用户穿越），经 helper 以 SB_NS 跑用户代码。"""
    env = os.environ.copy()
    env.update({
        "SANDBOX_NETBLOCK": SANDBOX_NETBLOCK,
        "SB_SANDBOX_UID": str(SANDBOX_UID),
        "SB_SANDBOX_GID": str(SANDBOX_GID),
        "SB_UID": str(SANDBOX_UID),
        "SB_GID": str(SANDBOX_GID),
        "SB_NS": "1",
        "SB_NS_DIRS_RO": "/usr,/lib,/lib64,/bin",
    })
    newroot = tempfile.mkdtemp(prefix="sb-root-")
    workdir = tempfile.mkdtemp(prefix="sb-wd-")
    os.chmod(workdir, 0o755)
    env["SB_NS_NEWROOT"] = newroot
    if env_extra:
        env.update(env_extra)
    try:
        if argv is None:
            argv = ["python3", "-c", code]
        proc = subprocess.run(
            [sys.executable, SANDBOX_HELPER, *argv],
            capture_output=True, text=True, timeout=60, env=env, cwd=workdir,
        )
    finally:
        shutil.rmtree(newroot, ignore_errors=True)
        shutil.rmtree(workdir, ignore_errors=True)
    return proc


pytestmark = [
    pytest.mark.skipif(
        not (_is_root() and bool(SANDBOX_HELPER) and Path("/usr").is_dir()),
        reason="need root + helper + /usr（宿主侧 jail 依赖）",
    ),
]


def test_ns_python_hello_runs(tmp_path: Path):
    """名单/依赖充分性：jail 内 python 完成运行（/usr RO + workdir RW + /proc + /dev）。"""
    proc = _run_ns("print('HELLO_NS')\n", tmp_path)
    assert "HELLO_NS" in (proc.stdout or ""), f"rc={proc.returncode} err={proc.stderr[-800:]}"


def test_ns_pid_namespace_isolated(tmp_path: Path):
    """新 PID ns：用户代码就是 ns 内 PID 1；/proc 只见 ns 内进程。"""
    code = (
        "import os\n"
        "pids = [p for p in os.listdir('/proc') if p.isdigit()]\n"
        "print('PID', os.getpid(), 'NPCOUNT', len(pids))\n"
    )
    proc = _run_ns(code, tmp_path)
    out = proc.stdout or ""
    m = re.search(r"PID (\d+) NPCOUNT (\d+)", out)
    assert m is not None, f"rc={proc.returncode} err={proc.stderr[-800:]}"
    assert m.group(1) == "1", "PID ns 未生效：用户代码不是 ns 内 PID 1"
    assert int(m.group(2)) <= 5, f"/proc 泄漏宿主进程：{out}"


def test_ns_etc_sensitive_files_hidden(tmp_path: Path):
    code = (
        "import os\n"
        "print('SHADOW', os.path.exists('/etc/shadow'))\n"
        "print('LDSO', os.path.exists('/etc/ld.so.cache'))\n"
    )
    proc = _run_ns(code, tmp_path)
    out = proc.stdout or ""
    assert "SHADOW False" in out, f"/etc/shadow 泄漏：{out}"
    assert "LDSO True" in out, f"loader cache 缺失（依赖不足）：rc={proc.returncode} err={proc.stderr[-500:]}"


def test_ns_no_network(tmp_path: Path):
    """双重封锁：空 netns（无接口）+ seccomp 拒绝 INET socket。"""
    code = (
        "import socket\n"
        "s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)\n"
        "s.connect(('1.1.1.1', 80))\n"
        "print('CONNECTED')\n"
    )
    proc = _run_ns(code, tmp_path)
    assert "CONNECTED" not in (proc.stdout or "")
    assert proc.returncode != 0 or "CONNECTED" not in (proc.stdout or "")


def test_ns_workdir_writable(tmp_path: Path):
    """工作目录 RW bind：用户代码可写（argv/cwd 路径在 jail 内保持有效）。"""
    code = (
        "open('out.txt', 'w').write('WROTE_NS')\n"
        "print('WROTE_OK')\n"
    )
    workdir = tempfile.mkdtemp(prefix="sb-wd-")
    # engine 真实链路同款：工作目录 chown 给 sandbox 用户（否则其无法写入）
    os.chown(workdir, SANDBOX_UID, SANDBOX_GID)
    os.chmod(workdir, 0o755)
    env = os.environ.copy()
    env.update({
        "SANDBOX_NETBLOCK": SANDBOX_NETBLOCK,
        "SB_SANDBOX_UID": str(SANDBOX_UID),
        "SB_SANDBOX_GID": str(SANDBOX_GID),
        "SB_UID": str(SANDBOX_UID),
        "SB_GID": str(SANDBOX_GID),
        "SB_NS": "1",
        "SB_NS_NEWROOT": tempfile.mkdtemp(prefix="sb-root-"),
        "SB_NS_DIRS_RO": "/usr,/lib,/lib64,/bin",
    })
    py = Path(workdir) / "user.py"
    py.write_text(code, encoding="utf-8")
    try:
        proc = subprocess.run(
            [sys.executable, SANDBOX_HELPER, "python3", str(py)],
            capture_output=True, text=True, timeout=60, env=env, cwd=workdir,
        )
        assert "WROTE_OK" in (proc.stdout or ""), f"rc={proc.returncode} err={proc.stderr[-800:]}"
    finally:
        shutil.rmtree(workdir, ignore_errors=True)
        shutil.rmtree(env["SB_NS_NEWROOT"], ignore_errors=True)


def test_ns_c_binary_runs(tmp_path: Path):
    """宿主侧编译 + jail 内运行（动态链接依赖由 /usr,/lib,/lib64 RO bind 覆盖）。"""
    workdir = tempfile.mkdtemp(prefix="sb-wd-")
    os.chmod(workdir, 0o755)
    newroot = tempfile.mkdtemp(prefix="sb-root-")
    src = Path(workdir) / "hello.c"
    src.write_text("#include <stdio.h>\nint main(void){printf(\"HELLO_NS_C\\n\");return 0;}\n",
                   encoding="utf-8")
    exe = Path(workdir) / "hello"
    subprocess.run(["gcc", "-O2", "-o", str(exe), str(src)], check=True, timeout=60)
    env = os.environ.copy()
    env.update({
        "SANDBOX_NETBLOCK": SANDBOX_NETBLOCK,
        "SB_SANDBOX_UID": str(SANDBOX_UID),
        "SB_SANDBOX_GID": str(SANDBOX_GID),
        "SB_UID": str(SANDBOX_UID),
        "SB_GID": str(SANDBOX_GID),
        "SB_NS": "1",
        "SB_NS_NEWROOT": newroot,
        "SB_NS_DIRS_RO": "/usr,/lib,/lib64,/bin",
    })
    try:
        proc = subprocess.run(
            [sys.executable, SANDBOX_HELPER, str(exe)],
            capture_output=True, text=True, timeout=60, env=env, cwd=workdir,
        )
        assert "HELLO_NS_C" in (proc.stdout or ""), f"rc={proc.returncode} err={proc.stderr[-800:]}"
    finally:
        shutil.rmtree(workdir, ignore_errors=True)
        shutil.rmtree(newroot, ignore_errors=True)


def test_ns_fork_bomb_contained_with_cgroup(tmp_path: Path):
    """M2+M3 组合：ns jail 内 fork 炸弹仍被 cgroup pids.max 按判题拦截。"""
    from app.cgroup import CgroupUnavailable, JudgeCgroup

    code = (
        "import os\n"
        "ok = 0\n"
        "for _ in range(30):\n"
        "    try:\n"
        "        pid = os.fork()\n"
        "    except OSError:\n"
        "        continue\n"
        "    if pid == 0:\n"
        "        os._exit(0)\n"
        "    os.waitpid(pid, 0)\n"
        "    ok += 1\n"
        "print('FORKS', ok)\n"
    )
    workdir = tempfile.mkdtemp(prefix="sb-wd-")
    os.chmod(workdir, 0o755)
    newroot = tempfile.mkdtemp(prefix="sb-root-")
    try:
        cg = JudgeCgroup.create(mem_kb=262144, pids_max=4, owner_uid=SANDBOX_UID)
    except CgroupUnavailable as exc:
        shutil.rmtree(workdir, ignore_errors=True)
        shutil.rmtree(newroot, ignore_errors=True)
        pytest.skip(f"cgroup delegation unavailable on this runner: {exc}")
    env = os.environ.copy()
    env.update({
        "SANDBOX_NETBLOCK": SANDBOX_NETBLOCK,
        "SB_SANDBOX_UID": str(SANDBOX_UID),
        "SB_SANDBOX_GID": str(SANDBOX_GID),
        "SB_UID": str(SANDBOX_UID),
        "SB_GID": str(SANDBOX_GID),
        "SB_NS": "1",
        "SB_NS_NEWROOT": newroot,
        "SB_CGROUP": cg.path,
    })
    py = Path(workdir) / "bomb.py"
    py.write_text(code, encoding="utf-8")
    try:
        proc = subprocess.run(
            [sys.executable, SANDBOX_HELPER, "python3", str(py)],
            capture_output=True, text=True, timeout=60, env=env, cwd=workdir,
        )
        m = re.search(r"FORKS (\d+)", proc.stdout or "")
        assert m is not None, f"rc={proc.returncode} err={proc.stderr[-800:]}"
        assert int(m.group(1)) < 30, "pids.max 未生效"
    finally:
        cg.kill_all()
        cg.destroy()
        shutil.rmtree(workdir, ignore_errors=True)
        shutil.rmtree(newroot, ignore_errors=True)
