"""FIX_LOG 源码级回归（可在无 DB 的 CI 上跑）。

证明：关键安全控制仍存在于源码中；防止「文档写了、代码又改回去」。
"""

from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]


def _read(rel: str) -> str:
    p = ROOT / rel
    assert p.is_file(), f"missing {rel}"
    return p.read_text(encoding="utf-8", errors="replace")


def test_r01_cors_default_not_wildcard():
    """R-01: CORS 默认不是 *；未配置时回退 localhost:3000。"""
    cfg = _read("gateway/nest-gateway/src/config/index.ts")
    assert "CORS_ORIGINS" in cfg
    assert "localhost:3000" in cfg
    # 不允许出现把 * 当作默认 origin 列表的写法
    assert "['*']" not in cfg and '"*"' not in cfg.split("allowedOrigins")[-1][:200]
    main = _read("gateway/nest-gateway/src/main.ts")
    assert "allowedOrigins.includes(origin)" in main or "allowedOrigins" in main
    # 不应无条件反射任意 origin
    assert "Access-Control-Allow-Origin: *" not in main
    assert re.search(r"Access-Control-Allow-Origin['\"]?\s*:\s*['\"]\*", main) is None


def test_r01_cors_origins_trimmed():
    """FIX_LOG #22: CORS origins 有 trim/filter。"""
    cfg = _read("gateway/nest-gateway/src/config/index.ts")
    assert ".trim()" in cfg and "filter(Boolean)" in cfg


def test_r03_hidden_testcases_not_public_query():
    """R-03: 公开题目用例查询仅 is_sample = TRUE。"""
    problems = _read("gateway/nest-gateway/src/routes/problems.ts")
    assert "is_sample = TRUE" in problems or "is_sample = true" in problems.lower()
    # 公开路径不应 SELECT 全量 test_cases 而不带 is_sample 条件
    # （宽松断言：存在 is_sample 过滤）
    assert re.search(r"is_sample\s*=\s*TRUE", problems, re.I) is not None


def test_r04_jwt_secret_validation_in_code():
    """R-04: JwtService 校验 secret 非空、非占位、长度>=32。"""
    jwt = _read(
        "services/auth-service-java/src/main/java/com/polycodehub/auth/service/JwtService.java"
    )
    assert "AUTH_JWT_SECRET" in jwt or "auth.jwt.secret" in jwt or "secret" in jwt
    assert "replace-with" in jwt
    assert "length() < 32" in jwt or "length()<32" in jwt


def test_r05_r06_prod_compose_no_host_publish_middleware():
    """R-05/R-06: prod compose 不把 DB/MQ/auth publish 到宿主。"""
    prod = _read("infra/docker/docker-compose.prod.yml")
    # 不应出现 postgres/redis/rabbitmq/auth 的 ports: "xxxx:xxxx" 宿主发布
    # 允许 web/gateway 绑定 127.0.0.1
    bad = []
    for block_name in ("postgres:", "redis:", "rabbitmq:", "auth-service:", "judge"):
        # crude: find service block
        m = re.search(rf"^\s{{2}}{re.escape(block_name)}:.*?(?=^\s{{2}}\w|\Z)", prod, re.M | re.S)
        if not m:
            continue
        block = m.group(0)
        if re.search(r"^\s+ports:\s*$", block, re.M):
            # ports listed - check lines
            ports_sec = re.search(r"^\s+ports:\n((?:\s+-\s+.+\n)+)", block, re.M)
            if ports_sec:
                for line in ports_sec.group(1).splitlines():
                    if "127.0.0.1" not in line and re.search(r"\d+:\d+", line):
                        bad.append(f"{block_name} {line.strip()}")
    assert not bad, f"prod compose host-publishes middleware: {bad}"
    assert "expose:" in prod
    # web/gateway 应绑 127.0.0.1
    assert "127.0.0.1" in prod


def test_r07_sandbox_files_and_helper_fallback():
    """R-07: helper/netblock 源码存在；netblock 缺失时 fail-closed。"""
    helper = _read("services/judge-service-python/app/sandbox_helper.py")
    assert "sandbox_netblock" in helper
    assert "refuse to judge" in helper or "missing" in helper
    net = _read("services/judge-service-python/sandbox_netblock.c")
    assert "seccomp" in net
    assert "SCMP_SYS(socket)" in net or "SCMP_SYS(socket" in net


def test_sandbox_tests_exist():
    tdir = ROOT / "services/judge-service-python/tests/sandbox_adversarial"
    assert any(tdir.glob("test_*.py"))
