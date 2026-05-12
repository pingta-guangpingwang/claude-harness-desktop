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

REM -- Check / Bootstrap bundled Node.js --
set NODE_EXE=%~dp0nodejs\node.exe
set NODE_VERSION=22.19.0
set PS1_FILE=%~dp0nodejs\_dl_node.ps1
set NODE_ZIP=%~dp0nodejs\node-v%NODE_VERSION%-win-x64.zip
set EXTRACT_DIR=%~dp0nodejs\node-v%NODE_VERSION%-win-x64

if not exist "%NODE_EXE%" (
    echo [1/4] Bundled Node.js not found - downloading v%NODE_VERSION%...
    echo.
    if not exist "%~dp0nodejs" mkdir "%~dp0nodejs"

    REM Write download script to temp ps1 (use ! for delayed expansion inside block)
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
echo.

REM Try default npm registry first, fall back to npmmirror
call npm install --foreground-scripts --no-audit --no-fund 2>nul
if !errorlevel! neq 0 (
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
