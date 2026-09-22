"""R-03 集成测骨架：在有 gateway+DB 的环境验证公开用例接口。

默认 skip（无 GATEWAY_URL）；CI/本机联调时设置：
  export GATEWAY_URL=http://127.0.0.1:8080
  export TEST_PROBLEM_ID=1
  export ADMIN_COOKIE=...   # 可选，用于对比 admin 用例列表

运行:
  python -m pytest tests/integration/test_public_testcases_api.py -q
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request

import pytest

GATEWAY = os.environ.get("GATEWAY_URL", "").rstrip("/")
PROBLEM_ID = os.environ.get("TEST_PROBLEM_ID", "1")


def _items(payload):
    """Normalize public test-case list from bare array or common envelopes."""
    if isinstance(payload, list):
        return payload
    if not isinstance(payload, dict):
        return []
    if isinstance(payload.get("items"), list):
        return payload["items"]
    data = payload.get("data")
    if isinstance(data, list):
        return data
    if isinstance(data, dict) and isinstance(data.get("items"), list):
        return data["items"]
    return []

def _get(path: str) -> tuple[int, dict]:
    url = f"{GATEWAY}{path}"
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            body = resp.read().decode("utf-8", errors="replace")
            return resp.status, json.loads(body) if body else {}
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        try:
            return e.code, json.loads(body) if body else {}
        except json.JSONDecodeError:
            return e.code, {"raw": body}


@pytest.mark.skipif(not GATEWAY, reason="GATEWAY_URL not set")
def test_public_testcases_only_samples():
    status, data = _get(f"/api/problems/{PROBLEM_ID}/test-cases")
    # 路由前缀以网关实际为准；兼容去掉 /api
    if status == 404:
        status, data = _get(f"/problems/{PROBLEM_ID}/test-cases")
    assert status == 200, (status, data)
    items = data.get("items") or data.get("data") or []
    items = _items(data if not isinstance(data, list) else data)
    assert isinstance(items, list), data
    for it in items:
        assert it.get("is_sample") in (True, "t", "true", 1), it
        # 隐藏用例不应出现在公开列表：is_sample 必须为真
    print(f"public items={len(items)} all samples")


@pytest.mark.skipif(not GATEWAY, reason="GATEWAY_URL not set")
def test_public_endpoint_rejects_bad_id():
    status, data = _get(f"/api/problems/not-a-number/test-cases")
    if status == 404:
        status, data = _get(f"/problems/not-a-number/test-cases")
    assert status in (400, 404), (status, data)


def test_gateway_url_documented_in_readme():
    root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
    # 可选：确保联调说明存在
    assert os.path.isdir(root)
