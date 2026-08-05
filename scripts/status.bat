@echo off
rem 查看容器与服务状态
setlocal
chcp 65001 >nul
for %%I in ("%~dp0..") do set "BASE=%%~fI"
set "COMPOSE=%BASE%\infra\docker\docker-compose.yml"
set "ENVFILE=%BASE%\infra\docker\.env"
set "DOCKER=C:\Users\30816\AppData\Local\Programs\DockerDesktop\resources\bin\docker.exe"
if not exist "%DOCKER%" set "DOCKER=docker"

"%DOCKER%" info >nul 2>&1
if errorlevel 1 (
    echo Docker 引擎未运行。
    exit /b 1
)

echo === 容器状态 ===
"%DOCKER%" compose -f "%COMPOSE%" --env-file "%ENVFILE%" ps
echo.
echo === 端口速查 ===
echo   Web 3000   网关 8080   认证 8081   判题 8082
echo   RabbitMQ 管理台 http://localhost:15672
echo.
echo === 健康速查 ===
powershell -NoProfile -Command "try { (Invoke-WebRequest -UseBasicParsing -Uri 'http://localhost:8080/health' -TimeoutSec 5).Content } catch { 'gateway 不可达' }"
endlocal