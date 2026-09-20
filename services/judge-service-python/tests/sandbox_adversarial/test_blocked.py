"""沙箱对抗用例骨架。

这些测试验证「判题沙箱应拒绝/限制」的行为。需要：
- Linux + 已构建 sandbox_netblock + 非 root 判题用户（见 judge README）
- 或 CI 中的专用 judge 镜像

在不满足环境时全部 skip，避免在开发机误红。
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import pytest

SANDBOX_HELPER = os.environ.get("SANDBOX_HELPER", "")
SANDBOX_NETBLOCK = os.environ.get("SANDBOX_NETBLOCK", "")


def _sandbox_ready() -> bool:
    return bool(SANDBOX_HELPER and Path(SANDBOX_HELPER).exists())


@pytest.mark.skipif(not _sandbox_ready(), reason="SANDBOX_HELPER not configured")
def test_sandbox_rejects_network_socket(tmp_path):
    code = tmp_path / "net.py"
    code.write_text(
        "import socket\n"
        "s=socket.socket(socket.AF_INET, socket.SOCK_STREAM)\n"
        "s.connect(('1.1.1.1', 80))\n"
        "print('CONNECTED')\n",
        encoding="utf-8",
    )
    # 实际调用方式以 judge engine 封装为准；此处占位为 helper CLI
    proc = subprocess.run(
        [SANDBOX_HELPER, sys.executable, str(code)],
        capture_output=True,
        text=True,
        timeout=20,
    )
    assert "CONNECTED" not in (proc.stdout or "")
    # seccomp 拒绝通常非 0 或 stderr 含 seccomp/operation not permitted
    assert proc.returncode != 0 or "CONNECTED" not in proc.stdout


@pytest.mark.skipif(not _sandbox_ready(), reason="SANDBOX_HELPER not configured")
def test_sandbox_rejects_ptrace(tmp_path):
    code = tmp_path / "ptrace.py"
    code.write_text(
        "import ctypes, ctypes.util\n"
        "libc=ctypes.CDLL(ctypes.util.find_library('c'))\n"
        "print('PTRACE', libc.ptrace(0,0,0,0))\n",
        encoding="utf-8",
    )
    proc = subprocess.run(
        [SANDBOX_HELPER, sys.executable, str(code)],
        capture_output=True,
        text=True,
        timeout=20,
    )
    assert proc.returncode != 0 or "EPERM" in (proc.stderr or "").upper() or "not permitted" in (proc.stderr or "").lower()


@pytest.mark.skipif(not _sandbox_ready(), reason="SANDBOX_HELPER not configured")
def test_sandbox_blocks_write_system_path(tmp_path):
    code = tmp_path / "write.py"
    code.write_text(
        "open('/etc/lumen-pwn','w').write('x')\nprint('WROTE')\n",
        encoding="utf-8",
    )
    proc = subprocess.run(
        [SANDBOX_HELPER, sys.executable, str(code)],
        capture_output=True,
        text=True,
        timeout=20,
    )
    assert "WROTE" not in (proc.stdout or "")
    assert not Path("/etc/lumen-pwn").exists()


def test_netblock_binary_missing_is_documented():
    """文档/CI 约定：缺失 sandbox_netblock 时 engine 应 fail-closed。"""
    # 仓库内应存在相关说明或 helper 源码
    root = Path(__file__).resolve().parents[3]
    hits = list(root.rglob("sandbox_helper.py")) + list(root.rglob("sandbox_netblock.c"))
    assert hits, "expected sandbox_helper.py or sandbox_netblock.c in repo"
