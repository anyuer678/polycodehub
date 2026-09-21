# Judge 生产镜像与容器加固指南

> 目标：把「进程级 seccomp 沙箱」放进**可运维**的判题容器，并保持 fail-closed。

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

```yaml
  judge-service:
    # build 使用 services/judge-service-python/Dockerfile
    privileged: false
    cap_drop:
      - ALL
    cap_add:
      - SETUID
      - SETGID
      - SETPCAP
      # seccomp/filter 可能还需要 CHOWN/DAC_OVERRIDE，按镜像实测收紧
    security_opt:
      - no-new-privileges:false   # helper 需要 setuid 降权到 sandbox
    read_only: false              # /tmp 需可写
    tmpfs:
      - /tmp:size=256m,mode=1777
    environment:
      SB_MEM_KB: "1048576"
      SB_CPU_S: "2"
      SB_FSIZE_KB: "65536"
      SB_NPROC: "8"
      SB_NOFILE: "64"
      # SANDBOX_NETBLOCK: /usr/local/bin/sandbox_netblock
    networks:
      - internal
    # 不对宿主 publish 8082

  judge-worker:
    # 与 judge 同镜像；command 由仓内 docker-compose 定义
    privileged: false
    tmpfs:
      - /tmp:size=512m,mode=1777
```

## 3. 镜像内自检（进容器）

```bash
id sandbox
test -x /usr/local/bin/sandbox_netblock
# 有 root 时：
python /app/app/sandbox_helper.py python3 -c 'print(1)'
# 期望：经 netblock 执行；无 netblock 时应 exit 125
```

## 4. CI 关联

- `sandbox-adversarial` workflow：编译 netblock + root 跑对抗套件（passed≥4）
- 本地：`services/judge-service-python/scripts/setup_sandbox_ci.sh`

## 5. 非目标（诚实）

- **不是** gVisor / Firecracker / 多租户硬隔离
- seccomp **黑名单**；生产多租户请换白名单 + 独立 judge 节点
- 容器网络隔离仍建议 `--network` 自定义 internal 网段

## 6. 构建示例

```bash
docker build -t polycode-judge:local services/judge-service-python
docker compose -f infra/docker/docker-compose.prod.yml up -d
```

相关 Issue：polycodehub #7  
FIX_LOG 回归：`docs/REGRESSION_FROM_FIXLOG.md`
