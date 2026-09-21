# R-03 API 集成测说明

源码契约测试已在 `tests/test_r03_public_cases_contract.py`（CI 必跑）。  
本目录 `tests/integration/` 是**联调骨架**：需要真实 gateway + 数据库。

## 本地/联调步骤

```bash
# 1) 起 infra + gateway（见 infra/docker/README-prod.md 或 demo compose）
cd infra/docker
docker compose -f docker-compose.yml --env-file .env up -d postgres redis rabbitmq

# 2) 起 gateway（端口以 .env 为准，默认 8080）
cd ../../gateway/nest-gateway
npm ci && npm run build && npm start

# 3) 跑集成测
cd ../../services/judge-service-python
export GATEWAY_URL=http://127.0.0.1:8080
export TEST_PROBLEM_ID=1
python -m pytest tests/integration/test_public_testcases_api.py -q
```

## 预期

| 用例 | 期望 |
|------|------|
| 公开 `/test-cases` | HTTP 200，且每一项 `is_sample=true` |
| 非法 id | 400/404，不泄露隐藏用例 |
| admin 用例列表（可选） | 可含 `is_sample=false`（需管理员会话） |

## 路由前缀

网关路由可能是 `/api/problems/:id/test-cases` 或 `/problems/:id/test-cases`；  
测试会自动尝试两种前缀。请与 `gateway/nest-gateway/src` 中 mount 路径对齐。

## 与 FIX_LOG

- R-03 源码契约：CI `FIX_LOG source regressions`  
- R-03 运行时行为：本集成测（需环境变量，缺省 skip）
