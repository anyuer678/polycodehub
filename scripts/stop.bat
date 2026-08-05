@echo off
rem 停止全部容器（保留数据）
setlocal
chcp 65001 >nul
for %%I in ("%~dp0..") do set "BASE=%%~fI"
set "COMPOSE=%BASE%\infra\docker\docker-compose.yml"
set "ENVFILE=%BASE%\infra\docker\.env"
set "DOCKER=C:\Users\30816\AppData\Local\Programs\DockerDesktop\resources\bin\docker.exe"
if not exist "%DOCKER%" set "DOCKER=docker"

"%DOCKER%" compose -f "%COMPOSE%" --env-file "%ENVFILE%" down
echo.
echo 已停止。数据已保留（启动时自动恢复）。
endlocal