# FIX_LOG → 回归检查表

将历史修复固化为可重复验证项。对照仓库根目录 `FIX_LOG.md`（若存在）补充「已关闭」状态。

| ID | 历史问题 | 回归检查 | 建议自动化 | 状态 |
|---|---|---|---|---|
| R-01 | CORS 过宽 `*` | gateway CORS 仅允许配置的 origin；默认非 `*` | `tests/test_fixlog_regressions.py::test_r01_*` | **源码回归已加（CI）** |
| R-02 | 硬编码密码 | 源码与 compose 无明文生产口令；`.env.example` 仅占位 | secret scan CI | 扫描已做（公开仓干净） |
| R-03 | 隐藏用例泄露 | 公开 problems 路由仅 `is_sample=TRUE` | `test_r03_hidden_testcases_not_public_query` | **源码回归已加**；API 集成测仍待 |
| R-04 | JWT 占位 secret | JwtService 拒绝空/`replace-with`/长度&lt;32 | `test_r04_jwt_secret_validation_in_code` | **源码回归已加**；auth 启动集成测待 |
| R-05 | auth 被绕过直连 | prod compose 不 publish auth | `test_r05_r06_prod_compose_*` | **已加** prod compose + 源码回归 |
| R-06 | 中间件宿主暴露 | prod 不 publish 5432/6379/5672 | 同上 | **已加** |
| R-07 | 判题沙箱逃逸类 | `tests/sandbox_adversarial/` + helper fail-closed | sandbox-adversarial CI（passed≥4） | **CI 6 PASSED** + 源码回归 + `test_sandbox_helper_unit.py`（无 root mock） |
| R-08 | 破坏性命令/路径 | worker 仅在沙箱工作目录写 | `tests/test_engine_workdir.py`（prefix/0700/env 无密钥/cwd=/tmp） | **单元回归已加** |
| R-09 | 网关鉴权纯逻辑 | ban TTL / JWT exp / cookie 优先 | `test_gateway_auth_pure.py` + `auth-pure.test.mjs` | **CI 已挂**（无 Express） |
| R-10 | engine 判题契约 | 空源/未知语言 CE、WA/AC、SB_* 注入 | `test_engine_pure.py` | **单元回归已加** |

CI job：`fixlog-regressions`（`.github/workflows/ci.yml`）。

## 如何用

1. 每次修 FIX_LOG 中问题 → 在本表加一行  
2. 能自动化的改为测试文件并挂 CI  
3. PR 模板勾选「已更新 REGRESSION_FROM_FIXLOG」

## 相关文件

- `infra/docker/docker-compose.prod.yml`
- `infra/docker/README-prod.md`
- `services/judge-service-python/tests/sandbox_adversarial/`
