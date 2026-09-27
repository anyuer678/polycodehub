# 红队自查笔记 — polycodehub 判题沙箱

> **诚实定位**：这是**作者自审**（self red-team），不是独立第三方审计。方法是把对抗测试
> 套件真的跑在真实 judge 镜像里、用变量隔离定位每一个异常，然后把发现的错误——包括
> 自己测试代码的错误——如实记录在这里。本文与 [THREAT_MODEL.md](../THREAT_MODEL.md)
> （威胁建模）、[SANDBOX_TESTING.md](SANDBOX_TESTING.md)（复现指南）互为补充。

## 1. 方法

- **分层怀疑**：waived 假设 = "测试绿 = 防线有效"。每条防线单独攻击一次，再叠加攻击
  一次（例如 cgroup + seccomp 白名单 + jail 同时开）。
- **变量隔离矩阵**：出现反直觉结果时，逐维切换 jail / cgroup / 文件参数 / newroot 权限
  / pids_max，先排除沙箱本体失效，再怀疑测试 harness。（S77 镜像实测的发现 3/4 即靠
  此定位。）
- **证据优先于叙述**：引用旧结论前先看当日实测——本项目自己也栽过一次（见 §4.5）。
- **诚实披露**：修不掉的写进 THREAT_MODEL 非目标章节（§4），不藏在 issue 里等人问。

## 2. 攻击面分层（对应 THREAT_MODEL §3.1 / §3.1.1–3.1.3）

| 层 | 机制 | 攻击目标 |
|---|---|---|
| M0 基座 | setuid 降权 + rlimit + env 清洗 + netblock fail-closed | 提权、资源耗尽、信息外泄 |
| M1 seccomp 白名单（opt-in） | trace 驱动 curated syscall 名单 | AF_INET / ptrace / 未入名单 syscall |
| M2 cgroup v2（opt-in） | pids.max / memory.max / swap.max=0 / cpu.max 按判题隔离 | fork 炸弹、OOM、CPU 吃满核 |
| M3 ns + chroot jail（opt-in） | PID/网络命名空间 + minimal rootfs | 逃逸、读 /etc 敏感文件、网络 |

## 3. 对抗用例（29 条，全部在真实容器/镜像内实测）

- **拒绝类**（必须拦）：AF_INET socket、ptrace、写系统路径、netblock 缺失 fail-closed、
  白名单模式下 inet 仍拒、未知 profile 拒绝。
- **资源类**（必须有证据）：pids.max 拦 fork 炸弹（真并发炸弹，串行 fork 不算数——见
  §4.3）、memory.max 超限 OOM 且 `oom_kill` 可读、cpu.max 半核节流（wall/cpu≈2 +
  `throttled_usec>0`）、cpu.max 节流下 RLIMIT_CPU 仍是 TLE 信号源。
- **隔离类**：附着失败 fail-closed（exit 125，绝不裸跑）、并发判题互不污染、PID
  namespace 隔离、/etc 敏感文件在 jail 内不可见、jail 内无网络。
- **可用类**（不能把好代码也拦死）：python/C/node/java 编译产物在白名单 + jail + cgroup
  叠加下正常跑通，unix socket（编译工具链依赖）按名单放行。

## 4. 实测发现的真实错误（全部修复，含复证）

> 这些不是理论漏洞清单，是镜像内实测抓到、修完后回归全绿的问题。前 4 条来自 S77
> 镜像内完整沙箱实测（PR #30），第 5 条来自 CI 实证与自查。

### 4.1 有 swap 的宿主上 MLE 判定静默失效（真产品缺陷）

- **现象**：512MB 分配在 64MB `memory.max` 下存活，`memory.events: max=2676,
  oom_kill=0`——MLE 证据永远不会出现。
- **根因**：宿主有 swap 时，cgroup v2 超限走「回收换页」而非 OOM kill。判题进程被
  换页拖慢但不会被打死，MLE 判定链路整体失效。
- **修复**：`JudgeCgroup.create` 写 `memory.swap.max=0`（判题不换页）；实测 `oom_kill=1`
  恢复。（PR #30）

### 4.2 jail 环境变量缺默认值导致 ENOENT

- **现象**：jail 内执行用户代码报 `execvp ENOENT`，python3「消失」。
- **根因**：`SB_NS_DIRS_RO` 无默认值，测试漏设 → jail 内根目录为空，连 python3 都没有。
- **修复**：补默认/测试统一走 `_run_ns` 同一构造路径。（PR #30）

### 4.3 fork 炸弹断言语义错误（pids.max 的真实含义）

- **现象**：测试断言 `FORKS<30` 拦截失败，但实测 FORKS=30 全成功。
- **根因**：`pids.max` 约束**并发任务数**而非累计 fork 次数。串行 fork+exit 炸弹任意
  时刻 ≤2 个任务，永远打不满上限——原断言测的是一个不存在的威胁。
- **修复**：改真并发炸弹（子进程 sleep 存活，fork 至 EAGAIN）。（PR #30）

### 4.4 测试 harness 权限链断裂

- **现象**：cgroup 用例在镜像内全 skip。
- **根因**：pytest `tmp_path` 整条目录链 `root:0700`，sandbox 用户不可穿越；java 用例
  另有三处（0700 链、限额过小、`CompressedClassSpaceSize` 1GB 预留撞 `RLIMIT_AS`）
  导致 java 用例从未真正跑过。
- **修复**：/tmp 下 mkdtemp 专用 0755 目录；java 用 JVM 参数调小并改用 /tmp。（PR #29/#30）

### 4.5 CI 环境边界与自查打假

- **GH hosted runner 的 cgroup 根对 root 只读**（mkdir/subtree_control 全 EACCES）：
  cgroup 层验证必须专门环境（特权容器），不能拿 CI 绿灯冒充。issue #23 的初版评论
  误写「CI 已验证 memory 控制器可写」（旧结论残留），与当日诊断矛盾——PATCH 修正。
  引用旧结论前先看当日证据。
- **java 白名单实证**：CI 内以完整 JDK（zulu 21）实证 21 用例全绿，curated 名单充分；
  THREAT_MODEL 3.1.1 的 experimental 标注移除，改为实证记录。（PR #29）
- **jail 内无 /sys**：cgroup 感知代码在 jail 内必须容忍缺失——已落 THREAT_MODEL
  非目标章节。（issue #25）
- **cpu.max 与 TLE 的语义协调**（issue #23，PR #31）：cpu.max 是带宽兜底（节流非
  信号），TLE 信号源仍是 RLIMIT_CPU(SIGXCPU) + wall-clock。实证：半核下 busy loop
  wall/cpu≈2 且 `throttled_usec>0`（rc=0），而 `SB_CPU_S=1` 下 SIGXCPU 仍终止——
  节流层不吞掉、不替代 TLE。

## 5. 尝试但未绕过（当前防线成立）

- fork 炸弹（真并发）→ pids.max 拦截，OOM/资源类均有 `memory.events` / `cpu.stat` 证据
- 网络外联（AF_INET）→ 黑名单与白名单两种模式均拒；netblock 缺失时 helper 直接
  exit 125 fail-closed，绝不裸跑
- ptrace / 写系统路径 / jail 内读 /etc → 全部拒绝
- 并发判题互踩 → 各自独立子组，遥测无串扰

## 6. 已知边界（诚实声明）

- **不是容器/gVisor 级隔离**，未做多租户审计——不要在不受信任的多租户场景使用
  （详见 THREAT_MODEL §4 非目标章节）。
- 本目录所有结论的**复现步骤**见 [SANDBOX_TESTING.md](SANDBOX_TESTING.md)；容器准备
  （腾空 cgroup 根 → init 子组；根层 + polycode-judge 层都启用控制器）在该文档与
  仓库提交历史中有完整记录。
- **独立第三方审计未做**——这是本项目公开承认的缺口，本文不能替代它。

## 7. 时间线

| 日期 | 事件 |
|---|---|
| 2026-09 初 | THREAT_MODEL.md 落档（15 威胁锚定实读代码行号 + 非目标章节） |
| 2026-09 中 | #24 java 白名单 CI 实证（PR #29）；#25 /sys 非目标落档 |
| 2026-09-27 | judge 镜像内完整沙箱实测：4 发现含 1 真产品缺陷（swap OOM），PR #30 merged；adversarial 27/27 + unit 37/37 |
| 2026-09-27 | #23 cpu.max 兑现实现（PR #31 merged）：节流 + TLE 语义协调，test_cgroup 8/8 |
| 2026-09-27 | 本自查笔记成文（PR 见 git blame），对抗套件终态 29 条 |
