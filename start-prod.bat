@echo off
setlocal enabledelayedexpansion
set ELECTRON_CACHE=%LOCALAPPDATA%\electron\Cache
set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/

cd /d "%~dp0"

echo.
echo ==============================================
echo   Claude Harness Desktop — Production Build
echo ==============================================
echo.

REM ── Check / Bootstrap bundled Node.js ──
set NODE_EXE=%~dp0nodejs\node.exe
set NODE_VERSION=22.19.0
set NODE_URL=https://npmmirror.com/dist/node/v%NODE_VERSION%/node-v%NODE_VERSION%-win-x64.zip
set NODE_ZIP=%~dp0nodejs\node-temp.zip

if not exist "%NODE_EXE%" (
    echo [1/3] Bundled Node.js not found — downloading v%NODE_VERSION%...
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
        echo [FAIL] Could not download Node.js.
        pause
        exit /b 1
    )
    echo [OK] Node.js ready.
)

set PATH=%~dp0nodejs;%PATH%

echo [2/3] Installing dependencies...
call npm install --foreground-scripts --no-audit --no-fund
if %errorlevel% neq 0 (
    echo [FAIL] Install failed.
    pause
    exit /b 1
)

echo [3/3] Building and starting...
call npm run start
if %errorlevel% neq 0 (
    echo Claude Harness Desktop exited with an error.
    pause
)
