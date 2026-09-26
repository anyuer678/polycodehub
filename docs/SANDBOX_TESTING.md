# 判题沙箱测试指南

> **诚实边界**：本项目沙箱为进程级纵深防御（setuid + seccomp **黑名单**（默认）/ **白名单**（opt-in）+ rlimit + env 清洗），
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

## 白名单模式（opt-in，SB_PROFILE）

在黑名单（默认放行+定向拒绝）之上提供**默认拒绝**的 seccomp 白名单模式：

| 模式 | 触发条件 | 语义 |
|------|----------|------|
| 黑名单（默认） | 未设 `SB_PROFILE` | 行为与历史版本完全一致，零回归风险 |
| 白名单 | engine 侧 `JUDGE_SECCOMP_WHITELIST=1` 且 `_setpriv_cmd` 传入 `SB_PROFILE` | 名单外 syscall 一律 `EPERM`；`socket` 仅放行 AF_UNIX 域（参数过滤）；未知 profile → netblock 退出 **125**（fail-closed，绝不回退黑名单） |

- profile 名单在 [`sandbox_profiles.h`](../services/judge-service-python/sandbox_profiles.h)（由 `scripts/gen_whitelist.py` 生成，勿手改）：
  `c` / `python` / `node` / `java` / `build-c`（gcc/g++ 编译）/ `build-java`（javac 编译）。
- **当前提交的名单是 curated bootstrap（人工基线）**；`java` / `build-java` 为 experimental（JVM/编译器 syscall 面大，尚未在 CI 实测）。
- 名单内但内核不存在的 syscall：加载时跳过 + warning（不存在即无攻击面）。

### 启用前必须做的事（DoD）

1. 在目标 judge 镜像内用 `scripts/trace_syscalls.sh` 对**代表性判题负载**（真实题目的编译+运行）逐 profile 采集：
   ```bash
   SB_TRACE_DIR=traces scripts/trace_syscalls.sh python -- python3 -c "print('hi')"
   SB_TRACE_DIR=traces scripts/trace_syscalls.sh build-c -- gcc -O2 -o /tmp/h hello.c
   # ... node / java / build-java 同理
   python scripts/gen_whitelist.py --mode traces --trace-dir traces --out sandbox_profiles.h
   ```
   提交新生成的头文件（`git diff` 只应出现名单增删）。
2. 开 `JUDGE_SECCOMP_WHITELIST=1` 跑全语言 E2E 矩阵（`docs/E2E_LANG_MATRIX.md`）。
3. 灰度观察判题 RE 率——白名单过窄的表现是偶发 EPERM/RE，按 stderr 补名重新生成即可。

### 测试覆盖

- `tests/test_whitelist_gen.py`：strace 解析 / EXCLUDE（socket）/ 并集合成 / 头文件确定性 —— **CI 必跑（无需 root）**
- `tests/sandbox_adversarial/test_whitelist.py`：python/c/node 在白名单下正常运行（名单充分性）、
  INET socket 与 ptrace 仍被拒、AF_UNIX 可用、未知 profile 退出 125 —— **adversarial CI（root）实测**
- 黑名单模式回归：原 `test_blocked.py` 全部用例继续生效（不设 SB_PROFILE 即走老路径）


## cgroup v2 模式（opt-in，JUDGE_CGROUP）

在 rlimit 之上提供**按判题**的资源隔离（`app/cgroup.py`）：

| 配置 | 语义 |
|------|------|
| `JUDGE_CGROUP=off`（默认） | 仅 rlimit，行为与历史一致 |
| `JUDGE_CGROUP=auto` | cgroup v2 可写即用，不可用打 warning 回退 rlimit |
| `JUDGE_CGROUP=require` | 必须可用，不可用直接抛错（fail-visible） |

- `pids.max`：fork 炸弹防护按**判题**隔离——修复多 worker 并发下 RLIMIT_NPROC
  按【用户】全局计数、互相污染的老问题（cgroup 模式下 helper 跳过 NPROC rlimit）。
- `memory.max`：硬上限；超限 OOM kill，`memory.events` 的 `oom_kill` 计数经
  `__SB_CGROUP__=...,oom=1` 标记回传，engine 据此判 **MLE**（不再依赖 rc 猜测）。
- `memory.peak`：含 page cache 的准确峰值，engine 优先采信（`_parse_sandbox_markers`：
  末两行信任位置 + 全位置剥离防伪造，与 rusage 同策略）。
- 附着失败（helper 子进程写 `cgroup.procs` 失败）→ `__SB_ERROR__=cgroup attach failed` +
  **exit 125**，绝不裸跑用户代码。

### 测试覆盖

- `tests/test_cgroup_unit.py`：伪 cgroupfs 上的创建/附着/遥测/清理 + 三种模式降级 + 标记解析 —— **CI 必跑（无需 root）**
- `tests/sandbox_adversarial/test_cgroup.py`：fork 炸弹被 pids.max 拦截、OOM 有 oom_kill 证据、
  附着失败 fail-closed、并发判题互不污染、与白名单叠加 —— **adversarial CI（root）实测**

### 部署前提

judge 容器需要 cgroup v2 统一层级的**可写委托**（compose 典型做法：
`cgroup: privileged` + `/sys/fs/cgroup` rw 挂载，或宿主 systemd 委托专用 slice）。
不可用时 `auto` 模式可安全降级为纯 rlimit。
