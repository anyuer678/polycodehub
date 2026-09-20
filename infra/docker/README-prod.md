# PolycodeHub 部署模式

| 文件 | 用途 | 端口暴露 |
|---|---|---|
| `infra/docker/docker-compose.yml` | 本地演示/开发 | 可将 Postgres/Redis/RabbitMQ/Web/Gateway publish 到宿主（便于调试） |
| `infra/docker/docker-compose.prod.yml` | **基线「生产向」** | DB/Redis/RabbitMQ/Auth **不对宿主 publish**；Web/Gateway 仅 `127.0.0.1` |

## prod 启动

```bash
cd infra/docker
cp .env.example .env
# 必改：POSTGRES_*、REDIS_PASSWORD、RABBITMQ_*、AUTH_JWT_SECRET（>=32，禁止占位符）
docker compose -f docker-compose.prod.yml --env-file .env up -d --build
```

## 安全要点（与 README 叙事对齐）

- auth-service 不对宿主暴露，防止绕过网关限流
- 中间件不对宿主暴露，降低横向与未授权访问面
- Web/Gateway 绑定 `127.0.0.1`；公网需另加反代 + TLS + 防火墙
- 判题沙箱仍为进程级 seccomp/rlimit，**非**多租户容器隔离（见 README/THREAT）
- `.env` 请使用强口令；JWT secret 启动校验拒绝占位符

## 相关 Issue

- security/ops：prod compose ports, FIX_LOG regressions, sandbox tests — 见仓库 Issues
