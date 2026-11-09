@echo off
rem ============================================================
rem  QQ Agent portable launcher
rem  - All paths are relative to this file (%~dp0), safe to move
rem    the whole folder to another drive / computer.
rem  - QQ Agent starts NapCat automatically on first run
rem    (creates a scheduled task once; asks for admin one time).
rem ============================================================
chcp 65001 >nul
setlocal
set "ROOT=%~dp0"
set "APP=%ROOT%qqagent-0.4"
set "ELECTRON=%APP%\node_modules\electron\dist\electron.exe"

if not exist "%APP%\package.json" (
  echo [QQ Agent] qqagent-0.4 folder not found next to this launcher.
  pause
  exit /b 1
)

if not exist "%ELECTRON%" (
  echo [QQ Agent] electron is missing:
  echo   %ELECTRON%
  echo.
  echo First-time setup: open a terminal in "%APP%" and run:
  echo   npm install
  pause
  exit /b 1
)

cd /d "%APP%"
start "" "%ELECTRON%" "%APP%"
exit /b 0
