@echo off
setlocal enabledelayedexpansion
set PORT=3006
set ELECTRON_CACHE=%LOCALAPPDATA%\electron\Cache
set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/

cd /d "%~dp0"

echo.
echo ==============================================
echo   Claude Harness Desktop - DeepBlueGodHarnessFarm
echo ==============================================
echo.

REM -- Bootstrap Node.js if not present --
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0bootstrap.ps1"
if %errorlevel% neq 0 (
    pause
    exit /b 1
)
echo.

REM Use bundled Node.js
set PATH=%~dp0nodejs;%PATH%

echo [2/4] Node.js version:
node --version
echo.

echo [3/4] Checking dependencies...
echo.
call npm install --foreground-scripts --no-audit --no-fund 2>nul
if %errorlevel% neq 0 (
    echo.
    echo Default registry failed - switching to npmmirror...
    call npm install --foreground-scripts --no-audit --no-fund --registry=https://registry.npmmirror.com
    if !errorlevel! neq 0 (
        echo.
        echo [FAIL] Install failed. Please check your network and try again.
        pause
        exit /b 1
    )
)
echo [OK] Dependencies ready.
echo.

echo [4/4] Checking port %PORT%...
netstat -ano | findstr :%PORT% >nul 2>&1
if %errorlevel% equ 0 (
    echo Port %PORT% is in use, freeing it...
    for /f "tokens=5" %%a in ('netstat -ano ^| findstr :%PORT%') do (
        taskkill /PID %%a /F >nul 2>&1
    )
    timeout /t 3 /nobreak >nul
)

echo.
echo Launching Claude Harness Desktop...
echo.
call npm run dev-electron
if %errorlevel% neq 0 (
    echo.
    echo Claude Harness Desktop exited with an error.
    pause
)
