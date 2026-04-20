@echo off
setlocal
cd /d "%~dp0"

REM Direct node launch is faster than npm script bootstrapping.
where node.exe >nul 2>&1
if not errorlevel 1 (
	node server-optimized.js
	exit /b %errorlevel%
)

npm start
