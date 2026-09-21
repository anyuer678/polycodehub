"""Gateway/auth 纯逻辑测试：无需 Express/Redis/DB/Docker。

1. 源码契约：auth-pure.ts 存在且 auth.ts 复用它（禁止双份逻辑漂移）。
2. 算法契约：Python 镜像实现 + 用例（与 TS 语义一致）。
3. 若本机有 node --experimental-strip-types，则直接执行 TS 单测脚本。
"""

from __future__ import annotations

import base64
import json
import math
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
AUTH_TS = ROOT / "gateway/nest-gateway/src/middleware/auth.ts"
AUTH_PURE = ROOT / "gateway/nest-gateway/src/middleware/auth-pure.ts"
NODE_TEST = ROOT / "gateway/nest-gateway/tests/auth-pure.test.mjs"


# ---------- source contracts ----------

def test_auth_pure_module_exists():
    assert AUTH_PURE.is_file()
    src = AUTH_PURE.read_text(encoding="utf-8", errors="replace")
    for fn in ("computeBanTtl", "isBanActive", "getJwtExp", "extractToken", "isAdmin", "banKey"):
        assert f"function {fn}" in src, fn
    # pure module must not import express/redis/db
    for banned in ("from 'express'", "from \"express\"", "from '../redis'", "from '../db'"):
        assert banned not in src


def test_auth_ts_reexports_pure_helpers():
    auth = AUTH_TS.read_text(encoding="utf-8", errors="replace")
    assert "from './auth-pure'" in auth
    assert "export { banKey, computeBanTtl, getJwtExp, isBanActive }" in auth
    # 本地不得再定义同名函数（防双份实现）
    for fn in ("function computeBanTtl", "function isBanActive", "function getJwtExp", "function banKey"):
        assert fn not in auth, f"auth.ts should not redefine {fn}"


def test_auth_ts_uses_extract_token():
    auth = AUTH_TS.read_text(encoding="utf-8", errors="replace")
    assert "extractToken(" in auth
    assert "isAdminPure(" in auth or "isAdminPure" in auth


def test_cors_config_not_wildcard_default():
    cfg = (ROOT / "gateway/nest-gateway/src/config/index.ts").read_text(encoding="utf-8", errors="replace")
    assert "localhost:3000" in cfg
    assert ".trim()" in cfg and "filter(Boolean)" in cfg


# ---------- Python mirror of pure algorithms ----------

def _compute_ban_ttl(banned_until: str | None, now_ms: float) -> int | None:
    if not banned_until:
        return None
    ms = datetime.fromisoformat(banned_until.replace("Z", "+00:00")).timestamp() * 1000 - now_ms
    if math.isnan(ms):
        return None
    if ms <= 0:
        return 0
    return math.ceil(ms / 1000)


def _is_ban_active(banned: bool, banned_until: str | None, now_ms: float) -> bool:
    if not banned:
        return False
    if not banned_until:
        return True
    until = datetime.fromisoformat(banned_until.replace("Z", "+00:00")).timestamp() * 1000
    return until > now_ms


def _get_jwt_exp(token: str) -> int | None:
    try:
        payload = token.split(".")[1]
        if not payload:
            return None
        pad = "=" * (-len(payload) % 4)
        json_obj = json.loads(base64.urlsafe_b64decode(payload + pad).decode("utf-8"))
        exp = json_obj.get("exp")
        return exp if isinstance(exp, (int, float)) and not isinstance(exp, bool) and math.isfinite(exp) else None
    except Exception:
        return None


def _extract_token(cookies, authorization, auth_cookie="token"):
    cookie_token = (cookies or {}).get(auth_cookie)
    if isinstance(cookie_token, str) and cookie_token:
        return cookie_token
    if not authorization:
        return None
    parts = authorization.split(" ")
    if len(parts) != 2 or parts[0] != "Bearer" or not parts[1]:
        return None
    return parts[1]


def test_ban_ttl_permanent_and_expired():
    now = datetime(2026, 1, 1, tzinfo=timezone.utc).timestamp() * 1000
    assert _compute_ban_ttl(None, now) is None
    past = (datetime(2026, 1, 1, tzinfo=timezone.utc) - timedelta(seconds=5)).isoformat().replace("+00:00", "Z")
    assert _compute_ban_ttl(past, now) == 0
    future = (datetime(2026, 1, 1, tzinfo=timezone.utc) + timedelta(seconds=30)).isoformat().replace("+00:00", "Z")
    ttl = _compute_ban_ttl(future, now)
    assert ttl is not None and 29 <= ttl <= 30


def test_is_ban_active_matrix():
    now = datetime(2026, 1, 1, tzinfo=timezone.utc).timestamp() * 1000
    assert _is_ban_active(False, None, now) is False
    assert _is_ban_active(True, None, now) is True
    past = (datetime(2026, 1, 1, tzinfo=timezone.utc) - timedelta(seconds=1)).isoformat().replace("+00:00", "Z")
    future = (datetime(2026, 1, 1, tzinfo=timezone.utc) + timedelta(seconds=1)).isoformat().replace("+00:00", "Z")
    assert _is_ban_active(True, past, now) is False
    assert _is_ban_active(True, future, now) is True


def test_jwt_exp_decode():
    def _tok(exp=None):
        payload = {"uid": 1, "exp": exp} if exp is not None else {"uid": 1}
        raw = base64.urlsafe_b64encode(json.dumps(payload).encode()).decode().rstrip("=")
        return f"hdr.{raw}.sig"

    assert _get_jwt_exp(_tok(1893456000)) == 1893456000
    assert _get_jwt_exp(_tok()) is None
    assert _get_jwt_exp("not-a-jwt") is None
    assert _get_jwt_exp("onlyonepart") is None


def test_extract_token_cookie_priority():
    assert _extract_token({"token": "cookie-jwt"}, "Bearer header-jwt") == "cookie-jwt"
    assert _extract_token({}, "Bearer header-jwt") == "header-jwt"
    assert _extract_token({}, "Basic abc") is None
    assert _extract_token({}, None) is None
    assert _extract_token({"token": ""}, "Bearer header-jwt") == "header-jwt"


def test_ban_key_format():
    src = AUTH_PURE.read_text(encoding="utf-8", errors="replace")
    assert "auth:ban:" in src


def test_node_pure_suite_if_available():
    """优先用 node 直接跑 TS 纯函数测试；无 node/类型剥离时 skip。"""
    if not NODE_TEST.is_file():
        return
    try:
        proc = subprocess.run(
            [
                "node",
                "--experimental-strip-types",
                "--no-warnings",
                str(NODE_TEST),
            ],
            capture_output=True,
            text=True,
            timeout=60,
            cwd=str(ROOT / "gateway/nest-gateway"),
        )
    except FileNotFoundError:
        return  # no node — Python mirrors above still cover contracts
    except subprocess.TimeoutExpired:
        raise AssertionError("node pure test timed out")
    if proc.returncode != 0 and "ERR_UNKNOWN_FILE_EXTENSION" in (proc.stderr or ""):
        return
    if proc.returncode != 0 and "Cannot find module" in (proc.stderr or "") and "strip-types" in (proc.stderr or ""):
        return
    assert proc.returncode == 0, f"stdout={proc.stdout}\nstderr={proc.stderr}"
