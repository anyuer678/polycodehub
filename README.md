# PolyCodeHub

[![GitHub Pages](https://img.shields.io/badge/%F0%9F%8C%90-%E5%9C%A8%E7%BA%BF%E9%A2%84%E8%A7%88-2ea44f)](https://anyuer678.github.io/polycodehub/)
[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue)](https://www.typescriptlang.org/)
[![Python](https://img.shields.io/badge/Python-3.12-green)](https://www.python.org/)
[![Java](https://img.shields.io/badge/Java-21-orange)](https://www.java.com/)
[![Docker](https://img.shields.io/badge/Docker-Compose-2496ED)](https://www.docker.com/)

**全栈在线判题（OJ）平台** — 开发者社区 + 代码评测 + 排行榜 + 管理后台 + 异步任务链路。

支持 Web 端完整使用，覆盖题库练习、代码提交、实时判题、比赛、每日一题、题解分享与用户社区互动，判题运行在**进程级隔离沙箱**中。

## 功能特性

### 判题核心
- **多语言支持** — Python 3 / Node.js / C++ (g++ 14) / C (gcc 14) / Java 21
- **真实判题沙箱** — 非容器进程级隔离：
  - `setuid` 降权到专用 sandbox 用户 + 清空补充组
  - **seccomp 网络隔离**（禁止 `AF_INET`/`AF_INET6`/`AF_NETLINK` socket，判题代码无法触达内网服务）
  - 资源限制（虚拟内存 / CPU / 文件大小 / 进程数 / 文件描述符）
  - 环境变量清洗（凭据不可见）、`site-packages` 权限收紧
  - 子进程自身峰值内存统计（`__SB_RUSAGE__`），杜绝累计值导致的假 MLE
  - 恶意程序（关闭 fd 后 sleep 死循环）会被超时机制终止，不会卡死 Worker
- **判题状态机** — `PENDING → AC / WA / CE / RE / TLE / MLE`，幂等回写与排行榜计数联动
- **自定义试运行** — 提交前用自定义 stdin 在线试跑代码
- **测试用例管理** — 单条 / 批量 JSON 导入 / 编辑 / 删除

### 平台功能
- **题库** — 难度分级（EASY/MEDIUM/HARD）、标签、分页
- **排行榜** — 总榜 / 周榜 / 月榜（Redis ZSet，断连自动降级查库）
- **比赛系统** — 建赛、关联题目、进行中提交自动关联、实时榜单（AC 数 + 罚时）
- **每日一题** — 北京时间自然日结算、结果公布、教师可提前结束
- **题解系统** — 已 AC 用户发布题解 + 审核流 + 评论
- **用户社区** — 关注/粉丝、公开主页留言板、答题热力图、成就徽章（9 枚）、站内信通知
- **代码分享** — 提交详情生成 24 位 token 的只读分享链接
- **公开主页模块可见性** — 每个模块可设 `public / self / hidden`，数据按可见性过滤下发
- **管理后台** — 题目/用例/比赛/每日一题/题解审核/用户/公告/通知/审计日志/统计（角色分流：admin / teacher）

### 安全与工程
- 认证：JWT（HttpOnly Cookie）+ 网关鉴权缓存（版本号失效 + `exp` 过期校验）+ 登录失败锁定
- 鉴权缓存登出即失效；认证端点限流 `fail-closed`（Redis 故障时拒绝而非放行）
- 审计日志、统一响应结构（`code + message + requestId + data`）、限流、CORS 白名单、Zod 输入校验
- 凭据全部走环境变量，`.env` 不入库，启动时校验非占位符

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | Next.js + TypeScript |
| API 网关 | Node.js + Express + TypeScript |
| 认证服务 | Java 21 + Spring Boot |
| 判题服务 | Python 3.12 + FastAPI + 进程级沙箱 |
| 数据库 | PostgreSQL 16 |
| 缓存 | Redis 7（排行榜 / 限流 / 鉴权缓存） |
| 消息队列 | RabbitMQ（判题任务异步链路） |
| 编排 | Docker Compose |

## 快速开始

### 环境要求
- Docker Desktop（含 Docker Compose）
- Windows（脚本）或任意可运行 Docker 的环境

### 方式 A：一键启动（Windows，推荐）

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\start.ps1
# 可选参数：
#   -Rebuild        强制重新构建镜像
#   -NoHealthCheck  跳过启动后的健康检查
#   -SkipEnv        跳过 .env 生成检查
```

脚本自动完成：检查 Docker daemon → 生成 `infra\docker\.env`（随机强密码 + JWT 密钥）→ `docker compose up -d --build` → 健康检查（最多 120s）→ 日志写入 `logs\`。

### 方式 B：手动命令

```bash
copy infra\docker\.env.example infra\docker\.env
docker compose -f infra/docker/docker-compose.yml --env-file infra/docker/.env up -d --build
```

### 访问地址

| 服务 | 地址 |
|------|------|
| Web | http://localhost:3000 |
| 在线预览（GitHub Pages） | https://anyuer678.github.io/polycodehub/ |
| Gateway Health | http://localhost:8080/health |
| Judge API Health | http://localhost:8082/health |
| RabbitMQ 管理台 | http://localhost:15672 |

> 说明：认证服务（8081）与数据库等仅容器内网可达，不暴露宿主端口（防绕过网关限流）。

### 停止与清理

```powershell
scripts\stop-and-clean.bat   # 停止；可选删除数据卷（清空数据）
scripts\diagnose-env.bat     # 环境诊断（Docker/端口/Compose）
```

## 判题异步链路

```
前端提交 → 网关写 submissions(PENDING) → RabbitMQ 入队
  → Judge Worker 消费 → 沙箱判题（多测试用例）
  → 幂等回写结果 + 排行榜计数 → 前端轮询展示
```

## 项目结构

```
polycodehub/
├── apps/
│   └── web/                    # Next.js 前端（题库/判题/比赛/社区/管理后台）
├── gateway/
│   └── nest-gateway/           # API 网关（路由/鉴权/限流/审计/排行榜/每日一题结算）
├── services/
│   ├── auth-service-java/      # 认证服务（注册/登录/JWT）
│   └── judge-service-python/   # 判题 API + Worker + 沙箱（sandbox_helper + sandbox_netblock）
├── infra/
│   ├── docker/                 # Docker Compose 编排
│   └── sql/                    # 数据库初始化与种子数据
├── scripts/                    # 启动/停止/诊断脚本
├── FIX_LOG.md                  # 修复日志（28 轮）
└── LICENSE                     # GPL-3.0
```

## 免责声明

本项目按 **GPL-3.0** 协议以"现状"（AS IS）提供，作者与贡献者**不对使用本项目产生的任何直接、间接、偶然或后果性损失负责**，包括但不限于：实际生产/生活环境中的业务故障、数据丢失、服务中断、安全事件等任何恶劣结果。若需将本项目用于实际生产或业务场景，请自行充分评估风险，并**按需修改代码以满足你的实际需求**；任何因使用本项目（含修改后版本）造成的影响，均由使用者自行承担。

## 协议

[GPL-3.0](LICENSE) — Copyright (C) 2026 PolyCodeHub Team
