# PolyCodeHub
[English](README.en.md) | 简体中文

[![GitHub Pages](https://img.shields.io/badge/%F0%9F%8C%90-%E5%9C%A8%E7%BA%BF%E9%A2%84%E8%A7%88-2ea44f)](https://anyuer678.github.io/polycodehub/)
[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue)](https://www.typescriptlang.org/)
[![Python](https://img.shields.io/badge/Python-3.12-green)](https://www.python.org/)
[![Java](https://img.shields.io/badge/Java-21-orange)](https://www.java.com/)
[![Docker](https://img.shields.io/badge/Docker-Compose-2496ED)](https://www.docker.com/)
[![CI](https://github.com/anyuer678/polycodehub/actions/workflows/ci.yml/badge.svg)](https://github.com/anyuer678/polycodehub/actions/workflows/ci.yml)
[![sandbox-adversarial](https://github.com/anyuer678/polycodehub/actions/workflows/sandbox-adversarial.yml/badge.svg)](https://github.com/anyuer678/polycodehub/actions/workflows/sandbox-adversarial.yml)

**全栈在线判题（OJ）平台** — 开发者社区 + 代码评测 + 排行榜 + 管理后台 + 异步任务链路。

支持 Web 端完整使用，覆盖题库练习、代码提交、实时判题、比赛、每日一题、题解分享与用户社区互动，判题运行在**进程级隔离沙箱**中。

<p align="center"><img src="preview.png" alt="PolyCodeHub 平台首页预览" width="800"></p>


> **安全边界说明**：沙箱为进程级纵深防御——setuid 降权 + seccomp（黑名单默认 / **trace 驱动白名单** opt-in）+ cgroup v2（pids/memory 按判题隔离，opt-in）+ namespaces & chroot jail（opt-in）+ rlimit + env 清洗。**仍不是容器级隔离、未做多租户审计**。各层启用开关、能力校验与未修复项见 [THREAT_MODEL.md](THREAT_MODEL.md) 与 [docs/SANDBOX_TESTING.md](docs/SANDBOX_TESTING.md)，演进全记录见[站点笔记](https://anyuer678.github.io/yuer.dev/notes/polycodehub-sandbox-notes/)。隐藏测试用例已从 API 查询层脱敏。请勿在不受信任的多租户场景下使用。

## 功能特性

### 判题核心
- **多语言支持** — Python 3 / Node.js / C++ (g++ 14) / C (gcc 14) / Java 21
- **真实判题沙箱** — 四层纵深防御，各层 opt-in 可独立启用、能力不可用时显式降级：
  - `setuid` 降权到专用 sandbox 用户 + 清空补充组（全部模式）
  - **seccomp 双模式**：黑名单（17 条规则，默认）+ **trace 驱动白名单**（`SB_PROFILE` 按语言放行 strace 实测 syscall 集；`socket` 仅 AF_UNIX 域参数过滤；未知 profile 退出 125 fail-closed）
  - **cgroup v2 按判题隔离**（`JUDGE_CGROUP=off/auto/require`）：`pids.max` 按判题拦截 fork 炸弹（修复 NPROC 按用户计数的并发污染）、`memory.max` 硬上限 + `memory.peak`（含 page cache）+ `oom_kill` 显式 MLE 证据
  - **namespaces + chroot jail**（`JUDGE_NS=off/auto/require`）：空 netns（无接口）+ PID ns（用户代码 = ns 内 PID 1，宿主进程不可见）+ MOUNT ns + tmpfs 最小根（运行时目录 RO bind、工作目录 RW bind、/proc ns 内挂载）
  - rlimit（虚拟内存 / CPU / 文件大小 / 文件描述符）+ 环境变量清洗（凭据不可见）+ `site-packages` 权限收紧
  - 子进程自身峰值内存统计（`__SB_RUSAGE__`），杜绝累计值导致的假 MLE
  - 恶意程序（关闭 fd 后 sleep 死循环）会被超时机制终止，不会卡死 Worker
  - 演进全记录：[判题沙箱演进（站点笔记）](https://anyuer678.github.io/yuer.dev/notes/polycodehub-sandbox-notes/)
- **判题状态机** — `PENDING → AC / WA / CE / RE / TLE / MLE`，幂等回写与排行榜计数联动
- **自定义试运行** — 提交前用自定义 stdin 在线试跑代码
- **测试用例管理** — 单条 / 批量 JSON 导入 / 编辑 / 删除；非 admin 路径不返回隐藏用例

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
# Windows（cmd/powershell）用 copy，Linux/macOS 用 cp
cp infra/docker/.env.example infra/docker/.env
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

**安全声明**：判题沙箱为进程级纵深防御（setuid + seccomp 黑名单/白名单 + cgroup v2 + namespaces/chroot + rlimit，各层 opt-in 可独立降级），**非容器级隔离**，未按生产级多租户威胁模型审计；演进记录与未修复项见 [THREAT_MODEL.md](THREAT_MODEL.md)。隐藏测试用例已从 API 查询层脱敏，但数据库中仍保留供管理员审计。自研安全机制需结合实际部署场景独立评估。

## 参与贡献

欢迎 Issue 与 PR——流程与约定见 [CONTRIBUTING.md](CONTRIBUTING.md)；安全问题请勿公开 issue，走 [SECURITY.md](SECURITY.md) 的私密报告渠道。

## 协议

[GPL-3.0](LICENSE) — Copyright (C) 2026 PolyCodeHub Team


## 部署模式

- 演示：`infra/docker/docker-compose.yml`（可暴露调试端口）
- **生产向基线**：`infra/docker/docker-compose.prod.yml` — DB/Redis/RabbitMQ/Auth 不对宿主 publish，Web/Gateway 仅绑定 127.0.0.1
- 说明见 [infra/docker/README-prod.md](infra/docker/README-prod.md)