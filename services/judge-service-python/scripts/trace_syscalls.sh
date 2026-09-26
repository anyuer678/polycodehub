#!/usr/bin/env bash
# 采集某语言运行时/编译器的真实 syscall 集（白名单名单的数据来源）。
#
# 用法:
#   SB_TRACE_DIR=./traces scripts/trace_syscalls.sh <profile> -- <cmd...>
#
# 示例（在 judge 镜像内 / 有 gcc+libseccomp 的 Linux 环境）:
#   SB_TRACE_DIR=traces scripts/trace_syscalls.sh python -- python3 -c "print('hi')"
#   SB_TRACE_DIR=traces scripts/trace_syscalls.sh build-c -- gcc -O2 -o /tmp/h hello.c
#
# 输出: $SB_TRACE_DIR/<profile>.syscalls（每行一个 syscall 名，供 gen_whitelist.py --mode traces 使用）
#
# 采集注意：
#   - 用**代表性判题负载**采集（真实题目的编译 + 运行 + 读写临时文件），只采最小负载
#     会得到过窄名单，启用白名单后表现为偶发 EPERM/RE。
#   - 采集必须覆盖编译与运行两个阶段（profile 分开：c/python/node/java=运行，build-*=编译）。
set -euo pipefail

PROFILE="${1:?usage: trace_syscalls.sh <profile> -- <cmd...>}"
shift
[ "${1:-}" = "--" ] && shift

OUT_DIR="${SB_TRACE_DIR:-./traces}"
mkdir -p "$OUT_DIR"
LOG="$OUT_DIR/$PROFILE.trace"

command -v strace >/dev/null || { echo "需要 strace（apt-get install -y strace）" >&2; exit 1; }

strace -f -qq -o "$LOG" "$@"

# 行形如: [pid 123] openat(...) = 3 ｜ 无 pid 前缀 ｜ 信号行 --- / +++ 退出行（忽略）
sed -E 's/^\[pid +[0-9]+\] //' "$LOG" \
  | grep -oE '^[A-Za-z0-9_]+\(' \
  | tr -d '(' \
  | sort -u > "$OUT_DIR/$PROFILE.syscalls"

echo "profile=$PROFILE syscalls=$(wc -l < "$OUT_DIR/$PROFILE.syscalls") file=$OUT_DIR/$PROFILE.syscalls"
