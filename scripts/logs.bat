@echo off
rem 查看日志：logs.bat          -> 全部
rem          logs.bat gateway  -> 指定服务
setlocal
chcp 65001 >nul
for %%I in ("%~dp0..") do set "BASE=%%~fI"
set "COMPOSE=%BASE%\infra\docker\docker-compose.yml"
set "ENVFILE=%BASE%\infra\docker\.env"
set "DOCKER=C:\Users\30816\AppData\Local\Programs\DockerDesktop\resources\bin\docker.exe"
if not exist "%DOCKER%" set "DOCKER=docker"

"%DOCKER%" compose -f "%COMPOSE%" --env-file "%ENVFILE%" logs --tail=50 -f %1
endlocal