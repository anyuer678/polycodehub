@echo off
setlocal enabledelayedexpansion

title PolyCodeHub Environment Diagnose
cd /d "%~dp0.."

set LOG_DIR=scripts\logs
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"

for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd_HHmmss"') do set TS=%%i
set LOG_FILE=%LOG_DIR%\diagnose-%TS%.log

call :LOG "=========================================="
call :LOG "  PolyCodeHub Environment Diagnose"
call :LOG "=========================================="
call :LOG "[INFO] Log file: %LOG_FILE%"
call :LOG ""

call :CHECK_CMD docker "Docker CLI"
call :CHECK_CMD wsl "WSL"
call :CHECK_DOCKER_DAEMON
call :CHECK_WSL_STATUS
call :CHECK_PORT 3000 "Web"
call :CHECK_PORT 8080 "Gateway"
call :CHECK_PORT 8081 "Auth"
call :CHECK_PORT 8082 "Judge"
call :CHECK_PORT 15672 "RabbitMQ UI"
call :CHECK_COMPOSE

call :LOG ""
call :LOG "[DONE] Diagnose completed."
call :LOG "Please see: %LOG_FILE%"
pause
exit /b 0

:LOG
echo %~1
echo %~1>>"%LOG_FILE%"
exit /b 0

:CHECK_CMD
set CMD_NAME=%~1
set CMD_DESC=%~2
where %CMD_NAME% >nul 2>nul
if errorlevel 1 (
  call :LOG "[FAIL] %CMD_DESC% not found in PATH."
  if /i "%CMD_NAME%"=="docker" (
    call :LOG "       Install Docker Desktop: https://www.docker.com/products/docker-desktop/"
  )
  if /i "%CMD_NAME%"=="wsl" (
    call :LOG "       Enable WSL: run 'wsl --install' in Admin PowerShell."
  )
) else (
  call :LOG "[OK] %CMD_DESC% command found."
)
exit /b 0

:CHECK_DOCKER_DAEMON
for /f "delims=" %%i in ('docker info 2^>nul ^| findstr /i "Server Version"') do set DOCKER_OK=1
if defined DOCKER_OK (
  call :LOG "[OK] Docker daemon is running."
) else (
  call :LOG "[FAIL] Docker daemon is not running."
  call :LOG "       Start Docker Desktop and wait until 'Engine running'."
)
set DOCKER_OK=
exit /b 0

:CHECK_WSL_STATUS
for /f "delims=" %%i in ('wsl -l -v 2^>nul ^| findstr /r /c:" 2 "') do set WSL2_OK=1
if defined WSL2_OK (
  call :LOG "[OK] At least one WSL2 distro detected."
) else (
  call :LOG "[WARN] WSL2 distro not detected (or wsl command failed)."
  call :LOG "       Install/upgrade WSL2: wsl --install"
)
set WSL2_OK=
exit /b 0

:CHECK_PORT
set P=%~1
set NAME=%~2
for /f "delims=" %%i in ('netstat -ano ^| findstr /r /c:":%P% .*LISTENING"') do set PORT_USED=1
if defined PORT_USED (
  call :LOG "[WARN] Port %P% (%NAME%) is in use."
  call :LOG "       If startup fails, stop conflicting process or change env port."
) else (
  call :LOG "[OK] Port %P% (%NAME%) appears available."
)
set PORT_USED=
exit /b 0

:CHECK_COMPOSE
docker compose version >nul 2>nul
if errorlevel 1 (
  call :LOG "[FAIL] 'docker compose' is not available."
  call :LOG "       Update Docker Desktop to latest version."
) else (
  call :LOG "[OK] docker compose command available."
)
exit /b 0
