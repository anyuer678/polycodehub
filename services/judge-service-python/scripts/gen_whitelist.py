#!/usr/bin/env python3
"""生成 sandbox_profiles.h（netblock 白名单模式的 syscall 名单）。

两种模式：
  --mode curated            使用本文件内置的 curated 基线 + 各语言增集（无 strace 条件时的
                            bootstrap 名单，当前提交的 sandbox_profiles.h 即由此生成）
  --mode traces --trace-dir DIR   使用 scripts/trace_syscalls.sh 采集的 <profile>.syscalls
                            文件（每行一个 syscall 名）：BASELINE ∪ trace − EXCLUDE，
                            这是部署环境的正式采集路径，结果应提交回仓库

统一规则：
  - `socket` 永不进入名单（EXCLUDE）：白名单模式下由 netblock 以参数过滤显式放行
    仅 AF_UNIX 域；AF_INET/AF_INET6/AF_NETLINK 维持默认拒绝。
  - 输出确定性排序，重复提交不产生 diff 噪音。
"""

from __future__ import annotations

import argparse
import datetime as _dt
import re
from pathlib import Path

# 基线：任何动态链接 ELF 运行时（glibc 启动 + 判题 I/O + 信号 + 退出）所需的最小集合，
# 以及 unix-socket IPC 操作面（socket() 本身按域过滤，这些操作在拿不到 INET fd 时无危害）。
BASELINE: set[str] = {
    "execve", "exit", "exit_group",
    "brk", "mmap", "munmap", "mprotect", "mremap", "madvise",
    "read", "write", "readv", "writev", "pread64", "pwrite64", "lseek",
    "openat", "close", "fstat", "newfstatat", "statx", "access", "faccessat", "faccessat2",
    "getcwd", "readlink", "readlinkat", "ioctl", "getdents64",
    "rt_sigaction", "rt_sigprocmask", "rt_sigreturn", "sigaltstack", "rt_sigtimedwait",
    "set_tid_address", "set_robust_list", "rseq", "prlimit64", "getrlimit",
    "getrandom", "arch_prctl", "sysinfo", "uname",
    "getpid", "getppid", "gettid", "getuid", "geteuid", "getgid", "getegid",
    "clock_gettime", "gettimeofday", "nanosleep", "clock_nanosleep", "time",
    "futex", "sched_getaffinity", "sched_yield", "getcpu",
    "fcntl", "dup", "dup2", "dup3", "pipe", "pipe2", "socketpair",
    "wait4", "waitid", "kill", "tgkill",
    "poll", "ppoll", "select", "pselect6",
    "mkdir", "mkdirat", "unlink", "unlinkat", "rename", "renameat", "renameat2", "rmdir",
    "chmod", "fchmod", "fchmodat", "chown", "fchown", "fchownat",
    "ftruncate", "fsync", "fdatasync", "utimensat",
    "getrusage", "setitimer", "getitimer",
    "membarrier", "restart_syscall", "statfs", "fstatfs",
    "connect", "bind", "listen", "accept", "accept4", "getsockname", "getpeername",
    "getsockopt", "setsockopt", "sendmsg", "recvmsg", "sendto", "recvfrom", "shutdown",
}

# 采集/合并时强制排除：socket 由 netblock 参数过滤特判
EXCLUDE: set[str] = {"socket"}

# curated bootstrap 模式的各语言增集（相对 BASELINE）。
# java / build-* 为 experimental：JVM 与编译器 syscall 面大，尚未在 CI 实测跑通，
# 启用前必须先用 trace_syscalls.sh 在目标镜像里采集复核。
CURATED_EXTRA: dict[str, set[str]] = {
    "c": set(),
    "python": {"flock"},
    "node": {
        "epoll_create1", "epoll_ctl", "epoll_wait", "epoll_pwait", "eventfd2",
        "timerfd_create", "timerfd_settime", "timerfd_gettime", "memfd_create",
    },
    "java": {
        "clone", "clone3", "memfd_create", "sched_setaffinity", "sched_setscheduler",
        "sched_getscheduler", "epoll_create1", "epoll_ctl", "epoll_wait", "eventfd2",
        "flock",
    },
    "build-c": {"clone", "clone3", "flock", "ftruncate"},
    "build-java": {
        "clone", "clone3", "memfd_create", "sched_setaffinity", "sched_setscheduler",
        "sched_getscheduler", "epoll_create1", "epoll_ctl", "epoll_wait", "eventfd2",
        "flock",
    },
}

PROFILE_ORDER = ["c", "python", "node", "java", "build-c", "build-java"]

_TRACE_NAME_RE = re.compile(r"^(?:\[pid\s+\d+\]\s+)?([A-Za-z0-9_]+)\(")


def parse_strace_text(text: str) -> set[str]:
    """从 strace -f -o 输出中提取 syscall 名集合（忽略信号行 / 退出行）。"""
    names: set[str] = set()
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith(("---", "+++")):
            continue
        m = _TRACE_NAME_RE.match(line)
        if m:
            names.add(m.group(1))
    return names


def load_traces(trace_dir: Path) -> dict[str, set[str]]:
    traces: dict[str, set[str]] = {}
    for f in sorted(trace_dir.glob("*.syscalls")):
        names = {
            ln.strip()
            for ln in f.read_text(encoding="utf-8").splitlines()
            if ln.strip() and not ln.startswith("#")
        }
        traces[f.stem] = names
    return traces


def build_profiles(mode: str, trace_dir: Path | None) -> dict[str, set[str]]:
    profiles: dict[str, set[str]] = {}
    if mode == "curated":
        for name in PROFILE_ORDER:
            profiles[name] = BASELINE | CURATED_EXTRA.get(name, set())
    else:
        assert trace_dir is not None
        traces = load_traces(trace_dir)
        for name, traced in traces.items():
            profiles[name] = (BASELINE | traced) - EXCLUDE
        for name in PROFILE_ORDER:
            # 采集缺失的已知 profile：退回 curated，避免意外产出空/残缺名单
            profiles.setdefault(name, BASELINE | CURATED_EXTRA.get(name, set()))
    return profiles


def emit_header(profiles: dict[str, set[str]], mode: str, now: str) -> str:
    lines: list[str] = []
    lines.append("/* sandbox_profiles.h —— 由 scripts/gen_whitelist.py 生成，勿手改。")
    lines.append(f" * 生成时间: {now} UTC | 模式: {mode}")
    if mode == "curated":
        lines.append(" * 来源: curated bootstrap（人工基线 + 各语言增集）；")
        lines.append(" * 正式启用前应在目标镜像用 scripts/trace_syscalls.sh 重新采集并覆盖本文件。")
    lines.append(" * socket 不在名单内：由 netblock 以参数过滤仅放行 AF_UNIX 域。")
    lines.append(" * java / build-java 为 experimental（未在 CI 实测）。")
    lines.append(" */")
    lines.append("#ifndef SANDBOX_PROFILES_H")
    lines.append("#define SANDBOX_PROFILES_H")
    lines.append("")
    lines.append("struct SBProfile {")
    lines.append("    const char *name;")
    lines.append("    const char *const *syscalls; /* NULL 结尾 */")
    lines.append("};")
    lines.append("")
    for name in PROFILE_ORDER:
        names = sorted(profiles[name])
        lines.append(f"/* profile: {name} —— {len(names)} syscalls */")
        lines.append(f"static const char *const SB_LIST_{name.replace('-', '_')}[] = {{")
        for n in names:
            lines.append(f'    "{n}",')
        lines.append("    NULL,")
        lines.append("};")
        lines.append("")
    lines.append("static const struct SBProfile SB_PROFILES[] = {")
    for name in PROFILE_ORDER:
        lines.append(f'    {{ "{name}", SB_LIST_{name.replace("-", "_")} }},')
    lines.append("};")
    lines.append("")
    lines.append("#endif /* SANDBOX_PROFILES_H */")
    return "\n".join(lines) + "\n"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--mode", choices=("curated", "traces"), default="curated")
    ap.add_argument("--trace-dir", type=Path, default=None)
    ap.add_argument("--out", type=Path, default=Path("sandbox_profiles.h"))
    args = ap.parse_args()
    if args.mode == "traces" and (args.trace_dir is None or not args.trace_dir.is_dir()):
        ap.error("--mode traces 需要 --trace-dir 指向采集目录")
    now = _dt.datetime.now(_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    profiles = build_profiles(args.mode, args.trace_dir)
    header = emit_header(profiles, args.mode, now)
    args.out.write_text(header, encoding="utf-8", newline="\n")
    total = sum(len(v) for v in profiles.values())
    print(f"wrote {args.out} ({len(profiles)} profiles, {total} entries, mode={args.mode})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
