@echo off
rem 停止容器并清空全部数据（数据库/缓存/消息）
rem 注意：此操作不可恢复！
setlocal
chcp 65001 >nul
for %%I in ("%~dp0..") do set "BASE=%%~fI"
set "COMPOSE=%BASE%\infra\docker\docker-compose.yml"
set "ENVFILE=%BASE%\infra\docker\.env"
set "DOCKER=C:\Users\30816\AppData\Local\Programs\DockerDesktop\resources\bin\docker.exe"
if not exist "%DOCKER%" set "DOCKER=docker"

set /p CONFIRM="确认清空所有数据？输入 yes 继续："
if /i not "%CONFIRM%"=="yes" (
    echo 已取消。
    exit /b 0
)

"%DOCKER%" compose -f "%COMPOSE%" --env-file "%ENVFILE%" down -v
echo 已清空。下次 start.bat 将以全新数据启动。
endlocal