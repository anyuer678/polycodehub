@echo off
rem ============================================================
rem  PolyCodeHub ???????
rem  ?????? Docker ???? -> ??????????? -> ???????
rem ============================================================
setlocal
chcp 65001 >nul

for %%I in ("%~dp0..") do set "BASE=%%~fI"
set "COMPOSE=%BASE%\infra\docker\docker-compose.yml"
set "ENVFILE=%BASE%\infra\docker\.env"

set "DOCKER=C:\Users\30816\AppData\Local\Programs\DockerDesktop\resources\bin\docker.exe"
if not exist "%DOCKER%" set "DOCKER=docker"
set "DDESK=C:\Users\30816\AppData\Local\Programs\DockerDesktop\Docker Desktop.exe"

echo [ 1/4 ] ??? Docker ????...
"%DOCKER%" info >nul 2>&1
if errorlevel 1 (
    echo        Docker ��???��????????? Docker Desktop...
    if exist "%DDESK%" (
        start "" "%DDESK%"
    )
    set "READY="
    for /l %%i in (1,1,30) do (
        ping -n 4 127.0.0.1 >nul
        if defined READY goto docker_ok
        "%DOCKER%" info >nul 2>&1
        if not errorlevel 1 set "READY=1"
    )
    echo        [???] Docker ?????��????????????? Docker Desktop ???????
    exit /b 1
)
:docker_ok
echo        Docker ?????????
echo.

echo [ 2/4 ] ??�t??????...
if not exist "%ENVFILE%" (
    echo        ��??? .env?????????????????????...
    powershell -NoProfile -ExecutionPolicy Bypass -File "%BASE%\scripts\generate-env.ps1"
)
echo        ???t???

echo [ 3/4 ] ???????????????????��?????...
echo [ 3/4 ] build and start containers...
if /i "%~1"=="-NoBuild" (
    "%DOCKER%" compose -f "%COMPOSE%" --env-file "%ENVFILE%" up -d --no-build
) else (
    rem default: --build so code changes take effect (cache makes it fast when nothing changed)
    "%DOCKER%" compose -f "%COMPOSE%" --env-file "%ENVFILE%" up -d --build
)
if errorlevel 1 (
    echo        [????] ???????????????????????
    exit /b 1
)

echo [ 4/4 ] ??????????...
set "WEB_OK="
for /l %%i in (1,1,40) do (
    ping -n 4 127.0.0.1 >nul
    if defined WEB_OK goto web_ok
    "%DOCKER%" compose -f "%COMPOSE%" --env-file "%ENVFILE%" ps --format "{{.Ports}}" 2>nul | findstr /C:"3000" >nul
    if not errorlevel 1 set "WEB_OK=1"
)
echo        [????] ?????????????????????��
:web_ok

echo.
echo ============================================================
echo  ????????
echo    Web:      http://localhost:3000
echo    ???:     http://localhost:3000/problems
echo    ???????: http://localhost:3000/admin/stats
echo    ????????: http://localhost:8082/health
echo ============================================================
echo.
explorer "http://localhost:3000"
endlocal