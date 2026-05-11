@echo off
set PORT=3006
set ELECTRON_CACHE=%LOCALAPPDATA%\electron\Cache
set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/

REM Use bundled Node.js 22 instead of system Node
set PATH=%~dp0nodejs;%PATH%

echo Starting Claude Harness Desktop...
echo.

echo Checking Node.js...
node --version
echo.

echo Checking dependencies...
echo.
call npm install --foreground-scripts --no-audit --no-fund
if %errorlevel% neq 0 (
    echo.
    echo Install failed. Please check your network and try again.
    pause
    exit /b 1
)
echo.
echo Dependencies ready!
echo.

echo Checking port %PORT%...

netstat -ano | findstr :%PORT% >nul 2>&1
if %errorlevel% equ 0 (
    echo Port %PORT% is in use, freeing it...
    for /f "tokens=5" %%a in ('netstat -ano ^| findstr :%PORT%') do (
        taskkill /PID %%a /F >nul 2>&1
    )
    timeout /t 3 /nobreak >nul
)

echo Launching Claude Harness Desktop...
call npm run dev-electron
if %errorlevel% neq 0 (
    echo.
    echo Claude Harness Desktop exited with an error.
    pause
)
