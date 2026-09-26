"""gen_whitelist.py 单元测试：strace 解析、名单合成、头文件发射（无需 Linux/root）。

覆盖：
- parse_strace_text：[pid N] 前缀、信号行/退出行忽略、名字提取
- build_profiles：BASELINE 并集、trace 模式的 EXCLUDE（socket）剔除、未知 profile 回退 curated
- emit_header：确定性输出（两次生成逐字节一致）、NULL 结尾、SB_PROFILES 表
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

_SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
_spec = importlib.util.spec_from_file_location("gen_whitelist", _SCRIPTS / "gen_whitelist.py")
gen = importlib.util.module_from_spec(_spec)
sys.modules.setdefault("gen_whitelist", gen)
_spec.loader.exec_module(gen)


SAMPLE_TRACE = """
[pid  1234] execve("/usr/bin/python3", ["python3"], 0x... /* 50 vars */) = 0
[pid  1234] brk(NULL)                     = 0x55a000
[pid  1235] mmap(NULL, 8192, PROT_READ|PROT_WRITE, ...) = 0x7f00
[pid  1235] socket(AF_UNIX, SOCK_STREAM, 0) = 3
--- SIGCHLD {si_signo=SIGCHLD, si_code=CLD_EXITED, si_pid=1235} ---
[pid  1234] wait4(-1, ...) = 1235
+++ exited with 0 +++
"""


def test_parse_strace_text_extracts_names_and_ignores_annotations():
    names = gen.parse_strace_text(SAMPLE_TRACE)
    assert {"execve", "brk", "mmap", "socket", "wait4"} <= names
    # 信号行 / 退出行不应产生名字
    assert "SIGCHLD" not in names
    assert "exited" not in names


def test_parse_strace_text_without_pid_prefix():
    names = gen.parse_strace_text("openat(AT_FDCWD, \"/x\", O_RDONLY) = 3\n")
    assert names == {"openat"}


def test_curated_mode_unions_baseline_and_extra():
    profiles = gen.build_profiles("curated", None)
    assert set(profiles) == set(gen.PROFILE_ORDER)
    # 每个profile都是 baseline 超集
    for name, table in profiles.items():
        assert gen.BASELINE <= table, name
    # python 只比 baseline 多 curated extra
    assert profiles["python"] == gen.BASELINE | gen.CURATED_EXTRA["python"]
    # socket 永不出现在任何名单
    for table in profiles.values():
        assert "socket" not in table


def test_traces_mode_excludes_socket_and_unions_baseline(tmp_path: Path):
    (tmp_path / "mylang.syscalls").write_text("socket\nmmap\ngetpid\nfrobnicate42\n", encoding="utf-8")
    profiles = gen.build_profiles("traces", tmp_path)
    t = profiles["mylang"]
    assert "mmap" in t and "getpid" in t and "frobnicate42" in t
    assert "socket" not in t  # EXCLUDE 强制剔除
    assert gen.BASELINE <= t
    # 已知 profile 未采集时回退 curated，不会产出空名单
    assert profiles["python"] >= gen.BASELINE


def test_emit_header_deterministic_and_wellformed():
    profiles = gen.build_profiles("curated", None)
    h1 = gen.emit_header(profiles, "curated", "FIXED-TIMESTAMP")
    h2 = gen.emit_header(gen.build_profiles("curated", None), "curated", "FIXED-TIMESTAMP")
    assert h1 == h2  # 确定性：同输入逐字节一致
    for name in gen.PROFILE_ORDER:
        symbol = f"SB_LIST_{name.replace('-', '_')}"
        assert f"static const char *const {symbol}[]" in h1
        assert f'{{ "{name}", {symbol} }},' in h1
    assert h1.count("NULL,") == len(gen.PROFILE_ORDER)  # 每个名单表以 NULL 结尾
    assert "struct SBProfile" in h1


def test_emit_header_lists_are_sorted():
    profiles = gen.build_profiles("curated", None)
    profiles["c"] = {"zzz", "aaa", "mmm"}
    h = gen.emit_header(profiles, "curated", "T")
    body = h.split("SB_LIST_c[] = {", 1)[1].split("NULL,", 1)[0]
    entries = [ln.strip().strip('",') for ln in body.strip().splitlines()]
    assert entries == sorted(entries)
