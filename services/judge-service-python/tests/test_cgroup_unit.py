"""cgroup v2 封装与标记解析的单元测试（伪 cgroupfs，无需 Linux/root）。

运行: cd services/judge-service-python && python -m pytest tests/test_cgroup_unit.py -q
"""

from __future__ import annotations

import importlib
import os
import sys
import types
from pathlib import Path

import pytest

from app.cgroup import CgroupUnavailable, JudgeCgroup, cgroup_v2_available


@pytest.fixture()
def fake_cgroupfs(tmp_path: Path) -> Path:
    root = tmp_path / "sys" / "fs" / "cgroup"
    root.mkdir(parents=True)
    (root / "cgroup.controllers").write_text("memory pids cpu io\n", encoding="utf-8")
    (root / "cgroup.subtree_control").write_text("", encoding="utf-8")
    return root


def test_available_when_controllers_present_and_mkdir_ok(fake_cgroupfs: Path):
    assert cgroup_v2_available(str(fake_cgroupfs)) is True


def test_unavailable_without_unified_hierarchy(tmp_path: Path):
    root = tmp_path / "empty"
    root.mkdir()
    assert cgroup_v2_available(str(root)) is False


def test_create_writes_limits_and_attach_peak_oom(fake_cgroupfs: Path):
    cg = JudgeCgroup.create(mem_kb=65536, pids_max=7, root=str(fake_cgroupfs))
    assert (Path(cg.path) / "memory.max").read_text().strip() == f"{65536 * 1024}"
    assert (Path(cg.path) / "pids.max").read_text().strip() == "7"

    cg.attach(4242)
    assert (Path(cg.path) / "cgroup.procs").read_text().strip() == "4242"

    (Path(cg.path) / "memory.peak").write_text("123456789\n", encoding="utf-8")
    assert cg.peak_mem_kb() == 123456789 // 1024

    (Path(cg.path) / "memory.events").write_text("populated 0\noom_kill 2\n", encoding="utf-8")
    assert cg.oom_kills() == 2

    # 旧内核无 memory.peak → None，不抛错
    (Path(cg.path) / "memory.peak").unlink()
    assert cg.peak_mem_kb() is None

    # 伪 fs 上需手动清空（真实内核 rmdir 由内核管理，无视残留文件）
    for f in Path(cg.path).iterdir():
        f.unlink()
    cg.destroy()
    assert not Path(cg.path).exists()


def test_kill_all_prefers_cgroup_kill_file(fake_cgroupfs: Path):
    cg = JudgeCgroup.create(mem_kb=1024, pids_max=4, root=str(fake_cgroupfs))
    (Path(cg.path) / "cgroup.kill").write_text("", encoding="utf-8")
    cg.kill_all()
    assert (Path(cg.path) / "cgroup.kill").read_text().strip() == "1"


def test_kill_all_fallback_kills_pids(fake_cgroupfs: Path, monkeypatch: pytest.MonkeyPatch):
    cg = JudgeCgroup.create(mem_kb=1024, pids_max=4, root=str(fake_cgroupfs))
    (Path(cg.path) / "cgroup.procs").write_text("111 222\n", encoding="utf-8")
    killed: list[int] = []
    monkeypatch.setattr(os, "kill", lambda pid, sig: killed.append(pid))
    cg.kill_all()
    assert sorted(killed) == [111, 222]


def test_destroy_tolerates_missing_dir():
    JudgeCgroup(path=str(Path("/nonexistent/x"))).destroy()


def test_create_raises_when_root_unwritable(tmp_path: Path):
    with pytest.raises(CgroupUnavailable):
        JudgeCgroup.create(mem_kb=1024, pids_max=4, root=str(tmp_path / "not-a-cgroup"))


# ---------- cpu.max（带宽兜底，独立开关） ----------


def test_create_without_cpu_max_leaves_cpu_untouched(fake_cgroupfs: Path):
    """默认不写 cpu.max、不在 subtree_control 启用 +cpu（行为与历史完全一致）。"""
    cg = JudgeCgroup.create(mem_kb=1024, pids_max=4, root=str(fake_cgroupfs))
    assert not (Path(cg.path) / "cpu.max").exists()
    assert (fake_cgroupfs / "cgroup.subtree_control").read_text().split() == ["+memory", "+pids"]


def test_create_with_cpu_max_writes_and_enables_controller(fake_cgroupfs: Path):
    cg = JudgeCgroup.create(mem_kb=1024, pids_max=4, root=str(fake_cgroupfs),
                            cpu_max="50000 100000")
    assert (Path(cg.path) / "cpu.max").read_text().strip() == "50000 100000"
    assert (fake_cgroupfs / "cgroup.subtree_control").read_text().split() == \
        ["+memory", "+pids", "+cpu"]


def test_cpu_throttled_usec_parses_stat(fake_cgroupfs: Path):
    cg = JudgeCgroup.create(mem_kb=1024, pids_max=4, root=str(fake_cgroupfs))
    assert cg.cpu_throttled_usec() is None  # 无 cpu.stat → None
    (Path(cg.path) / "cpu.stat").write_text(
        "usage_usec 1000\nthrottled_usec 424242\nnr_throttled 7\n", encoding="utf-8")
    assert cg.cpu_throttled_usec() == 424242


# ---------- engine 标记解析 ----------


@pytest.fixture()
def engine_mod():
    if "psycopg2" not in sys.modules:
        stub = types.ModuleType("psycopg2")
        stub.pool = types.SimpleNamespace(
            ThreadedConnectionPool=object, SimpleConnectionPool=object)
        stub.extensions = types.SimpleNamespace(connection=object)
        sys.modules["psycopg2"] = stub
    return importlib.import_module("app.engine")


def test_parse_rusage_only(engine_mod):
    kb, peak, oom, cleaned = engine_mod.RealJudgeEngine._parse_sandbox_markers(
        "out\n__SB_RUSAGE__=1234\n")
    assert (kb, peak, oom, cleaned) == (1234, None, None, "out\n")


def test_parse_cgroup_marker_second_to_last(engine_mod):
    err = "out\n__SB_CGROUP__=5678,oom=1\n__SB_RUSAGE__=1234\n"
    kb, peak, oom, cleaned = engine_mod.RealJudgeEngine._parse_sandbox_markers(err)
    assert (kb, peak, oom) == (1234, 5678, 1)
    assert cleaned == "out\n"


def test_parse_forged_lines_stripped_but_not_trusted(engine_mod):
    # 伪造行必须行首匹配才可能被剥离/误信（与 rusage 同策略）；数值只从末两行读取
    err = ("__SB_CGROUP__=1,oom=0\n__SB_CGROUP__=9,oom=9\n"
           "__SB_CGROUP__=5678,oom=1\n__SB_RUSAGE__=5\n")
    kb, peak, oom, cleaned = engine_mod.RealJudgeEngine._parse_sandbox_markers(err)
    assert (peak, oom) == (5678, 1)  # 只信末两行位置
    assert "__SB_CGROUP__" not in cleaned  # 全位置剥离
    assert "__SB_RUSAGE__" not in cleaned


def test_parse_rusage_missing_returns_none(engine_mod):
    kb, peak, oom, cleaned = engine_mod.RealJudgeEngine._parse_sandbox_markers("plain output\n")
    assert (kb, peak, oom, cleaned) == (None, None, None, "plain output\n")


def test_parse_truncated_output_not_trusted(engine_mod):
    err = "x" * engine_mod.MAX_OUTPUT_CHARS + "__SB_RUSAGE__=1234\n"
    kb, peak, oom, _ = engine_mod.RealJudgeEngine._parse_sandbox_markers(err)
    assert (kb, peak, oom) == (None, None, None)


# ---------- engine _maybe_cgroup 三种模式 ----------


def test_maybe_cgroup_off_returns_none(engine_mod, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(engine_mod, "CGROUP_MODE", "off")
    assert engine_mod.RealJudgeEngine._maybe_cgroup(object(), 1024, 4) is None


def test_maybe_cgroup_auto_falls_back(engine_mod, monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    mod = importlib.import_module("app.cgroup")
    monkeypatch.setattr(engine_mod, "CGROUP_MODE", "auto")
    monkeypatch.setattr(mod, "cgroup_v2_available", lambda root="/sys/fs/cgroup": False)
    monkeypatch.setattr(engine_mod, "cgroup_v2_available", lambda root="/sys/fs/cgroup": False)
    assert engine_mod.RealJudgeEngine._maybe_cgroup(object(), 1024, 4) is None


def test_maybe_cgroup_require_raises(engine_mod, monkeypatch: pytest.MonkeyPatch):
    mod = importlib.import_module("app.cgroup")
    monkeypatch.setattr(engine_mod, "CGROUP_MODE", "require")
    monkeypatch.setattr(mod, "cgroup_v2_available", lambda root="/sys/fs/cgroup": False)
    monkeypatch.setattr(engine_mod, "cgroup_v2_available", lambda root="/sys/fs/cgroup": False)
    with pytest.raises(CgroupUnavailable):
        engine_mod.RealJudgeEngine._maybe_cgroup(object(), 1024, 4)


def test_maybe_cgroup_passes_cpu_max(engine_mod, monkeypatch: pytest.MonkeyPatch,
                                     tmp_path: Path):
    """_maybe_cgroup 把 CGROUP_CPU_MAX 透传给 JudgeCgroup.create。"""
    mod = importlib.import_module("app.cgroup")
    captured: dict = {}

    def fake_create(*args, **kwargs):
        captured.update(kwargs)
        return mod.JudgeCgroup(path=str(tmp_path / "cg"))

    monkeypatch.setattr(engine_mod, "CGROUP_MODE", "require")
    monkeypatch.setattr(engine_mod, "cgroup_v2_available", lambda root="/sys/fs/cgroup": True)
    monkeypatch.setattr(engine_mod, "JudgeCgroup", types.SimpleNamespace(create=fake_create))
    monkeypatch.setattr(engine_mod, "SANDBOX_UID", 1002)
    monkeypatch.setattr(engine_mod, "CGROUP_CPU_MAX", "50000 100000")
    engine_mod.RealJudgeEngine._maybe_cgroup(object(), 1024, 4)
    assert captured.get("cpu_max") == "50000 100000"
