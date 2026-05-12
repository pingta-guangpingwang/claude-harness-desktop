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

if not exist "%NODE_EXE%" (
    echo [1/3] Bundled Node.js not found — downloading v%NODE_VERSION%...
    if not exist "%~dp0nodejs" mkdir "%~dp0nodejs"

    REM Try official source first
    set NODE_URL=https://nodejs.org/dist/v%NODE_VERSION%/node-v%NODE_VERSION%-win-x64.zip
    set NODE_ZIP=%~dp0nodejs\node-temp.zip

    echo Trying official source: nodejs.org ...
    powershell -NoProfile -ExecutionPolicy Bypass -Command ^
      "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; ^
       $ProgressPreference = 'SilentlyContinue'; ^
       try { ^
         Invoke-WebRequest -Uri '%NODE_URL%' -OutFile '%NODE_ZIP%' -TimeoutSec 120; ^
         Write-Output 'OK_OFFICIAL' ^
       } catch { ^
         Write-Output 'FAIL_OFFICIAL' ^
       }" > "%~dp0nodejs\_dl_result.txt" 2>&1

    findstr "FAIL_OFFICIAL" "%~dp0nodejs\_dl_result.txt" >nul 2>&1
    if %errorlevel% equ 0 (
        echo Official source failed — switching to npmmirror...
        set NODE_URL=https://npmmirror.com/dist/node/v%NODE_VERSION%/node-v%NODE_VERSION%-win-x64.zip
        powershell -NoProfile -ExecutionPolicy Bypass -Command ^
          "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; ^
           $ProgressPreference = 'SilentlyContinue'; ^
           Invoke-WebRequest -Uri '!NODE_URL!' -OutFile '%NODE_ZIP%' -TimeoutSec 120"
    )

    REM Extract
    if exist "%NODE_ZIP%" (
        powershell -NoProfile -ExecutionPolicy Bypass -Command ^
          "Expand-Archive -Path '%NODE_ZIP%' -DestinationPath '%~dp0nodejs' -Force; ^
           Get-ChildItem '%~dp0nodejs\node-v%NODE_VERSION%-win-x64' | Move-Item -Destination '%~dp0nodejs' -Force; ^
           Remove-Item '%~dp0nodejs\node-v%NODE_VERSION%-win-x64' -Force -ErrorAction SilentlyContinue; ^
           Remove-Item '%NODE_ZIP%' -Force -ErrorAction SilentlyContinue"
    )

    del "%~dp0nodejs\_dl_result.txt" >nul 2>&1

    if not exist "%NODE_EXE%" (
        echo [FAIL] Could not download Node.js.
        pause
        exit /b 1
    )
    echo [OK] Node.js ready.
)

set PATH=%~dp0nodejs;%PATH%

echo [2/3] Installing dependencies...
call npm install --foreground-scripts --no-audit --no-fund 2>nul
if %errorlevel% neq 0 (
    echo Default registry failed — switching to npmmirror...
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
