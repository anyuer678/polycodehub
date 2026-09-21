"""Judge unit-test conftest: keep pytest process alive on all OSes.

sandbox_helper.main() uses os._exit / os.wait4 / os.kill / resource.setrlimit.
Unit tests must mock these so a fail-closed path cannot kill pytest (INTERNALERROR
under pytest-cov on Linux runners).
"""
from __future__ import annotations

import os
import sys
import types
from pathlib import Path
from unittest import mock

import pytest

HELPER_PATH = Path(__file__).resolve().parents[1] / "app" / "sandbox_helper.py"


@pytest.fixture(autouse=True)
def _isolate_sandbox_helper_side_effects(monkeypatch):
    # Never let unit tests really hard-exit or signal the pytest process.
    monkeypatch.setattr(
        os,
        "_exit",
        lambda code: (_ for _ in ()).throw(SystemExit(code)),
        raising=False,
    )
    monkeypatch.setattr(
        os,
        "wait4",
        lambda *_a, **_k: (0, 0, types.SimpleNamespace(ru_maxrss=0)),
        raising=False,
    )
    monkeypatch.setattr(
        os,
        "kill",
        lambda *_a, **_k: None,
        raising=False,
    )
    yield


@pytest.fixture(scope="session", autouse=True)
def _ensure_resource_module():
    if "resource" not in sys.modules:
        fake = types.ModuleType("resource")
        for name in (
            "RLIMIT_AS",
            "RLIMIT_CPU",
            "RLIMIT_FSIZE",
            "RLIMIT_NOFILE",
            "RLIMIT_CORE",
            "RLIMIT_NPROC",
        ):
            setattr(fake, name, name)
        fake.setrlimit = lambda *_a, **_k: None
        sys.modules["resource"] = fake
    else:
        real = sys.modules["resource"]
        # Lowering limits as non-root in unit tests can fail on some runners.
        if hasattr(real, "setrlimit"):
            try:
                mock.patch.object(real, "setrlimit", lambda *_a, **_k: None).start()
            except Exception:
                pass
