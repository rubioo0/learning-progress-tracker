@echo off
cls
echo ================================================================
echo           Learning Progress Tracker - Startup Script
echo ================================================================
echo.

REM Check if Node.js is installed
echo [1/4] Checking Node.js installation...
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ ERROR: Node.js is not installed or not in PATH.
    echo.
    echo Please install Node.js from: https://nodejs.org/
    echo 1. Download the LTS version
    echo 2. Run the installer
    echo 3. Restart your computer
    echo 4. Run this script again
    echo.
    pause
    exit /b 1
)
echo ✅ Node.js is installed

REM Check if npm is available
echo [2/4] Checking npm availability...
npm --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ ERROR: npm is not available. Please check your Node.js installation.
    echo.
    pause
    exit /b 1
)
echo ✅ npm is available

REM Install dependencies if node_modules doesn't exist
echo [3/4] Checking dependencies...
if not exist "node_modules" (
    echo Installing dependencies...
    call npm install
    if %errorlevel% neq 0 (
        echo ❌ ERROR: Failed to install dependencies.
        echo Please check your internet connection and try again.
        pause
        exit /b 1
    )
    echo ✅ Dependencies installed
) else (
    echo ✅ Dependencies already installed
)

REM Start the application
echo [4/4] Starting the Learning Progress Tracker server...
echo.
echo 🚀 Server starting...
echo 🌐 Open your browser to: http://localhost:3000
echo 📝 Features ready:
echo    - Excel import for your 16-sheet format
echo    - Progress tracking with gamification
echo    - Module-based curriculum organization
echo.
echo ⚠️  Press Ctrl+C to stop the server
echo ================================================================
echo.
call npm start
