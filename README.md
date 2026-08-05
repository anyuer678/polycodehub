# PolyCodeHub

一个中大型、可运行的全栈工程项目：开发者平台 + 在线判题 + 排行榜 + 管理后台 + 异步任务链路。

## 项目目标

PolyCodeHub 用来练习并展示以下能力：

- 前后端协作开发（Web + API Gateway + 多后端服务）
- 数据库建模与业务落库（PostgreSQL）
- 缓存与排行榜（Redis ZSet）
- 异步架构（RabbitMQ 队列 + Worker 消费）
- 用户认证与权限（JWT + 简化 Admin）
- 算法判题业务闭环（提交 -> 入队 -> 判题 -> 回写 -> 展示）

---

## 技术栈

- 前端：`Next.js + TypeScript`
- 网关：`Node.js + Express + TypeScript`
- 认证服务：`Java Spring Boot`
- 判题服务：`Python (FastAPI + Worker)`
- 数据库：`PostgreSQL`
- 缓存：`Redis`
- 消息队列：`RabbitMQ`
- 编排：`Docker Compose`

---

## 当前核心功能

### 用户侧
- 注册 / 登录
- 浏览题库与题目详情
- 在线提交代码
- 异步轮询判题状态（PENDING -> AC/WA/CE/RE/TLE）
- 查看提交列表与提交详情（含失败用例输入/期望/实际）
- 查看排行榜（总榜/周榜/月榜）

### 管理员侧
- 题目管理：创建 / 更新 / 删除 / 列表
- 测试用例管理：
  - 单条创建
  - 编辑 / 删除
  - 批量 JSON 导入

### 工程侧
- 网关统一响应结构：`code + message + requestId + data`
- 基础限流（按 IP 每分钟）
- 审计日志（关键动作写入 `audit_logs`）

---

## 目录结构

- `apps/web`：前端
- `gateway/nest-gateway`：API 网关
- `services/auth-service-java`：认证服务
- `services/judge-service-python`：判题 API + Worker
- `infra/docker`：容器编排
- `infra/sql`：数据库初始化 SQL

---

## 快速启动（Windows）

### 方式 A：一键启动脚本（推荐）

在项目根目录双击运行：

- `scripts\setup-and-start.bat`

或直接执行核心脚本（功能相同，支持参数）：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\start.ps1
# 可选参数：
#   -Rebuild        强制重新构建镜像
#   -NoHealthCheck  跳过启动后的健康检查
#   -SkipEnv        跳过 .env 生成检查
```

启动脚本自动完成：

1. 检查 Docker 命令与 daemon（未就绪自动拉起 Docker Desktop 并等待最多 90s）
2. 若 `infra\docker\.env` 不存在，自动用 `scripts\generate-env.ps1` 生成：
   - PostgreSQL / Redis / RabbitMQ 随机强密码（32 位）
   - `AUTH_JWT_SECRET` 随机 64 位密钥
   - 账号统一默认 `polycodehub`，无任何占位符残留
3. `docker compose up -d --build`（失败自动带 `--build` 重试一次）
4. 轮询 Gateway / Web 健康检查（最多 120s），输出最终状态
5. 所有输出实时写入 `logs\start-<时间戳>.log`

如需清理环境，仍可运行 `scripts\stop-and-clean.bat`（可选删除数据卷）。

### 方式 B：手动命令

1. 复制环境变量文件：

```bash
copy infra\docker\.env.example infra\docker\.env
```

2. 启动服务：

```bash
docker compose -f infra/docker/docker-compose.yml --env-file infra/docker/.env up -d --build
```

3. 访问地址：

- Web: `http://localhost:3000`
- Gateway Health: `http://localhost:8080/health`
- Auth Health: `http://localhost:8081/actuator/health`
- Judge API Health: `http://localhost:8082/health`
- RabbitMQ 管理台: `http://localhost:15672`

### 停止与清理

可运行：

- `scripts\stop-and-clean.bat`

脚本会提示你：

- 仅停止并移除容器（保留 PostgreSQL 数据卷）
- 或同时删除数据卷（会清空数据库数据）

### 环境诊断

可运行：

- `scripts\diagnose-env.bat`

该脚本会检查并生成日志（位于 `scripts\logs\`）：

- Docker / WSL 命令是否存在
- Docker daemon 是否运行
- 常用端口是否被占用（3000/8080/8081/8082/15672）
- `docker compose` 是否可用

### 系统状态页

启动后访问：

- `http://localhost:3000/system-status`

用于查看 Gateway / Auth / Judge / RabbitMQ 的可达性与基础状态。

---

## 关键 API（节选）

### Auth
- `POST /api/auth/register`
- `POST /api/auth/login`

### Problems
- `GET /api/problems`
- `GET /api/problems/:id`

### Submissions
- `POST /api/judge/submit`
- `GET /api/submissions`
- `GET /api/submissions/:id`

### Leaderboard
- `GET /api/leaderboard?period=all|weekly|monthly`

### Admin - Problems
- `POST /api/admin/problems`
- `PUT /api/admin/problems/:id`
- `DELETE /api/admin/problems/:id`

### Admin - Test Cases
- `GET /api/problems/:id/test-cases`
- `POST /api/admin/problems/:id/test-cases`
- `POST /api/admin/problems/:id/test-cases/bulk`
- `PUT /api/admin/test-cases/:testCaseId`
- `DELETE /api/admin/test-cases/:testCaseId`

---

## 异步判题流程

1. 前端提交代码到网关 `POST /api/judge/submit`
2. 网关写 `submissions`（状态 PENDING）
3. 网关把任务投递到 RabbitMQ 队列
4. Judge Worker 消费任务、按 `test_cases` 判题
5. Worker 回写结果到 `submissions`
6. 前端轮询 `GET /api/submissions/:id` 展示最终结果

---

## 数据表（核心）

- `users`
- `problems`
- `test_cases`
- `submissions`
- `audit_logs`

---

## 接下来可继续扩展

- 接入真实代码沙箱（替换模拟执行）
- 引入更细粒度权限（RBAC）
- 增加 CI/CD 与自动化测试
- 引入可观测性（Prometheus/Grafana/Tracing）
- 引入 Elasticsearch 做题目检索
