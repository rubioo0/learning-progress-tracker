@echo off
setlocal

REM Get the directory where this script is located
cd /d "%~dp0"

set "APP_URL=http://localhost:3000/?appMode=1"
set "HEALTH_URL=http://localhost:3000/api/learning-sessions/health"
set "READY=0"

REM Reuse an already healthy backend to avoid unnecessary cold starts.
call :CHECK_HEALTH
if not errorlevel 1 (
	set "READY=1"
	goto :OPEN_APP
)

REM Stop stale QA Road instances so this launch always uses the current workspace code.
powershell -NoProfile -ExecutionPolicy Bypass -Command "^$targets = Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" ^| Where-Object { ^$_.CommandLine -match 'server-optimized\\.js' }; foreach (^$p in ^$targets) { try { Stop-Process -Id ^$p.ProcessId -Force -ErrorAction Stop } catch {} }" >nul 2>&1

REM If something is still listening on port 3000, terminate it to avoid routing to stale backend.
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":3000 .*LISTENING"') do (
	taskkill /PID %%P /F >nul 2>&1
)

REM Start the QA Road application without showing the command prompt window
REM Create a temporary VBScript to run the command hidden
if exist "%temp%\launch-qa.vbs" del "%temp%\launch-qa.vbs"
echo Set objShell = CreateObject("WScript.Shell") > "%temp%\launch-qa.vbs"
echo objShell.Run "cmd /c Start-QA-Road.cmd", 0, False >> "%temp%\launch-qa.vbs"
cscript.exe //nologo "%temp%\launch-qa.vbs"
if exist "%temp%\launch-qa.vbs" del "%temp%\launch-qa.vbs"

REM Wait until backend readiness endpoint is reachable.
for /l %%I in (1,1,12) do (
	call :CHECK_HEALTH
	if not errorlevel 1 (
		set "READY=1"
		goto :OPEN_APP
	)
	timeout /t 1 /nobreak >nul
)

:OPEN_APP

REM Launch in app/fullscreen mode so it feels like a native app.
where msedge.exe >nul 2>&1
if not errorlevel 1 (
	start "" msedge.exe --new-window --start-fullscreen --app="%APP_URL%"
	goto :WARN_IF_NOT_READY
)

where chrome.exe >nul 2>&1
if not errorlevel 1 (
	start "" chrome.exe --new-window --start-fullscreen --app="%APP_URL%"
	goto :WARN_IF_NOT_READY
)

REM Fallback to default browser if Edge/Chrome are unavailable.
start "" "%APP_URL%"

:WARN_IF_NOT_READY

if "%READY%"=="0" (
	echo Warning: backend may still be starting. The app window opened and will load as soon as server startup completes.
)

REM Exit this batch file, leaving the server running
exit /b 0

:CHECK_HEALTH
where curl.exe >nul 2>&1
if not errorlevel 1 (
	curl.exe --silent --fail --max-time 1 "%HEALTH_URL%" >nul 2>&1
	if not errorlevel 1 exit /b 0
	exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -Command "try { ^$r = Invoke-WebRequest -UseBasicParsing -Uri '%HEALTH_URL%' -TimeoutSec 1; if (^$r.StatusCode -eq 200) { exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>&1
if not errorlevel 1 exit /b 0
exit /b 1
