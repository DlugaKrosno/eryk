@echo off
REM Quick Deploy Script for DrEryk Alert Management (Windows)
REM Usage: QUICK_DEPLOY.bat [production|development]

setlocal enabledelayedexpansion

set ENVIRONMENT=%1
if "%ENVIRONMENT%"=="" set ENVIRONMENT=production

echo.
echo ==========================================
echo   DrEryk Alert Management - Quick Deploy
echo ==========================================
echo Environment: %ENVIRONMENT%
echo.

REM Check if Node.js is installed
where node >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Node.js is not installed. Please install Node.js 18+ first.
    exit /b 1
)

REM Check if Forge CLI is installed
where forge >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [INFO] Forge CLI is not installed. Installing...
    call npm install -g @forge/cli
)

REM Build all components
echo [INFO] Building all components...
call npm run build

if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Build failed. Please check the errors above.
    exit /b 1
)

echo [SUCCESS] Build completed successfully
echo.

REM Deploy to Forge
echo [INFO] Deploying to Forge (%ENVIRONMENT%)...
if "%ENVIRONMENT%"=="production" (
    call forge deploy --environment production
) else (
    call forge deploy
)

if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Deployment failed. Please check the errors above.
    exit /b 1
)

echo [SUCCESS] Deployment completed successfully
echo.
echo [INFO] Next steps:
echo   1. Run 'forge install --upgrade' to install/update in your Jira instance
echo   2. Test the application in your Jira instance
echo   3. Check logs with 'forge logs' if needed
echo.
echo [SUCCESS] Done!
pause
