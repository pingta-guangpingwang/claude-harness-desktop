@echo off
setlocal enabledelayedexpansion
set PORT=3006
set ELECTRON_CACHE=%LOCALAPPDATA%\electron\Cache
set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/

cd /d "%~dp0"

echo.
echo ==============================================
echo   Claude Harness Desktop — 深蓝驾驭工程
echo ==============================================
echo.

REM ── Check / Bootstrap bundled Node.js ──
set NODE_EXE=%~dp0nodejs\node.exe
set NODE_VERSION=22.19.0
set NODE_URL=https://npmmirror.com/dist/node/v%NODE_VERSION%/node-v%NODE_VERSION%-win-x64.zip
set NODE_ZIP=%~dp0nodejs\node-temp.zip

if not exist "%NODE_EXE%" (
    echo [1/4] Bundled Node.js not found — downloading v%NODE_VERSION%...
    echo.
    if not exist "%~dp0nodejs" mkdir "%~dp0nodejs"

    powershell -NoProfile -ExecutionPolicy Bypass -Command ^
      "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; ^
       $ProgressPreference = 'SilentlyContinue'; ^
       Invoke-WebRequest -Uri '%NODE_URL%' -OutFile '%NODE_ZIP%'; ^
       Expand-Archive -Path '%NODE_ZIP%' -DestinationPath '%~dp0nodejs' -Force; ^
       Remove-Item '%NODE_ZIP%'; ^
       Get-ChildItem '%~dp0nodejs\node-v%NODE_VERSION%-win-x64' | Move-Item -Destination '%~dp0nodejs' -Force; ^
       Remove-Item '%~dp0nodejs\node-v%NODE_VERSION%-win-x64' -Force -ErrorAction SilentlyContinue"

    if not exist "%NODE_EXE%" (
        echo.
        echo [FAIL] Could not download Node.js. Check your network and try again.
        echo You can also install Node.js manually: https://nodejs.org
        pause
        exit /b 1
    )
    echo [OK] Node.js v%NODE_VERSION% ready.
    echo.
) else (
    echo [1/4] Bundled Node.js v%NODE_VERSION% found.
    echo.
)

REM Use bundled Node.js
set PATH=%~dp0nodejs;%PATH%

echo [2/4] Node.js version:
node --version
echo.

echo [3/4] Checking dependencies...
call npm install --foreground-scripts --no-audit --no-fund
if %errorlevel% neq 0 (
    echo.
    echo [FAIL] Install failed. Please check your network and try again.
    pause
    exit /b 1
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
