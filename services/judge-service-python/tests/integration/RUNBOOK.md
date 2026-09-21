# 说明：polycodehub API 集成测

## 本地（Docker Desktop）

```powershell
# 1. 启动 Docker Desktop 至 Running
docker ps

# 2. 基础设施
cd polycodehub/infra/docker
# 确保 .env 有本地口令（勿用占位符部署生产）
docker compose -f docker-compose.yml --env-file .env up -d postgres redis

# 3. 网关（另开终端，需 Node）
cd ../../gateway/nest-gateway
npm ci
npm run build
$env:DB_HOST="127.0.0.1"; $env:DB_PORT="5432"
$env:DB_NAME="polycodehub"; $env:DB_USER="polycode"; $env:DB_PASSWORD="<.env 中密码>"
$env:REDIS_URL="redis://:<redis密码>@127.0.0.1:6379/0"
# 其它 AUTH_SERVICE_URL 等按需；gateway 可能依赖 auth——若缺 auth 可先只验证路由存在性
npm start

# 4. 集成测
cd ../../services/judge-service-python
$env:GATEWAY_URL="http://127.0.0.1:8080"
$env:TEST_PROBLEM_ID="1"
python -m pytest tests/integration/test_public_testcases_api.py -q
```

## CI

- **源码契约**（无需 Docker）：`tests/test_r03_public_cases_contract.py` → 已在 `fixlog-regressions` job  
- **运行时 API**：需要真实 gateway；在本机 Docker 就绪后执行，或将 `GATEWAY_URL` 填入 GitHub Secrets 的自托管 runner  

## Docker 未启动时

不要假装集成已通过；保持 integration 测试 **skip**。
