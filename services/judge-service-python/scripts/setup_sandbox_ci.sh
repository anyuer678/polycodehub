#!/usr/bin/env bash
# 本地/CI 准备沙箱测试环境（Linux + sudo）
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
sudo apt-get update
sudo apt-get install -y libseccomp-dev gcc
sudo groupadd -g 1001 sandbox 2>/dev/null || true
sudo useradd -u 1002 -g 1001 -M -s /usr/sbin/nologin sandbox 2>/dev/null || true
sudo gcc -O2 -o /usr/local/bin/sandbox_netblock "$ROOT/sandbox_netblock.c" -lseccomp
sudo chmod 755 /usr/local/bin/sandbox_netblock
export SANDBOX_HELPER="$ROOT/app/sandbox_helper.py"
export SANDBOX_NETBLOCK=/usr/local/bin/sandbox_netblock
export SB_SANDBOX_UID=1002
export SB_SANDBOX_GID=1001
cd "$ROOT"
sudo -E python3 -m pytest tests/sandbox_adversarial -q --tb=short
