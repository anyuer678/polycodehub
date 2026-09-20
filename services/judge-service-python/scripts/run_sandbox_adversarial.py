#!/usr/bin/env python3
"""在具备沙箱条件时运行对抗测试；否则打印说明并只跑元数据测试。"""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HELPER = os.environ.get("SANDBOX_HELPER") or str(ROOT / "app" / "sandbox_helper.py")
os.environ.setdefault("SANDBOX_HELPER", HELPER)
NETBLOCK = os.environ.get("SANDBOX_NETBLOCK", "/usr/local/bin/sandbox_netblock")
if Path(NETBLOCK).exists():
    os.environ["SANDBOX_NETBLOCK"] = NETBLOCK


def main() -> int:
    print("SANDBOX_HELPER =", HELPER)
    print("SANDBOX_NETBLOCK =", os.environ.get("SANDBOX_NETBLOCK", "(unset)"))
    if not Path(HELPER).exists():
        print("helper missing", file=sys.stderr)
        return 2
    cmd = [sys.executable, "-m", "pytest", str(ROOT / "tests" / "sandbox_adversarial"), "-q", "--tb=short"]
    print("run:", " ".join(cmd))
    return subprocess.call(cmd, cwd=ROOT)


if __name__ == "__main__":
    raise SystemExit(main())
