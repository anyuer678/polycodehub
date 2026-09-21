"""R-03 扩展：公开用例接口与管理端用例接口分离（源码契约）。

在无数据库的 CI 上断言：
1. 公开 GET /:id/test-cases 仅查询 is_sample=TRUE
2. 管理端 admin.ts 独立维护 test_cases（可含非 sample）
3. 公开路由文件中不得出现「查全量 test_cases」的 SQL
"""

from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
GATEWAY = ROOT / "gateway/nest-gateway/src"


def _read(rel: str) -> str:
    return (GATEWAY / rel).read_text(encoding="utf-8", errors="replace")


def test_public_testcases_sql_only_samples():
    problems = _read("routes/problems.ts")
    # 抽取 test-cases handler 附近的 SQL
    m = re.search(
        r"router\.get\('/:id/test-cases'.*?ok\(res,\s*\{ items:",
        problems,
        re.S,
    )
    assert m, "public test-cases route missing"
    block = m.group(0)
    assert re.search(r"is_sample\s*=\s*TRUE", block, re.I), block
    # 不得在公开查询里去掉 is_sample 过滤
    assert "FROM test_cases" in block
    # 若 SELECT 了 test_cases 却没有 is_sample 条件则失败
    selects = re.findall(r"SELECT[\s\S]{0,400}?FROM test_cases[\s\S]{0,200}?", block, re.I)
    for s in selects:
        assert re.search(r"is_sample\s*=\s*TRUE", s, re.I), s


def test_admin_has_testcase_write_routes():
    admin = _read("routes/admin.ts")
    assert "test_cases" in admin
    assert re.search(r"INSERT INTO test_cases", admin, re.I)
    # 管理端可处理 is_sample 字段（含 false → 隐藏用例）
    assert "is_sample" in admin


def test_public_problems_file_no_unfiltered_sample_select():
    problems = _read("routes/problems.ts")
    # 拒绝：FROM test_cases 后短距离内无 is_sample
    for m in re.finditer(r"FROM test_cases", problems, re.I):
        window = problems[m.start() : m.start() + 250]
        if not re.search(r"is_sample\s*=\s*TRUE", window, re.I):
            raise AssertionError(f"unfiltered test_cases SQL near: {window[:120]!r}")
