# 判题沙箱测试指南

> **诚实边界**：本项目沙箱为进程级纵深防御（setuid + seccomp **黑名单** + rlimit + env 清洗），
> **不是**容器/gVisor 级多租户隔离。不要把 CI 绿灯解读为「生产多租户已就绪」。

## 测试分层（哪些 CI 已证明，哪些仍要 Docker/root）

| 层级 | 位置 | 需要 | CI 状态 |
|------|------|------|---------|
| 纯逻辑单元 | `tests/test_sandbox_helper_unit.py` | 无 root / 无 seccomp | **CI 必跑** |
| Engine 纯函数 | `tests/test_engine_pure.py` + `test_engine_rusage.py` | 无 DB | **CI 必跑** |
| 源码/配置回归 | `tests/test_fixlog_regressions.py` | 无运行时 | **CI 必跑** |
| 对抗套件（网络/ptrace/路径） | `tests/sandbox_adversarial/` | **root + libseccomp + sandbox uid + netblock 二进制** | `sandbox-adversarial.yml`（passed≥4 HARD FAIL） |
| 判题 API 集成 | `tests/integration/` | **Docker 全栈 + GATEWAY_URL** | 无 env 时 skip |

## 纯逻辑已覆盖（CI-proven，无需 Docker）

- `resolve_sandbox_ids` / `resolve_netblock`：`SB_SANDBOX_UID/GID`、`SANDBOX_NETBLOCK` 可覆盖，默认 1002/1001 与 `/usr/local/bin/sandbox_netblock`
- `parse_sb_limits`：`SB_MEM_KB` 等默认值与非法值拒绝
- `scrubbed_sandbox_env`：仅保留 PATH/HOME/LANG/TMPDIR，**DB/Redis/AMQP/JWT 不进沙箱 env**
- `netblock_ready` + fail-closed：缺失/不可执行 → `__SB_ERROR__=... refuse to judge` + **exit 125**（mock fs/fork）
- setuid 失败路径 exit 126；空参数 exit 2
- `setgroups([])` 在 `setuid` 之前；`__SB_RUSAGE__` 标记仍由 helper 写出
- engine：`_setpriv_cmd` 注入 helper + SB_*；WA/AC（compact 比较）；空源/未知语言 CE；mock engine 开关

## 仍需 Linux root / Docker（尚未在无特权 CI 上证明）

- 真实 `setuid` 到 sandbox 用户后的权限边界
- seccomp 实际拦截 AF_INET / ptrace / mount 等（需编译 netblock）
- 多语言编译器（g++/javac）在沙箱内 CE/AC 全链路
- RabbitMQ 判题队列 + Postgres 回写幂等
- `tests/integration/` 公开用例 API（见 `tests/integration/RUNBOOK.md`）

## 对抗 CI（GitHub Actions）

`.github/workflows/sandbox-adversarial.yml`：

1. `libseccomp-dev` + gcc  
2. 创建 sandbox 用户 uid 1002 / gid 1001（可用 `SB_SANDBOX_UID/GID`）  
3. 编译 netblock 到 `/usr/local/bin`  
4. **root** 跑 `tests/sandbox_adversarial`  
5. **HARD FAIL**：pytest 摘要无 `passed` 或 `passed < 4`（防假绿）

本地：

```bash
cd services/judge-service-python
sudo bash scripts/setup_sandbox_ci.sh
sudo -E python -m pytest tests/sandbox_adversarial -q
```

无 Docker 的开发机只跑：

```bash
cd services/judge-service-python
python -m pytest tests/ -q --ignore=tests/integration --ignore=tests/sandbox_adversarial
```

## 与 engine / 生产镜像

生产链路：`engine.py` → `sandbox_helper.py`（rlimit+setuid+清洗）→ `sandbox_netblock`（seccomp）→ 用户代码。

镜像与容器能力、tmpfs、非目标见 [JUDGE_PRODUCTION_IMAGE.md](JUDGE_PRODUCTION_IMAGE.md)。

FIX_LOG 回归表：[REGRESSION_FROM_FIXLOG.md](REGRESSION_FROM_FIXLOG.md)。
