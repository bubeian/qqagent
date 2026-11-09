@echo off
rem ============================================================
rem  QQ Agent WEB MODE (debug only)
rem  Runs the headless server and opens the console in a browser.
rem  The normal way to use the app is 启动QQAgent.bat (desktop client).
rem ============================================================
chcp 65001 >nul
setlocal
set "ROOT=%~dp0"
set "APP=%ROOT%qqagent-0.4"
set "NODE=%APP%\node_modules\electron\dist\electron.exe"

if not exist "%APP%\src\server.js" (
  echo [QQ Agent] qqagent-0.4 folder not found next to this launcher.
  pause
  exit /b 1
)

cd /d "%APP%"

rem Prefer a real node.exe if present; otherwise fall back to Electron's node mode.
where node >nul 2>&1
if not errorlevel 1 (
  start "QQ Agent Server" cmd /c node src\server.js
) else (
  set "ELECTRON_RUN_AS_NODE=1"
  start "QQ Agent Server" "%NODE%" src\server.js
)

echo Server starting. The console URL is printed in the server window.
echo Opening http://127.0.0.1:3210 in your browser...
timeout /t 6 /nobreak >nul
start "" http://127.0.0.1:3210
exit /b 0
