@echo off
setlocal enabledelayedexpansion

title Set Docker Registry Mirrors (Template)

echo ==========================================
echo   Docker Mirror Config Helper (Windows)
echo ==========================================
echo.
echo This script will generate a daemon.json template for Docker.
echo You still need to paste it into Docker Desktop ^> Settings ^> Docker Engine.
echo.

set OUT_FILE=%USERPROFILE%\Desktop\docker-daemon-mirror-template.json

(
  echo {
  echo   "registry-mirrors": [
  echo     "https://docker.1ms.run",
  echo     "https://hub-mirror.c.163.com"
  echo   ]
  echo }
) > "%OUT_FILE%"

echo [OK] Template created: %OUT_FILE%
echo.
echo Next steps:
echo 1. Open Docker Desktop
echo 2. Settings ^> Docker Engine
echo 3. Replace JSON with the template content
echo 4. Apply ^& Restart

echo.
choice /M "Open template file now"
if errorlevel 2 goto :END
start "" "%OUT_FILE%"

:END
echo [DONE]
pause
exit /b 0
