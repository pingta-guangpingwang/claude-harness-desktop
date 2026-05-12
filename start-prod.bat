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

REM -- Check / Bootstrap bundled Node.js --
set NODE_EXE=%~dp0nodejs\node.exe
set NODE_VERSION=22.19.0
set PS1_FILE=%~dp0nodejs\_dl_node.ps1
set NODE_ZIP=%~dp0nodejs\node-v%NODE_VERSION%-win-x64.zip
set EXTRACT_DIR=%~dp0nodejs\node-v%NODE_VERSION%-win-x64

if not exist "%NODE_EXE%" (
    echo [1/3] Bundled Node.js not found - downloading v%NODE_VERSION%...
    if not exist "%~dp0nodejs" mkdir "%~dp0nodejs"

    (
        echo $nodeDir = '%~dp0nodejs'
        echo $nodeZip = '%NODE_ZIP%'
        echo $extractedDir = '%EXTRACT_DIR%'
        echo $urlOfficial = "https://nodejs.org/dist/v%NODE_VERSION%/node-v%NODE_VERSION%-win-x64.zip"
        echo $urlMirror = "https://npmmirror.com/dist/node/v%NODE_VERSION%/node-v%NODE_VERSION%-win-x64.zip"
        echo [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        echo $ProgressPreference = 'SilentlyContinue'
        echo Write-Host "Trying official source: nodejs.org ..."
        echo try {
        echo     Invoke-WebRequest -Uri $urlOfficial -OutFile $nodeZip -TimeoutSec 120
        echo     Write-Host "Official source OK."
        echo } catch {
        echo     Write-Host "Official source failed - switching to npmmirror..."
        echo     try {
        echo         Invoke-WebRequest -Uri $urlMirror -OutFile $nodeZip -TimeoutSec 120
        echo     } catch {
        echo         Write-Host "Mirror also failed."
        echo         exit 1
        echo     }
        echo }
        echo if (Test-Path $nodeZip) {
        echo     Write-Host "Extracting..."
        echo     Expand-Archive -Path $nodeZip -DestinationPath $nodeDir -Force
        echo     if (Test-Path $extractedDir) {
        echo         Move-Item (Join-Path $extractedDir '*') -Destination $nodeDir -Force
        echo         Remove-Item $extractedDir -Force
        echo     }
        echo     Remove-Item $nodeZip -Force
        echo }
    ) > "!PS1_FILE!"

    powershell -NoProfile -ExecutionPolicy Bypass -File "!PS1_FILE!"
    del "!PS1_FILE!" >nul 2>&1

    if not exist "!NODE_EXE!" (
        echo [FAIL] Could not download Node.js.
        pause
        exit /b 1
    )
    echo [OK] Node.js ready.
)

set PATH=%~dp0nodejs;%PATH%

echo [2/3] Installing dependencies...
call npm install --foreground-scripts --no-audit --no-fund 2>nul
if !errorlevel! neq 0 (
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
