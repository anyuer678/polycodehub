# FIX_LOG → 回归检查表

将历史修复固化为可重复验证项。对照仓库根目录 `FIX_LOG.md`（若存在）补充「已关闭」状态。

| ID | 历史问题 | 回归检查 | 建议自动化 | 状态 |
|---|---|---|---|---|
| R-01 | CORS 过宽 `*` | gateway CORS 仅允许配置的 origin；默认非 `*` | 配置单测 / 启动校验 | 待补测 |
| R-02 | 硬编码密码 | 源码与 compose 无明文生产口令；`.env.example` 仅占位 | secret scan CI | 扫描已做（公开仓干净） |
| R-03 | 隐藏用例泄露 | 提交 API 不返回未公开测试用例内容 | API 集成测 | 待补测 |
| R-04 | JWT 占位 secret | 启动拒绝长度不足或 example secret | auth 启动测试 | 文档已要求；待测 |
| R-05 | auth 被绕过直连 | prod compose 不 publish auth；文档强调网关入口 | compose 审查 | **已加** `docker-compose.prod.yml` |
| R-06 | 中间件宿主暴露 | prod 不 publish 5432/6379/5672/15672 | compose 审查 | **已加** prod compose |
| R-07 | 判题沙箱逃逸类 | 见 `tests/sandbox_adversarial/` | 沙箱对抗 pytest | 骨架已加，需在 judge 环境跑 |
| R-08 | 破坏性命令/路径 | worker 仅在沙箱工作目录写 | worker 单测 | 待补 |

## 如何用

1. 每次修 FIX_LOG 中问题 → 在本表加一行  
2. 能自动化的改为测试文件并挂 CI  
3. PR 模板勾选「已更新 REGRESSION_FROM_FIXLOG」

## 相关文件

- `infra/docker/docker-compose.prod.yml`
- `infra/docker/README-prod.md`
- `services/judge-service-python/tests/sandbox_adversarial/`
