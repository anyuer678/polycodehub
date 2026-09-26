"""判题专属 cgroup v2 封装（opt-in，见 engine.CGROUP_MODE）。

目标：
- pids.max：按【判题】隔离 fork 炸弹——修复多 worker 并发下 RLIMIT_NPROC 按用户
  全局计数、彼此污染的语义混乱（sandbox_helper 在 cgroup 模式下跳过 NPROC rlimit）。
- memory.max / memory.peak / memory.events(oom_kill)：硬性内存上限 + 含 page cache
  的准确峰值计量 + OOM 杀死的显式证据（wait4 ru_maxrss 对 page cache 与 OOM 是盲区）。

设计约束：
- 所有路径/根目录可注入（单测用 tmp 目录模拟 cgroupfs，无需 Linux/root）。
- 遥测（peak/oom）读取失败容忍降级；**附着（attach）失败由 sandbox_helper fail-closed**。
- 内核能力差异全部显式：cgroup.kill（≥5.14）缺失时回退逐 pid SIGKILL；控制器未在
  subtree_control 中时尝试启用（no-internal-process 约束下 root 空层级才可能成功）。
"""

from __future__ import annotations

import os
import signal
import uuid
from pathlib import Path

CGROUP_ROOT_DEFAULT = "/sys/fs/cgroup"
SUBTREE_DIR = "polycode-judge"
# Windows 本地开发无 SIGKILL 常量；生产为 Linux
_SIGKILL = getattr(signal, "SIGKILL", 9)


class CgroupUnavailable(RuntimeError):
    """cgroup v2 不可用（无统一层级 / 无写权限 / 控制器未启用）。"""


def cgroup_v2_available(root: str = CGROUP_ROOT_DEFAULT) -> bool:
    """统一层级存在且可在其下创建子组。"""
    if not os.path.isfile(os.path.join(root, "cgroup.controllers")):
        return False
    probe = os.path.join(root, f"polycode-probe-{uuid.uuid4().hex[:12]}")
    try:
        os.mkdir(probe)
        os.rmdir(probe)
        return True
    except OSError:
        return False


def _read_int(path: str) -> int | None:
    try:
        with open(path, encoding="utf-8") as f:
            return int(f.read().strip() or "0")
    except (OSError, ValueError):
        return None


class JudgeCgroup:
    """一个判题专属 cgroup v2 实例（create → attach → [peak/oom] → kill_all → destroy）。"""

    def __init__(self, path: str):
        self.path = path

    @classmethod
    def create(
        cls,
        mem_kb: int,
        pids_max: int,
        root: str = CGROUP_ROOT_DEFAULT,
        name: str | None = None,
        owner_uid: int | None = None,
    ) -> "JudgeCgroup":
        """创建 polycode-judge/<name> 子组并写入 memory.max / pids.max。

        owner_uid：chown 子组目录给 sandbox 用户（helper 子进程需自行写 cgroup.procs）。
        控制器未下放（subtree_control）时先尽力启用；失败抛 CgroupUnavailable。
        """
        if not os.path.isfile(os.path.join(root, "cgroup.controllers")):
            raise CgroupUnavailable(f"{root} is not a cgroup v2 root (missing cgroup.controllers)")
        base = os.path.join(root, SUBTREE_DIR)
        controllers = Path(root) / "cgroup.controllers"
        subtree = Path(root) / "cgroup.subtree_control"
        if controllers.is_file() and subtree.is_file():
            have = controllers.read_text(encoding="utf-8").split()
            want = [f"+{c}" for c in ("memory", "pids") if c in have]
            if want:
                try:
                    subtree.write_text(" ".join(want), encoding="utf-8")
                except OSError as exc:
                    raise CgroupUnavailable(f"enable controllers on {root}: {exc}") from exc
        try:
            os.makedirs(base, exist_ok=True)
        except OSError as exc:
            raise CgroupUnavailable(f"mkdir {base}: {exc}") from exc

        path = os.path.join(base, name or f"judge-{uuid.uuid4().hex[:16]}")
        try:
            os.mkdir(path)
        except OSError as exc:
            raise CgroupUnavailable(f"mkdir {path}: {exc}") from exc
        try:
            (Path(path) / "memory.max").write_text(f"{mem_kb * 1024}\n", encoding="utf-8")
            (Path(path) / "pids.max").write_text(f"{pids_max}\n", encoding="utf-8")
        except OSError as exc:
            raise CgroupUnavailable(f"write limits in {path}: {exc}") from exc
        if owner_uid is not None and hasattr(os, "chown"):
            try:
                os.chown(path, owner_uid, -1)
            except (OSError, PermissionError):
                # 非 root（本地开发）：跳过 chown，附着改由 engine 侧 root 完成
                pass
        return cls(path)

    def attach(self, pid: int) -> None:
        with open(os.path.join(self.path, "cgroup.procs"), "w", encoding="utf-8") as f:
            f.write(f"{pid}\n")

    def peak_mem_kb(self) -> int | None:
        """memory.peak（字节→KB）；内核 <5.19 无此文件时返回 None。"""
        v = _read_int(os.path.join(self.path, "memory.peak"))
        return None if v is None else v // 1024

    def oom_kills(self) -> int | None:
        """memory.events 中 oom_kill 计数；文件缺失返回 None。"""
        try:
            with open(os.path.join(self.path, "memory.events"), encoding="utf-8") as f:
                for line in f:
                    if line.startswith("oom_kill"):
                        return int(line.split()[1])
        except (OSError, ValueError, IndexError):
            pass
        return None

    def kill_all(self) -> None:
        """杀掉组内全部进程：优先 cgroup.kill（内核 ≥5.14），否则逐 pid SIGKILL。"""
        kill_file = os.path.join(self.path, "cgroup.kill")
        if os.path.isfile(kill_file):
            try:
                with open(kill_file, "w", encoding="utf-8") as f:
                    f.write("1\n")
                return
            except OSError:
                pass
        try:
            with open(os.path.join(self.path, "cgroup.procs"), encoding="utf-8") as f:
                pids = [int(x) for x in f.read().split()]
        except (OSError, ValueError):
            return
        for pid in pids:
            try:
                os.kill(pid, _SIGKILL)
            except (OSError, ProcessLookupError):
                pass

    def destroy(self) -> None:
        """删除子组（需为空；kill_all 之后调用）。容忍目录已消失。"""
        try:
            os.rmdir(self.path)
        except OSError:
            pass
