# 判题沙箱测试指南

## 目标

验证用户代码在 `sandbox_helper` + `sandbox_netblock` 下不能：

- 建立 IPv4/IPv6 网络连接
- ptrace / 写系统路径
- 在缺失 netblock 时被静默放行（应 **fail-closed**，exit 125）

## 环境（与生产一致）

| 项 | 值 |
|----|-----|
| OS | Linux + libseccomp |
| sandbox 用户 | uid **1002** / gid **1001**（可用 `SB_SANDBOX_UID/GID` 覆盖） |
| netblock | `/usr/local/bin/sandbox_netblock`（可用 `SANDBOX_NETBLOCK` 覆盖） |
| helper | `app/sandbox_helper.py`（以 **root** 启动后 setuid） |

## CI（GitHub Actions）

`.github/workflows/sandbox-adversarial.yml` 会：

1. 安装 `libseccomp-dev` + gcc  
2. 创建 sandbox 用户  
3. 编译 netblock 到 `/usr/local/bin`  
4. **以 root** 跑 `tests/sandbox_adversarial`（含网络/ptrace/系统路径/fail-closed）

## 本地一键

```bash
cd services/judge-service-python
sudo bash scripts/setup_sandbox_ci.sh
```

## 验收

- [ ] CI 工作流绿色（完整对抗用例，而非仅元数据）
- [ ] 正常判题样例（Python/Java/g++）仍可通过 engine 路径
- [ ] 无 netblock 时 helper 拒绝执行（125 + stderr 标记）

## 与 engine

生产链路：`engine.py` → `sandbox_helper.py`（rlimit+setuid+清洗）→ `sandbox_netblock`（seccomp）→ 用户代码。对抗测试必须调用 **同一 helper**。
