# Judge 生产镜像与容器加固指南

> 目标：把「进程级 seccomp 沙箱」放进**可运维**的判题容器，并保持 fail-closed。
>
> **非目标**：本指南**不**声称生产多租户就绪。黑名单 seccomp + 共享内核 ≠ gVisor/Firecracker。

## 1. 镜像要点（已有 Dockerfile）

| 项 | 现状 |
|----|------|
| 基础镜像 | `python:3.12-slim` |
| 工具链 | g++ / gcc / default-jdk / nodejs / libseccomp |
| 用户 | `appuser` 1001；**sandbox 1002**（nologin、无 home） |
| site-packages | `chmod 700`（sandbox 不可 import DB 驱动） |
| netblock | 编译到 `/usr/local/bin/sandbox_netblock` |
| 服务 | uvicorn 以 **root** 启动（仅用于 setuid 降权） |

## 2. 运行时推荐（docker compose 片段）

见 `infra/docker/docker-compose.prod.yml`（postgres/redis/rabbitmq/auth **不对宿主 publish**）。

```yaml
  judge-service:
    privileged: false
    cap_drop: [ALL]
    cap_add: [SETUID, SETGID, SETPCAP, CHOWN, DAC_OVERRIDE]
    security_opt:
      - no-new-privileges:false   # helper 需要 setuid 降权到 sandbox
    tmpfs:
      - /tmp:size=256m,mode=1777
    environment:
      SB_MEM_KB: "1048576"
      SB_CPU_S: "2"
      SB_FSIZE_KB: "65536"
      SB_NPROC: "8"
      SB_NOFILE: "64"
      # SANDBOX_NETBLOCK: /usr/local/bin/sandbox_netblock
      # SB_SANDBOX_UID: "1002"
      # SB_SANDBOX_GID: "1001"
    networks: [internal]
    # 不对宿主 publish 8082

  judge-worker:
    privileged: false
    tmpfs:
      - /tmp:size=512m,mode=1777
```

## 3. 镜像内自检（进容器后）

```bash
id sandbox
test -x /usr/local/bin/sandbox_netblock
python - <<'PY'
from app.sandbox_helper import netblock_ready, resolve_sandbox_ids, parse_sb_limits
assert netblock_ready("/usr/local/bin/sandbox_netblock")
print("uid/gid", resolve_sandbox_ids())
print("limits", parse_sb_limits())
PY
# 有 root 时：
# python /app/app/sandbox_helper.py python3 -c 'print(1)'
# 期望：经 netblock 执行；无 netblock 时应 exit 125 + refuse to judge
```

## 4. CI：已证明 vs 仍需 Docker

### CI 已证明（无 Docker / 无 root）

| 检查 | 工作流 / 测试 |
|------|----------------|
| helper env 清洗、uid/gid 覆盖、SB_* 默认 | `tests/test_sandbox_helper_unit.py` |
| netblock 缺失 fail-closed（exit 125） | 同上（mock fs/fork） |
| engine 纯函数、rusage 标记、WA/AC 契约 | `tests/test_engine_pure.py` 等 |
| CORS/JWT/is_sample/prod ports 源码回归 | `tests/test_fixlog_regressions.py` |
| gateway/auth 纯逻辑（无 Express） | `tests/test_gateway_auth_pure.py` + `gateway/.../auth-pure.test.mjs` |
| seccomp 对抗（root + 编译 netblock） | `sandbox-adversarial.yml`，**passed≥4 HARD FAIL** |

### 仍需 Docker 或特权 Linux（未在无特权 CI 证明）

- 判题 API 端到端（RabbitMQ + Postgres 回写）
- 真实多语言编译/运行链路在 sandbox uid 下的 AC 率
- prod compose 起栈后的网络可达性（auth 不暴露等）
- 多租户威胁模型审计 / 白名单 seccomp / gVisor

## 5. 非目标（诚实）

- **不是** gVisor / Firecracker / 多租户硬隔离
- seccomp **黑名单**；多租户请换白名单 + 独立 judge 节点
- 容器网络隔离仍建议 `--network` 自定义 internal 网段

## 6. 构建示例

```bash
docker build -t polycode-judge:local services/judge-service-python
docker compose -f infra/docker/docker-compose.prod.yml up -d
```

相关：Issue #7 · `docs/SANDBOX_TESTING.md` · `docs/REGRESSION_FROM_FIXLOG.md`
