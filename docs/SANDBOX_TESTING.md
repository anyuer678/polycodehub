# 判题沙箱测试指南

## 目标

验证用户代码在 `sandbox_helper` + `sandbox_netblock` 下不能：

- 建立 IPv4/IPv6 网络连接
- ptrace / 挂载 / 写系统路径
- 在缺失 netblock 时被「静默放行」（应 fail-closed）

## 环境要求

| 项 | 要求 |
|----|------|
| OS | Linux（seccomp） |
| 用户 | 存在 uid 1002 / gid 1001（与 `sandbox_helper.py` 一致） |
| 二进制 | `/usr/local/bin/sandbox_netblock` 或 `SANDBOX_NETBLOCK` |
| helper | `services/judge-service-python/app/sandbox_helper.py` |
| 权限 | 通常需 root 执行 setuid 降权（与生产 judge 相同） |

## 一键跑

```bash
cd services/judge-service-python
export SANDBOX_HELPER="$PWD/app/sandbox_helper.py"
export SANDBOX_NETBLOCK=/usr/local/bin/sandbox_netblock   # 可选
python scripts/run_sandbox_adversarial.py
# 或
python -m pytest tests/sandbox_adversarial -q
```

## CI

`.github/workflows/sandbox-adversarial.yml`：

- best-effort 编译 `sandbox_netblock.c`
- **元数据测试**（helper/源码存在）必须通过
- 完整逃逸用例在无 sandbox 用户/netblock 时 **skip**，避免误红

## 与 engine 的关系

生产路径：`app/engine.py` → `sandbox_helper.py`（rlimit + setuid + env 清洗）→ `sandbox_netblock`（seccomp）→ 用户代码。

对抗测试脚本应调用 **同一 helper**，避免只测文档不测实现。

## 验收清单

- [ ] `test_netblock_binary_missing_is_documented` 通过
- [ ] 在 judge 镜像中：网络/ptrace/系统路径用例被拒绝
- [ ] 正常 AC 判题不受影响（Java/g++/Python 样例）
