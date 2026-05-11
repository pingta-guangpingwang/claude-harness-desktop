@echo off
set ELECTRON_CACHE=%LOCALAPPDATA%\electron\Cache
set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/

REM Use bundled Node.js 22 instead of system Node
set PATH=%~dp0nodejs;%PATH%

echo Building and starting Claude Harness Desktop production version...
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

call npm run start
if %errorlevel% neq 0 (
    echo.
    echo Claude Harness Desktop exited with an error.
    pause
)
