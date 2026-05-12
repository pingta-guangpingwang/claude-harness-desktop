@echo off
setlocal enabledelayedexpansion
set ELECTRON_CACHE=%LOCALAPPDATA%\electron\Cache
set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/

cd /d "%~dp0"

echo.
echo ==============================================
echo   Claude Harness Desktop - Production Build
echo ==============================================
echo.

REM -- Bootstrap Node.js if not present --
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0bootstrap.ps1"
if %errorlevel% neq 0 (
    pause
    exit /b 1
)
echo.

set PATH=%~dp0nodejs;%PATH%

echo [2/3] Installing dependencies...
call npm install --foreground-scripts --no-audit --no-fund 2>nul
if %errorlevel% neq 0 (
    echo Default registry failed - switching to npmmirror...
    call npm install --foreground-scripts --no-audit --no-fund --registry=https://registry.npmmirror.com
    if !errorlevel! neq 0 (
        echo [FAIL] Install failed.
        pause
        exit /b 1
    )
)

echo [3/3] Building and starting...
call npm run start
if %errorlevel% neq 0 (
    echo Claude Harness Desktop exited with an error.
    pause
)
