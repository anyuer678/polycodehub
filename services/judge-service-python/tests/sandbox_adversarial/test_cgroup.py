"""cgroup v2 模式对抗用例（root + 可写 cgroup v2）。

验证 M2 的核心语义：
- fork 炸弹被 pids.max 按【判题】隔离（多 worker 互不污染——修复 RLIMIT_NPROC 用户级计数）
- 超内存被 memory.max 硬性拦截且 oom_kill 有显式证据（helper __SB_CGROUP__ 标记）
- 附着失败 fail-closed（exit 125）
- cgroup 与 seccomp 白名单可叠加

cgroup 根可写的环境实测（特权容器/可委托部署；GH hosted runner 的 cgroup 根
对 root 也只读，cgroup 用例在 CI 一律 skip——见 test_ns 首个 cgroup 交互用例）。
无 cgroup 环境自动跳过。
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
import sys
import tempfile
import uuid
from pathlib import Path

import pytest

from app.cgroup import CgroupUnavailable, JudgeCgroup, cgroup_v2_available

ROOT = Path(__file__).resolve().parents[2]
_DEFAULT_HELPER = ROOT / "app" / "sandbox_helper.py"
SANDBOX_HELPER = os.environ.get("SANDBOX_HELPER", "") or (
    str(_DEFAULT_HELPER) if _DEFAULT_HELPER.exists() else ""
)
SANDBOX_NETBLOCK = os.environ.get("SANDBOX_NETBLOCK", "/usr/local/bin/sandbox_netblock")
SANDBOX_UID = int(os.environ.get("SB_SANDBOX_UID", "1002"))
SANDBOX_GID = int(os.environ.get("SB_SANDBOX_GID", "1001"))

FORK_BOMB = (
    # pids.max 约束的是【并发任务数】而非累计 fork 次数：子进程必须存活（sleep）
    # 才能把任务数顶到上限，fork 才会开始 EAGAIN。串行 fork+wait+exit 的炸弹
    # 任意时刻任务数 ≤2，永远打不满 pids.max（镜像内实测 2026-09 教训）。
    "import os, time\n"
    "ok = 0\n"
    "kids = []\n"
    "for _ in range(30):\n"
    "    try:\n"
    "        pid = os.fork()\n"
    "    except OSError:\n"
    "        break\n"
    "    if pid == 0:\n"
    "        time.sleep(5)\n"
    "        os._exit(0)\n"
    "    kids.append(pid)\n"
    "    ok += 1\n"
    "for pid in kids:\n"
    "    try:\n"
    "        os.waitpid(pid, 0)\n"
    "    except OSError:\n"
    "        pass\n"
    "print('FORKS', ok)\n"
)

MEMORY_HOG = (
    "b = []\n"
    "for i in range(512):\n"
    "    b.append(b'x' * (1024 * 1024))\n"
    "print('HOGGED', len(b))\n"
)


def _is_root() -> bool:
    try:
        return os.geteuid() == 0
    except AttributeError:
        return False


def _full_env() -> bool:
    return (
        _is_root()
        and bool(SANDBOX_HELPER)
        and Path(SANDBOX_HELPER).exists()
        and cgroup_v2_available()
    )


def _run_in_cgroup(code: str, tmp_path: Path, mem_kb: int, pids: int,
                   argv: list[str] | None = None,
                   env_extra: dict | None = None) -> tuple[subprocess.CompletedProcess, JudgeCgroup]:
    """测试自建 cgroup（engine 在真实链路里做的事），经 helper 跑用户代码。

    runner 未委托 cgroup 写权限（GH hosted runner 的 cgroup 根对 root 也只读，
    实测 2026-09：mkdir/subtree_control 全 EACCES）时 skip——此时 cgroup 层的
    验证应在特权容器/可委托部署环境执行；意外的非委托类错误仍会正常失败。
    用户脚本放在 /tmp 下 0755 专用目录（pytest tmp_path 整条链 0700，sandbox
    用户不可穿越）。"""
    try:
        cg = JudgeCgroup.create(mem_kb=mem_kb, pids_max=pids, owner_uid=SANDBOX_UID)
    except CgroupUnavailable as exc:
        pytest.skip(f"cgroup delegation unavailable on this runner: {exc}")
    workdir = tempfile.mkdtemp(prefix="sb-cg-")
    os.chmod(workdir, 0o755)
    env = os.environ.copy()
    env.update({
        "SANDBOX_NETBLOCK": SANDBOX_NETBLOCK,
        "SB_SANDBOX_UID": str(SANDBOX_UID),
        "SB_SANDBOX_GID": str(SANDBOX_GID),
        "SB_NPROC": "8",
        "SB_CGROUP": cg.path,
    })
    if env_extra:
        env.update(env_extra)
    py = Path(workdir) / "user.py"
    py.write_text(code, encoding="utf-8")
    cmd_argv = argv if argv is not None else [sys.executable, str(py)]
    try:
        proc = subprocess.run(
            [sys.executable, SANDBOX_HELPER, *cmd_argv],
            capture_output=True, text=True, timeout=60, env=env,
        )
    finally:
        shutil.rmtree(workdir, ignore_errors=True)
    return proc, cg


pytestmark = pytest.mark.skipif(
    not (_is_root() and bool(SANDBOX_HELPER) and cgroup_v2_available()),
    reason="need root + helper + writable cgroup v2",
)


def test_cgroup_pids_max_contains_fork_bomb(tmp_path: Path):
    """pids.max=3：fork 炸弹被按判题隔离（fork 失败 EAGAIN，而不是撑爆宿主机）。"""
    proc, cg = _run_in_cgroup(FORK_BOMB, tmp_path, mem_kb=262144, pids=3)
    try:
        m = re.search(r"FORKS (\d+)", proc.stdout or "")
        assert m is not None, f"no FORKS output: rc={proc.returncode} err={proc.stderr[-500:]}"
        assert int(m.group(1)) < 30, "pids.max 未生效：30 次 fork 全部成功"
    finally:
        cg.kill_all()
        cg.destroy()


def test_cgroup_memory_max_oom_kill_has_evidence(tmp_path: Path):
    """memory.max=64MB：512MB 分配被 OOM kill，helper 标记 oom=1（显式证据，非猜测）。

    SB_MEM_KB（RLIMIT_AS）须大于 memory.max，否则 rlimit 先触发 MemoryError、
    cgroup OOM 永远不会被观察到（镜像内实测 2026-09 教训）。"""
    proc, cg = _run_in_cgroup(MEMORY_HOG, tmp_path, mem_kb=65536, pids=8,
                              env_extra={"SB_MEM_KB": "1048576"})
    try:
        assert "HOGGED" not in (proc.stdout or "")
        assert proc.returncode != 0
        m = re.search(r"__SB_CGROUP__=(\d+),oom=(\d+)", proc.stderr or "")
        assert m is not None, f"missing cgroup marker: err={proc.stderr[-500:]}"
        assert int(m.group(2)) >= 1, "oom_kill 证据缺失"
    finally:
        cg.kill_all()
        cg.destroy()


def test_cgroup_attach_failure_is_fail_closed(tmp_path: Path):
    """SB_CGROUP 指向不存在的目录：helper 拒绝执行（exit 125），绝不裸跑用户代码。"""
    env = os.environ.copy()
    env.update({
        "SANDBOX_NETBLOCK": SANDBOX_NETBLOCK,
        "SB_SANDBOX_UID": str(SANDBOX_UID),
        "SB_SANDBOX_GID": str(SANDBOX_GID),
        "SB_CGROUP": f"/sys/fs/cgroup/polycode-judge/missing-{uuid.uuid4().hex[:8]}",
    })
    py = tmp_path / "user.py"
    py.write_text("print('SHOULD_NOT_RUN')\n", encoding="utf-8")
    proc = subprocess.run(
        [sys.executable, SANDBOX_HELPER, sys.executable, str(py)],
        capture_output=True, text=True, timeout=30, env=env,
    )
    assert "SHOULD_NOT_RUN" not in (proc.stdout or "")
    assert proc.returncode == 125
    assert "cgroup attach failed" in (proc.stderr or "")


def test_cgroup_concurrent_judgments_are_isolated(tmp_path: Path):
    """两个并发判题各自 pids.max=3：互不污染（NPROC 用户级计数的老问题在 cgroup 下消失）。"""
    env = os.environ.copy()
    env.update({
        "SANDBOX_NETBLOCK": SANDBOX_NETBLOCK,
        "SB_SANDBOX_UID": str(SANDBOX_UID),
        "SB_SANDBOX_GID": str(SANDBOX_GID),
    })
    procs = []
    cgs = []
    workdir = tempfile.mkdtemp(prefix="sb-cg-conc-")
    os.chmod(workdir, 0o755)
    try:
        for i in range(2):
            try:
                cg = JudgeCgroup.create(mem_kb=262144, pids_max=3, owner_uid=SANDBOX_UID,
                                        name=f"conc-{uuid.uuid4().hex[:8]}-{i}")
            except CgroupUnavailable as exc:
                pytest.skip(f"cgroup delegation unavailable on this runner: {exc}")
            cgs.append(cg)
            e = dict(env)
            e["SB_CGROUP"] = cg.path
            py = Path(workdir) / f"bomb{i}.py"
            py.write_text(FORK_BOMB, encoding="utf-8")
            procs.append((subprocess.Popen(
                [sys.executable, SANDBOX_HELPER, sys.executable, str(py)],
                stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=e,
            ), cg))
        for p, _ in procs:
            out, _err = p.communicate(timeout=60)
            m = re.search(r"FORKS (\d+)", out or "")
            assert m is not None, "每个并发判题都应独立完成"
            assert int(m.group(1)) < 30
    finally:
        shutil.rmtree(workdir, ignore_errors=True)
        for _, cg in procs:
            cg.kill_all()
            cg.destroy()


def test_cgroup_benign_code_runs(tmp_path: Path):
    proc, cg = _run_in_cgroup("print('HELLO_CG')\n", tmp_path, mem_kb=262144, pids=8)
    try:
        assert "HELLO_CG" in (proc.stdout or ""), f"rc={proc.returncode} err={proc.stderr[-500:]}"
    finally:
        cg.kill_all()
        cg.destroy()


def test_cgroup_with_seccomp_whitelist_stack(tmp_path: Path):
    """cgroup 与 seccomp 白名单叠加（M1+M2 组合可用）。"""
    proc, cg = _run_in_cgroup(
        "print('HELLO_CG_WL')\n", tmp_path, mem_kb=262144, pids=8,
        env_extra={"SB_PROFILE": "python"},
    )
    try:
        assert "HELLO_CG_WL" in (proc.stdout or ""), f"rc={proc.returncode} err={proc.stderr[-500:]}"
    finally:
        cg.kill_all()
        cg.destroy()
