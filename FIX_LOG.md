# PolyCodeHub 修复日志

## 2026-07-31 修复记录

### 第一轮修复（安全与核心功能）

| 编号 | 严重程度 | 问题 | 修复文件 | 修复说明 |
|------|----------|------|----------|----------|
| 1 | CRITICAL | CORS 完全开放 (`*`) | `gateway/nest-gateway/src/main.ts` | 使用环境变量 `CORS_ORIGINS` 配置白名单 |
| 2 | CRITICAL | 管理员认证仅靠邮箱/用户名 | `gateway/nest-gateway/src/main.ts` | 改为从数据库查询 `role` 字段 |
| 3 | CRITICAL | JWT Secret 使用占位符 | `services/auth-service-java/.../JwtService.java` | 启动时校验不为占位符且长度>=32 |
| 4 | CRITICAL | Redis 无密码保护 | `infra/docker/docker-compose.yml` | 添加 `--requirepass` 配置 |
| 5 | CRITICAL | 数据库密码硬编码 | `gateway/nest-gateway/src/main.ts` | 移除硬编码，必须设置环境变量 |
| 6 | CRITICAL | `.env.example` 包含真实密码 | `infra/docker/.env.example` | 改为占位符 |
| 7 | CRITICAL | 判题链路断裂 | `services/judge-service-python/app/main.py` | `/submit` 端点投递到 RabbitMQ |
| 8 | HIGH | Worker 无重连机制 | `services/judge-service-python/app/worker.py` | 添加断连自动重试 |
| 9 | HIGH | 数据库连接无池化 | `services/judge-service-python/app/worker.py` | 使用 `ThreadedConnectionPool` |
| 10 | HIGH | 批量操作无事务保护 | `gateway/nest-gateway/src/main.ts` | 使用 `BEGIN/COMMIT/ROLLBACK` |
| 11 | MEDIUM | 限流器竞态条件 | `gateway/nest-gateway/src/main.ts` | 使用 Redis `MULTI` 原子操作 |
| 12 | MEDIUM | 无分页支持 | `gateway/nest-gateway/src/main.ts` | 添加 `page/limit` 参数 |
| 13 | LOW | 缺少 healthcheck | `infra/docker/docker-compose.yml` | 所有服务添加健康检查 |

### 第二轮修复（深度安全与功能）

| 编号 | 严重程度 | 问题 | 修复文件 | 修复说明 |
|------|----------|------|----------|----------|
| 14 | CRITICAL | JWT 不含 role 字段 | `services/auth-service-java/.../JwtService.java` | `generateToken` 添加 role 参数 |
| 15 | CRITICAL | uid 类型安全问题 | `services/auth-service-java/.../JwtService.java` | 使用 `((Number) claims.get("uid")).longValue()` |
| 16 | HIGH | verify 端点 null 检查死代码 | `services/auth-service-java/.../AuthController.java` | Authorization header 改为 `required = false` |
| 17 | HIGH | 周排行榜时区 Bug | `services/judge-service-python/app/worker.py` | 使用 `calendar.timegm()` 替代 `time.mktime()` |
| 18 | HIGH | HTTP 状态码未正确设置 | `services/judge-service-python/app/main.py` | 使用 `HTTPException` 返回正确状态码 |
| 19 | MEDIUM | `__import__('json')` 反模式 | `services/judge-service-python/app/main.py` | 改为顶部 `import json` |
| 20 | MEDIUM | `raise e` 应为 `raise` | `services/judge-service-python/app/worker.py` | 保留原始堆栈信息 |
| 21 | MEDIUM | Redis 密码未验证 | `services/judge-service-python/app/worker.py` | 启动时校验 `DB_PASSWORD` 不为空 |
| 22 | MEDIUM | CORS Origins 未 trim | `gateway/nest-gateway/src/main.ts` | 添加 `.trim().filter(Boolean)` |
| 23 | MEDIUM | 系统状态端点无认证 | `gateway/nest-gateway/src/main.ts` | 添加 `requireAuth` + `isAdmin` |
| 24 | LOW | Redis 未持久化 | `infra/docker/docker-compose.yml` | 添加 `--appendonly yes` 和 volume |

### 第三轮修复（安全增强与代码质量）

| 编号 | 严重程度 | 问题 | 修复文件 | 修复说明 |
|------|----------|------|----------|----------|
| 25 | MEDIUM | 缺少安全响应头 | `gateway/nest-gateway/src/main.ts` | 添加 `helmet()` 中间件 |
| 26 | MEDIUM | 缺少输入验证 | `gateway/nest-gateway/src/main.ts` | 添加 Zod schema 验证 |
| 27 | MEDIUM | 请求体限制过大 | `gateway/nest-gateway/src/main.ts` | 从 `2mb` 降低到 `256kb` |
| 28 | LOW | 弱密码 | `infra/docker/.env` | 使用随机生成的强密码 |

### 第四轮修复（功能完善与最佳实践）

| 编号 | 严重程度 | 问题 | 修复文件 | 修复说明 |
|------|----------|------|----------|----------|
| 29 | CRITICAL | 系统状态页缺少认证头 | `apps/web/app/system-status/page.tsx` | 添加 token 和 admin 角色校验 |
| 30 | HIGH | NavBar 暴露管理员链接 | `apps/web/app/components/NavBar.tsx` | 仅 admin 用户显示管理链接 |
| 31 | HIGH | auth 代理请求无预验证 | `gateway/nest-gateway/src/main.ts` | 添加 `RegisterSchema` 和 `LoginSchema` |
| 32 | HIGH | 内部 HTTP 调用无超时 | `gateway/nest-gateway/src/main.ts` | 所有 axios 调用添加 `timeout: 5000` |
| 33 | HIGH | CORS Credentials 无条件设置 | `gateway/nest-gateway/src/main.ts` | 仅在 origin 通过白名单时设置 |
| 34 | MEDIUM | FastAPI 使用弃用事件 | `services/judge-service-python/app/main.py` | 迁移到 `lifespan` 上下文管理器 |
| 35 | LOW | 审计日志错误被静默吞掉 | `gateway/nest-gateway/src/main.ts` | 添加 `console.error` 日志 |
| 36 | LOW | 未使用的 requests 依赖 | `services/judge-service-python/requirements.txt` | 移除未使用的依赖 |

---

## 代码验证

- TypeScript 编译：✅ 通过
- Python 语法检查：✅ 通过

---

## 第五轮修复（架构优化与最佳实践）

| 编号 | 严重程度 | 问题 | 修复文件 | 修复说明 |
|------|----------|------|----------|----------|
| 37 | HIGH | 网关单文件架构（682行） | `gateway/nest-gateway/src/` | 拆分为 config/db/redis/mq/middleware/schemas/routes 模块 |
| 38 | HIGH | Docker 容器以 root 运行 | 所有 Dockerfile | 添加非 root 用户 `appuser` |
| 39 | MEDIUM | 缺少 error/loading 组件 | `apps/web/app/error.tsx` 等 | 添加 Next.js 约定文件 |
| 40 | MEDIUM | 无响应式设计 | `apps/web/app/globals.css` | 添加移动端适配媒体查询 |
| 41 | MEDIUM | 网关无优雅关闭 | `gateway/nest-gateway/src/main.ts` | 添加 SIGTERM/SIGINT 处理 |
| 42 | MEDIUM | Worker 无优雅关闭 | `services/judge-service-python/app/worker.py` | 添加信号处理和资源清理 |
| 43 | MEDIUM | Redis 无重连配置 | `gateway/nest-gateway/src/redis/index.ts` | 添加重连逻辑和健康检查 |
| 44 | MEDIUM | 无 trust proxy 配置 | `gateway/nest-gateway/src/main.ts` | 添加 `app.set('trust proxy', 1)` |
| 45 | LOW | Java Dockerfile 缓存优化 | `services/auth-service-java/Dockerfile` | 先复制 pom.xml 缓存依赖 |

---

## 第六轮修复（关键功能修复）

| 编号 | 严重程度 | 问题 | 修复文件 | 修复说明 |
|------|----------|------|----------|----------|
| 46 | CRITICAL | 提交记录路由断裂 | `gateway/nest-gateway/src/main.ts` | 拆分为 `/api/judge` 和 `/api/submissions` 两个挂载点 |
| 47 | CRITICAL | 提交失败状态永久 PENDING | `services/judge-service-python/app/worker.py` | Worker 异常时更新状态为 RE |
| 48 | CRITICAL | Redis 重连策略未生效 | `gateway/nest-gateway/src/redis/index.ts` | 通过 socket.reconnectStrategy 传入 |
| 49 | HIGH | Docker 镜像缺少 curl | `infra/docker/docker-compose.yml` | 改用 wget 或 python 健康检查 |
| 50 | HIGH | NEXT_PUBLIC 变量构建时无效 | `apps/web/Dockerfile` | 添加 ARG 支持构建时传入 |
| 51 | HIGH | judge-service 缺少环境变量 | `infra/docker/docker-compose.yml` | 补充 AMQP_URL 和 DB 配置 |
| 52 | MEDIUM | 排行榜泄露 Redis 键名 | `gateway/nest-gateway/src/routes/leaderboard.ts` | 从响应中移除 key 字段 |
| 53 | MEDIUM | 提交按钮可重复点击 | `apps/web/app/problems/[id]/page.tsx` | 添加 submitting 状态和 AbortController |

---

## 第七轮修复（安全与功能完善）

| 编号 | 严重程度 | 问题 | 修复文件 | 修复说明 |
|------|----------|------|----------|----------|
| 54 | CRITICAL | 提交路由双重 /judge/judge/submit | `gateway/nest-gateway/src/routes/submissions.ts` | 路由改为 `/submit`，挂载在 `/api/judge` 下 |
| 55 | CRITICAL | AbortController 未实例化 | `apps/web/app/problems/[id]/page.tsx` | onSubmit 中创建 AbortController 并传递 signal |
| 56 | CRITICAL | Admin 页面不验证用户角色 | `apps/web/app/admin/*/page.tsx` | 添加 role 字段检查，非管理员跳转首页 |
| 57 | CRITICAL | 注册后未触发 auth-changed | `apps/web/app/register/page.tsx` | 添加 window.dispatchEvent |
| 58 | HIGH | 密码输入框缺少 minLength | `apps/web/app/login/register/page.tsx` | 添加 minLength={6} |
| 59 | HIGH | 管理员规则文本泄露 | `apps/web/app/admin/problems/page.tsx` | 移除旧规则描述文本 |
| 60 | MEDIUM | health 端点暴露内部状态 | `gateway/nest-gateway/src/routes/system.ts` | 简化返回，仅返回 status |
| 61 | MEDIUM | CORS 缺少 Max-Age 缓存 | `gateway/nest-gateway/src/main.ts` | 添加 Access-Control-Max-Age: 86400 |

---

## 第八轮修复（安全加固与架构优化）

| 编号 | 严重程度 | 问题 | 修复文件 | 修复说明 |
|------|----------|------|----------|----------|
| 62 | CRITICAL | 公共 API 暴露全部测试用例 | `gateway/nest-gateway/src/routes/problems.ts` | 仅返回 is_sample=TRUE 的用例 |
| 63 | CRITICAL | submissions 路由双重挂载泄露 API | `gateway/nest-gateway/src/main.ts` | 拆分为 judge.ts 和 submissions.ts 独立路由 |
| 64 | HIGH | 查询参数无白名单验证 | `gateway/nest-gateway/src/routes/submissions.ts` | 添加 status/language 白名单验证 |
| 65 | MEDIUM | 注册页缺少 router.refresh() | `apps/web/app/register/page.tsx` | 添加 router.refresh() 保持一致性 |
| 66 | MEDIUM | 题目详情不必要的 auth 检查 | `apps/web/app/problems/[id]/page.tsx` | 移除 token 检查，允许未登录浏览题目 |

---

## 第九轮修复（深度审查专项）

| 编号 | 严重程度 | 问题 | 修复文件 | 修复说明 |
|------|----------|------|----------|----------|
| 67 | HIGH | FeatureTips 泄露管理员规则 | `apps/web/app/components/FeatureTips.tsx` | 移除 @admin.local 提示 |
| 68 | HIGH | MQ 优雅关闭触发重连 bug | `gateway/nest-gateway/src/mq/index.ts` | 添加 shuttingDown 标志和定时器取消 |
| 69 | HIGH | Redis 重连无取消机制 | `gateway/nest-gateway/src/redis/index.ts` | 添加 closeRedis 和定时器取消 |
| 70 | HIGH | MQ 发送失败提交残留 PENDING | `gateway/nest-gateway/src/routes/judge.ts` | 发送失败时更新状态为 RE |
| 71 | MEDIUM | RabbitMQ 无数据持久化 | `infra/docker/docker-compose.yml` | 添加 rabbitmq_data volume |
| 72 | MEDIUM | test case 创建无 problem 存在性检查 | `gateway/nest-gateway/src/routes/admin.ts` | 创建前校验 problem 存在，返回 404 |
| 73 | MEDIUM | 排行榜 Redis 挂掉时 500 | `gateway/nest-gateway/src/routes/leaderboard.ts` | Redis 不可用时降级查库 |
| 74 | MEDIUM | 前端语言列表与后端不一致（3 vs 7） | `apps/web/app/lib/api.ts` 等 | 创建共享常量 LANGUAGES |
| 75 | MEDIUM | 前端无统一 401 处理 | `apps/web/app/lib/api.ts` | 创建 apiFetch 自动跳转登录 |
| 76 | MEDIUM | 登录/注册无专用限流 | `gateway/nest-gateway/src/middleware/index.ts` | 添加 authRateLimiter（10次/分钟） |
| 77 | MEDIUM | init.sql 约束缺失和种子数据问题 | `infra/sql/init.sql` | role/status/language CHECK、title UNIQUE、动态种子 |
| 78 | MEDIUM | 首页 SSR health 在 Docker 中指向自身 | `apps/web/app/page.tsx` | 使用 GATEWAY_INTERNAL_URL |
| 79 | MEDIUM | 首页暴露管理员入口 | `apps/web/app/page.tsx` | 移除管理员链接 |
| 80 | LOW | system-status Hook 依赖问题 | `apps/web/app/system-status/page.tsx` | 使用 useCallback |
| 81 | LOW | email 输入无 type=email | `apps/web/app/login/register/page.tsx` | 添加 type=email |

---

## 第十轮修复（性能优化与细节完善）

| 编号 | 严重程度 | 问题 | 修复文件 | 修复说明 |
|------|----------|------|----------|----------|
| 82 | HIGH | 认证中间件每次请求调用 auth-service + 查库 | `gateway/nest-gateway/src/middleware/index.ts` | 添加 Redis 缓存（5 分钟 TTL） |
| 83 | MEDIUM | problems/submissions 无分页 UI | `apps/web/app/problems/page.tsx` 等 | 添加上一页/下一页控件 |
| 84 | MEDIUM | Java DTO 缺少 username 正则校验 | `services/auth-service-java/.../RegisterRequest.java` | 添加 @Pattern 与 @Size(max=255) |
| 85 | MEDIUM | system-status 泄露内部 URL/错误细节 | `gateway/nest-gateway/src/routes/system.ts` | 仅返回 name/ok/status |
| 86 | MEDIUM | judge-service /submit 冗余无认证端点 | `services/judge-service-python/app/main.py` | 移除端点，仅保留 /health |
| 87 | MEDIUM | 审计日志 actor_username 恒为 NULL | `services/judge-service-python/app/worker.py` | JOIN users 查询用户名 |
| 88 | LOW | auth-service 无请求日志 | `services/auth-service-java/.../AuthController.java` | 添加登录/注册/校验日志 |
| 89 | LOW | eslint lint 脚本与 flat config 不兼容 | `apps/web/package.json`, `gateway/nest-gateway/package.json` | 移除 --ext 参数 |
| 90 | LOW | 缺少 :focus-visible 无障碍样式 | `apps/web/app/globals.css` | 添加键盘焦点指示 |
| 91 | LOW | 排行榜无空数据提示 | `apps/web/app/leaderboard/page.tsx` | 添加空数据文案 |

---

## 第十一轮修复（前端交互优化）

| 编号 | 严重程度 | 问题 | 修复文件 | 修复说明 |
|------|----------|------|----------|----------|
| 92 | MEDIUM | 无共享 UI 组件 | `apps/web/app/components/ui.tsx` | 创建 Spinner/StatusBadge/DifficultyBadge/EmptyState/LoadingButton |
| 93 | MEDIUM | loading.tsx 简陋 | `apps/web/app/loading.tsx` | 使用 Spinner 动画 |
| 94 | MEDIUM | 题库无难度视觉区分 | `apps/web/app/problems/page.tsx` | 难度徽章（绿/黄/红）+ 空状态 + fade-in |
| 95 | MEDIUM | 提交记录无状态视觉区分 | `apps/web/app/submissions/page.tsx` | 状态徽章（AC绿/WA红/CE黄等） |
| 96 | MEDIUM | 判题结果展示简陋 | `apps/web/app/problems/[id]/page.tsx` | 结果网格 + 状态徽章 + 等待 spinner + 提交中禁用表单 |
| 97 | MEDIUM | admin 操作无 loading | `apps/web/app/admin/problems/page.tsx` | 创建/保存/删除均带 spinner 和禁用 |
| 98 | LOW | 排行榜无加载反馈 | `apps/web/app/leaderboard/page.tsx` | Spinner + AC 数徽章 + 空状态 |
| 99 | LOW | NavBar 无 active 高亮 | `apps/web/app/components/NavBar.tsx` | active 链接高亮 + aria-current |
| 100 | LOW | CSS 无动画/徽章样式 | `apps/web/app/globals.css` | 添加 spin/fadeIn 动画、badge 系列、result-grid |
| 101 | LOW | 前端无 package-lock.json | `apps/web/package-lock.json` | npm install 生成 |
| 102 | LOW | eslint.config.js 与 ESM 冲突 | `apps/web/eslint.config.mjs` | 迁移到 ESM 格式，lint 0 错误 |

---

## 第十二轮修复（前端与启动逻辑重构）

| 编号 | 严重程度 | 问题 | 修复文件 | 修复说明 |
|------|----------|------|----------|----------|
| 103 | HIGH | 认证状态管理分散在多个页面 | `apps/web/app/hooks/useAuth.ts` | 新增 useAuth hook：user/isLoggedIn/isAdmin + login/logout 统一管理 |
| 104 | HIGH | 登录注册后手动写 localStorage | `apps/web/app/login/page.tsx`、`register/page.tsx` | 改用 useAuth.login 触发 auth-changed |
| 105 | MEDIUM | 每次请求手动

…[truncated 32040 of 64812 bytes — rerun with narrower args to see the middle]…

回 [{id,title,difficulty,tags}] 详情，题库页/个人中心共用
- 验证：✅ 7 个 admin 页 200；创建/更新/删除题目含 tags 接口实测通过；solved 新格式正常；前端 tsc/eslint、网关 tsc 通过

---

## 第二十五轮（八项新功能 + 站内信）
- **成就徽章系统**：`GET /api/users/me/badges` 聚合 9 枚徽章（首杀/青铜/白银/黄金选手/50/100 次提交/3/7 天连续打卡/全能选手），个人中心渲染徽章墙（未达成置灰）
- **审计日志页**：`GET /api/admin/audit`（分页 + 操作者/操作类型筛选）；`/admin/audit` 页 + 管理后台 tab；日志含 action/操作者/对象/详情 jsonb
- **用户设置中心**：`PUT /api/users/me/profile`（改昵称，冲突 409）+ `PUT /api/users/me/password`（bcryptjs 校验旧密码）；`/settings` 页 + NavBar 设置入口
- **代码分享链接**：`PUT /api/submissions/:id/share` 生成/撤销 24 位 hex token；匿名 `GET /api/submissions/share/:token` 只读展示；提交详情页生成/复制/取消，`/share/[token]` 公开页
- **答题热力图/公开主页**：`GET /api/users/:username`（资料 + 近 90 天 AC 活动 + 已 AC 列表）；`/users/[username]` 热力图网格；排行榜/审计/提交/分享/比赛榜单用户名全部可点击进公开主页
- **比赛系统**：`contests`/`contest_problems` 表；提交时按进行中比赛自动关联 `submissions.contest_id`；admin 建/改/删（时间校验、题目校验、事务）；`GET /api/contests[:id][/leaderboard]`（榜单按 AC 数降序 + 首次 AC 用时罚时）；`/admin/contests` 管理页 + `/contests` 列表 + `/contests/[id]` 详情（题目 + 30s 自动刷榜单）；NavBar 比赛入口
- **自定义测试试运行**：`runs` 表；`POST /api/judge/run` 入队（mode=run）→ worker 执行一次返回 stdout/stderr/runtime；`GET /api/judge/runs/:id` 轮询；题目页"试运行"面板（自定义 stdin + 输出展示）
- **题解系统**：`solutions` 表 + 审核流；`POST /api/solutions`（须已 AC 该题，403 拦截）→ `PUT /api/admin/solutions/:id` 审核；`GET /api/problems/:id/solutions`（仅展示 approved）；题目页题解区（列表/展开/发布表单）+ `/admin/solutions` 审核页 + `/api/solutions/me`
- **站内信（用户侧新增）**：`notifications` 表 + `/api/notifications`（未读数/列表/单条已读/全部已读）+ admin 群发/指定用户（UserPicker）；个人中心通知列表 + 未读高亮；AdminPage 统一容器重构 admin 布局
- **排行榜幂等修复（用户侧新增）**：`save_verdict` 返回旧状态；按 (旧,新) 状态机 increment/decrement AC 计数，rejudge 或 worker 异常转非 AC 时回退，避免重判计数错误
- 管理后台布局调整：移除顶部卡片横幅，收敛为纯 tab 导航
- 验证：详见下方"第二十五轮验证"

---

## 第二十六轮（用户互动 + 每日一题结算 + 教师角色）

- **关注/粉丝**：`follows` 表；`PUT/DELETE /api/users/:id/follow`（自关注 400、幂等）；`GET /api/users/:username/followers|following`；公开主页返回 `follower_count/following_count/followed_by_me`（需带登录态），主页粉丝/关注列表弹层 + 关注按钮
- **公开主页留言板**：`profile_messages` 表；`GET /api/users/:username/messages`（公开读）+ `POST`（登录、自留言 400、content 1-1000）；主页留言列表 + 输入框
- **题解评论区**：`solution_comments` 表；`GET/POST /api/solutions/:id/comments`（content 1-2000）；题解展开区内联评论
- **每日一题 v2（当日 24:00 截止 + 公布当日情况 + 可提前结束）**：`daily_problems` 表（date 唯一、status pending|finished、end_type auto|manual、ended_at/ended_by）；北京时间（UTC+8）自然日，每日 24:00 自动结算（网关 setInterval 每分钟扫过期 pending 兜底 + 公开接口读时惰性结算双保险）；结算后首页/历史页公布结果（提交数/AC 数/AC 人数/通过率/最快 AC/AC 排行榜）；教师/管理员 `POST /admin/daily-problem/end` 手动提前结束；`GET /api/daily-problem/history` 历史列表（带每日结果摘要）
- **角色分流 成员/教师/管理员**：`ROLE_TEACHER` + `requireRole(...roles)` 中间件；`chk_role` 约束扩为 user/teacher/admin（live DB + init.sql 同步）；管理后台默认 teacher 可进，题目/用例/比赛/每日一题/题解审核放行教师，用户管理/提交/公告/站内信/审计/统计仍 admin-only（403 实测）；题目/比赛 `created_by` 归属校验（教师只能管理自己创建的，越权 403）；教师创建题目自动记 created_by
- 前端：`AuthGate` 支持 `staff` 模式；admin layout 按角色过滤 tab；NavBar 教师可见管理后台；用户管理页角色筛选/徽章/一键设教师；公开主页互动 UI；首页每日一题卡片（进行中/已结束状态 + 结果摘要 + 历史入口）；`/daily` 历史页；admin 每日一题页提前结束按钮 + 当日情况展示
- **首页模块化（用户反馈"主页凌乱"后追加）**：`/api/home-modules`（公开读）+ `PUT /api/admin/home-modules`（管理员写，settings.homepage_modules 存 JSON）；6 个模块（顶部横幅/每日一题/功能入口 默认开，平台统计/技术栈徽章/判题流程 默认关）；首页 SSR 按开关渲染，功能入口改为 4 卡（新增比赛）；`/admin/home` 首页设置页（勾选 + 保存）
- 验证：详见下方"第二十六轮验证"

---

## 代码审查修复（四代理全栈审查 + 二轮修复）

- **四代理并行审查**（网关 TS/前端 Next.js/判题 Python+认证 Java/infra SQL+Docker）：确认全库无 SQL 注入、前端零 XSS、判题无 shell 注入、`save_verdict` 幂等、每日结算幂等+北京时区正确、JWT secret 启动校验、ban 缓存版本号即时生效
- **Critical 修复**：
  - 分享链接路由被遮蔽：`GET /share/:token` 原注册在 `GET /:id` 之后，Express 按序匹配导致 share 被当 id 解析 400 → `routes/submissions.ts` 调整注册顺序（分享路由前置）
  - 判题无沙箱隔离（`JUDGE_USE_DOCKER` 未实现，用户代码可与 worker 同容器读取 DB 凭据）→ 已实现进程级隔离沙箱：`sandbox_helper.py`（root 设 rlimit → `os.setgroups([])` 清空补充组 → setgid/setuid 降权到 sandbox → exec），engine 注入仅含 PATH/HOME/LANG/TMPDIR 的清洗环境、有界读取输出、超时 killpg；`__SB_RUSAGE__` 上报子进程自身峰值内存避免假 MLE；容器级网络隔离（--network=none）仍为残余风险，见 engine.py 头注释
- **网关 Important 修复**：
  - 限流器永不生效：node-redis v4 `multi().exec()` 返回 `[error,value]` 元组，原 `Number(results[0])` 得 NaN → `middleware/rateLimit.ts` 改为取 `results[0][1]` 并兼容 string/number
  - 5xx 泄漏内部错误详情：`middleware/http.ts` `parseError` 对 status>=500 不再回显 detail（内部 message/响应数据不回传客户端，仍打日志）
  - rejudge 排行榜竞态+跨周期错扣：`routes/admin.ts` 改为条件 UPDATE（仅当本次是首个把 AC+已计数翻转为 PENDING 的请求才扣减，防并发双扣）；扣减 key 改用提交原始 `created_at` 所在周期（`getWeekKey/getMonthKey` 接受日期参数），避免跨周/月错扣
  - 每日一题 PUT 可复活已结算日期：`routes/admin.ts` 检查今日 `status != 'pending'` 则 409，拒绝重置已结束的每日一题
  - buildHistory N+1（30 天 × 4 查询）：`services/daily.ts` 新增 `computeHistorySummaries` 批处理（数组参数 unnest 分组聚合 + DISTINCT ON 最快 AC），合并为 2 条 SQL
- **前端修复**（`api.ts`/`NavBar.tsx`/`AuthGate.tsx`/`problems/[id]`/`SolutionsPanel`/`admin/test-cases`）：
  - 登录 401 劫持：login/register 路径不再触发全局"认证过期"跳转，密码错误正常展示
  - 退出登录幽灵登录：`handleLogout` 改为 await 服务端清 Cookie 完成后再跳转
  - fetch 竞态：题目页/题解面板/用例页加载加 cancelled 标志，丢弃过期响应
  - AuthGate 增加 verifying 状态：确认登录态期间显示"正在确认登录状态…"而非误闪"需要登录"
- 验证：✅ 网关 tsc、前端 tsc/eslint 全绿；gateway/web 重建部署全 healthy；分享链接生成→匿名读取→撤销→404 全链路实测；rejudge 入队→重新判题（WA，runtime 20→43ms）；每日一题 end→PUT 409（守卫生效）→SQL 还原 pending/problem15；`/api/daily-problem/history` 批处理查询返回正常；Redis 限流计数实测递增（13 次请求）；登录/注册/排行榜/首页全 200

---

- 第二十六轮验证：✅ 网关 tsc、前端 tsc/eslint 全绿；gateway/web 镜像重建部署、容器全 healthy；注册→管理员后台一键设教师→教师登录（role=teacher）；教师建题成功（created_by 记录）、改自己的题成功、改管理员的题 403、访问 admin-only /users 403；教师设每日一题→公开接口 pending→加用例→真实提交 AC（48ms，当日窗口内）→提前结束（end_type=manual）→公开接口返回当日情况（submissions=1/ac=1/100%/最快 mem26 48ms/榜单）；`/daily-problem/history` 返回结果摘要；关注→粉丝数 1→带登录态 followed_by_me=true→取关归零；留言（中文入库正常）；题解发布→教师审核通过→评论发布/列表可见；10 页面全 200；测试数据清理（用户 18/19、题目 35、题解/评论/留言/关注全清，每日一题恢复为 15 题 pending）
- 第二十六轮首页模块化验证：✅ `/api/home-modules` 返回 6 模块（3 开 3 关）；管理员 PUT 保存成功；SSR 实测首页 HTML 含 hero/feature-card/每日一题卡、不含 stat-strip/tech-badge/flow-grid（与配置一致）；`/admin/home` 页 200
- 第二十五轮验证：✅ 网关 tsc、前端 tsc/eslint 全绿；gateway/web/judge-worker 镜像重建部署、容器全 healthy；接口实测：`/admin/audit` 返回 38 条日志、`/admin/solutions` 200、`/api/contests` 200、`/me/badges` 返回 9 徽章；试运行 Python (`21`→`42`，stdin/stdout/runtime 14ms)、分享（生成 token→匿名可读）、题解发布→审核通过→公开列表可见、比赛创建(ongoing)→提交自动关联 contest_id→榜单显示 AC=1 罚时 60 分钟；11 个新页面/详情页全部 200；全链路测试数据清理（runs/solutions/contests/用户/Redis 计数归零，留合法提交 3 条）
- 第二十二轮验证：✅ 公告 CRUD（中文正常、公开接口仅返回启用公告）；每日一题设置→公开接口返回题目+日期、首页 SSR 含卡片；封禁立即 401/解封恢复/自封禁 400；批量导入 1 题+3 用例事务入库且新题判题 AC 76ms；admin 提交列表筛选正常、重判重新执行（76ms→66ms）；全部页面 200；测试数据清理（22 题/2 用户/0 公告），角色恢复
- 第二十三轮验证：✅ 题库 32 题（新 10 题各 2-3 用例）；真实判题"多数元素"AC 63ms 且 /me/solved 返回该题（已 AC 标记闭环）；页面 200；admin 登录后可访问 admin/stats；测试数据清理、排行榜归零
- 第二十四轮验证：✅ 7 个 admin 页 200；NavBar 收窄为单入口；题目创建/编辑/删除含 tags 接口实测；/me/solved 详情格式；前端 tsc/eslint、网关 tsc 通过
- TypeScript 编译：✅ 通过（网关 tsc、前端 tsc）
- 前端 ESLint：✅ 通过（0 错误 0 警告）
- 前端构建：✅ 通过（next build）
- Python 语法检查：✅ 通过（py_compile）
- bat 脚本：✅ start/status/logs 实测通过（cmd 运行）
- 判题引擎端到端：✅ 真实执行 Python/Node/C++（本地）；容器内 python3/node/java/c++ 运行时齐备；真实提交 Python 两数之和 → AC（35ms，两用例全过），排行榜随之更新（ac=1/rate=100%）
- WA/RE/TLE/CE 路径：✅ 验证（答案不符 WA、运行异常 RE 带回 Traceback、超时 TLE、编译失败 CE）
- Java 编译：⚠️ 未验证（本机无 Maven；判题 java 运行时容器内可用）
- 第十九轮验证：✅ 网关 tsc 通过；前端 tsc/eslint 0 错 0 警；网关+web 镜像重建并部署；`/health` 容器 healthy；登录/注册页 HTML 含新组件（password-toggle/记住我/确认密码/注册导航入口）；接口实测：register→login→verify 200 带用户信息、无 token 401；Docker Desktop 引擎崩溃后自动拉起、8 容器全部恢复
- 第二十轮验证：✅ 网关 tsc、前端 tsc/eslint 通过；镜像重建部署；`/api/system/status` 由 404 变为鉴权 401（端点已存在）；首页 HTML 无 system-status 残留；CSS 产物含浅色主题（#f6f8fa 背景/白色卡片）；favicon /icon.svg 200；注册页 200；导航栏 topbar 确认 `#ffffffd9` 白玻璃
- 第二十轮补充验证：✅ 网关+web 重建部署（gateway healthy）；鉴权链路实测：register→/api/users/me 200、无效 token 401、verify 200；登录态误清（201/202）已修复
- 第二十轮提交登出修复验证：✅ 提交接口实测 200 queued；auth-service 重启 healthy；新签发 JWT exp 实测 7 天；前端 tsc/eslint 通过并重建部署；登录页 200
- 第二十轮误跳登录修复验证：✅ 前端 tsc/eslint 通过；web 重建部署；SSR 验证 /submissions、/profile 渲染"需要登录"引导卡、/admin/stats 渲染"管理员页面"引导卡（不再自动跳转）；无 useRequire* 残留调用
- 题库扩充验证：✅ 14 题入库（6 EASY / 5 MEDIUM 等）；API total=14；新题"反转字符串"真实提交 AC（50ms，3 用例全过）；测试数据清理后排行榜归零

---

## 待改进（非阻塞）

| 问题 | 优先级 | 说明 |
|------|--------|------|
| JWT 存储在 localStorage | HIGH | 建议改用 HttpOnly Cookie |
| 认证中间件每次请求查库 | MEDIUM | 可信任 JWT claims 或加 Redis 缓存 |
| 添加测试代码 | MEDIUM | 各服务均可添加单元测试 |
| Java 编译与运行验证 | MEDIUM | 需在装有 Maven 的环境执行 `mvn compile` |
| Python 容器内运行验证 | MEDIUM | 已通过真实端到端 AC 验证 | 
| 模拟判题仅用于开发 | LOW | 已改为真实判题引擎（`JUDGE_ENGINE=mock` 可回退） |
| RabbitMQ 死信队列 | LOW | 失败消息直接丢弃 |
| logout 仅失效网关缓存，JWT 过期前仍可通过 Authorization 头使用 | LOW | 需强吊销需 token 黑名单/短 TTL + 刷新机制 |

---

## 第二十七轮（用户主页模块可见性 + 个人主页收敛）

| 编号 | 严重程度 | 问题 | 修复说明 |
|------|----------|------|----------|
| 1 | HIGH | 主页模块设置 API 路径与需求不符 | `/me/profile-modules` 更名为 `/me/home-modules`（网关 + settings 页同步） |
| 2 | HIGH | 主页模块可见性只隐藏了前端、数据仍全量下发 | `GET /:username` 按模块过滤数据（solved/activity/粉丝数等隐藏时返回空）；followers/following/badges/messages 接口加 `canViewProfileModule` 守卫；留言板非公开时禁止留言 403 |
| 3 | MEDIUM | 两个个人主页设计重叠、点姓名进错页 | NavBar 用户名点击直达 `/users/[username]`；`/profile` 收敛为"个人中心"，页头加"查看我的公开主页 →"入口；公开主页本人视角加"个人中心 →"返回链接 |
| 4 | MEDIUM | settings 页模块设置 UI 缺失（handlers 已有未渲染） | 新增三态设置卡片：5 模块 ×（所有人可见/仅自己可见/隐藏）+ 保存 |
| 5 | MEDIUM | 公开主页缺徽章区块 | 新增徽章卡片（`GET /:username/badges`，未达成置灰），按 badges 模块可见性渲染 |
| 6 | LOW | settings 页 Spinner 未使用告警 | 模块加载态改用 Spinner |

- 第二十七轮验证：✅ 网关 tsc、前端 tsc、eslint 0 错 0 警（改动后已重跑）；模块可见性数据过滤与接口守卫已就位；姓名跳转统一到公开主页；设置页/主页/个人中心三处入口闭环
- 待实测：🔸 三态设置在真实容器环境保存→他人视角验证（热力图/已AC/留言板/粉丝/徽章各 hidden/self 组合）；🔸 旧路径 `/me/profile-modules` 已无调用方（确认无残留）

---

## 第二十八轮（安全审查修复：沙箱隔离 + 认证缓存 + 限流）

| 编号 | 严重程度 | 问题 | 修复说明 |
|------|----------|------|----------|
| 1 | CRITICAL | 判题沙箱无网络隔离，用户代码可直连内网 Postgres/Redis/RabbitMQ/auth-service | `sandbox_netblock.c`（C + libseccomp）：exec 用户代码前设 seccomp filter 禁 `socket(AF_INET/AF_INET6/AF_NETLINK)` → EACCES；`sandbox_helper.py` setuid 降权后经其包装 exec；Dockerfile 编译安装（弃用 PyPI 同名可疑包 `pyseccomp 0.1.2`）；容器实测网络连接被拒、正常判题/Java/g++ 不受影响 |
| 2 | CRITICAL | JWT 过期后缓存命中继续放行（最长 300s 窗口） | `getAuthUser` 缓存命中先校验 `exp`（`getJwtExp` 解析），过期删缓存返回 401；缓存写入时存 exp，旧缓存现场解码兜底 |
| 3 | HIGH | 登出不失效鉴权缓存 | `logout` 删除 `auth:user:<token>` 缓存键 |
| 4 | HIGH | 限流窗口被每次请求无限续期（计数永不衰减）+ Redis 故障时 fail-open | `rateLimit.ts` 仅首次请求（incr===1）设 TTL；`authRateLimiter` 改 `failOpen:false`（故障时 503 拒绝） |
| 5 | HIGH | 恶意提交可永久卡死判题 worker（关闭 fd 后 sleep 死循环，不耗 CPU，RLIMIT_CPU 不触发，`proc.wait()` 无限等待） | `_communicate_capped` EOF 后 `proc.wait(timeout=剩余时间)`，超时 killpg；容器实测 2s 内返回 TLE |
| 6 | MEDIUM | 判题工作目录 777（并发判题时其他沙箱进程可读/改） | `_chown_sandbox_workdir`：chown sandbox + chmod 700（兼容 Windows） |
| 7 | MEDIUM | /tmp 无磁盘配额（RLIMIT_FSIZE 只管单文件） | judge-worker 挂 `tmpfs /tmp:size=512m` |
| 8 | MEDIUM | auth-service 端口直暴露宿主，可绕过网关限流爆破 | compose 移除 auth-service 宿主端口映射（仅内部网络） |
| 9 | MEDIUM | 沙箱补充组未清空 | `os.setgroups([])`（setuid 前） |
| 10 | MEDIUM | 内存统计用 RUSAGE_CHILDREN 累计峰值（一次重编译永久假 MLE） | 解析 helper `__SB_RUSAGE__=<kb>` 子进程自身峰值（截断/伪造行防护 + 8 单测） |
| 11 | LOW | users.ts `solved`/`social` 模块隐藏时仍下发 submissions/ac_count/followed_by_me | `canSee` 门控；顺带修既有 prefer-const |
| 12 | LOW | FIX_LOG 沙箱"暂未动手"描述过时 | 同步为已实现状态 |

- 验证：✅ 判题 Python py_compile + 8 单测全绿；网关 tsc 通过、改动文件 eslint 零新增问题；`docker compose config` 合法；judge 镜像构建成功；容器实测：沙箱网络连接被拒（EACCES 13）、恶意 hang 提交 2s 内返回 TLE、正常程序/Java 21/g++ 14.2 正常
