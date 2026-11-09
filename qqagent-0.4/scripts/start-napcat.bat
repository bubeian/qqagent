@echo off
rem ============================================================
rem  Launch NapCat without modifying any NapCat file.
rem
rem  Why this exists: NapCat's "Limited Redistribution License"
rem  forbids publicly releasing MODIFIED NapCat code, so we keep
rem  napcat-shell\ untouched and reproduce the launcher logic here
rem  (the original launcher.bat does exactly the same: set NAPCAT_*
rem  env vars, resolve the QQ path, then run NapCatWinBootMain.exe).
rem
rem  QQ selection: bundled copy (..\qq-nt\QQ.exe, isolated so the
rem  user's own QQ can run at the same time) takes priority; else
rem  fall back to the QQ install recorded in the registry.
rem ============================================================
chcp 65001 >nul
setlocal EnableExtensions

rem --- self-elevate (NapCat must inject into QQ, which needs admin) ---
net session >nul 2>&1
if errorlevel 1 (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

rem --- locate napcat-shell (portable: relative to this script) ---
set "NAPCAT_DIR="
for %%d in ("%~dp0..\..\napcat-shell" "%~dp0..\napcat-shell" "%~dp0..\..\napcat") do (
  if not defined NAPCAT_DIR if exist "%%~d\loadNapCat.js" set "NAPCAT_DIR=%%~d"
)
if not defined NAPCAT_DIR (
  echo [napcat] cannot find napcat-shell\loadNapCat.js next to the app
  exit /b 1
)

cd /d "%NAPCAT_DIR%" || exit /b 1

rem --- same variables the official launcher sets ---
set "NAPCAT_PATCH_PACKAGE=%cd%\qqnt.json"
set "NAPCAT_LOAD_PATH=%cd%\loadNapCat.js"
set "NAPCAT_INJECT_PATH=%cd%\NapCatWinBootHook.dll"
set "NAPCAT_LAUNCHER_PATH=%cd%\NapCatWinBootMain.exe"
set "NAPCAT_MAIN_PATH=%cd%\napcat.mjs"

rem --- choose QQ executable ---
set "QQPath="
if exist "%~dp0..\..\qq-nt\QQ.exe" (
  set "QQPath=%~dp0..\..\qq-nt\QQ.exe"
  goto :napcat_launch
)

set "RetString="
for /f "tokens=2*" %%a in ('reg query "HKLM\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\QQ" /v "UninstallString" 2^>nul') do set "RetString=%%~b"
if defined RetString for %%a in ("%RetString%") do set "QQPath=%%~dpaQQ.exe"

if not defined QQPath (
  echo [napcat] QQ installation not found.
  echo          Put a QQ copy in qq-nt\ or install QQ normally.
  exit /b 1
)

:napcat_launch
rem --- stop only the bundled QQ instance, never the user's own ---
echo %QQPath% | find /i "qq-nt" >nul
if not errorlevel 1 (
  powershell -NoProfile -WindowStyle Hidden -Command "Get-Process QQ -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '*qq-nt*' } | Stop-Process -Force -ErrorAction SilentlyContinue"
  timeout /t 2 /nobreak >nul
)

"%NAPCAT_LAUNCHER_PATH%" "%QQPath%" "%NAPCAT_INJECT_PATH%"
exit /b %ERRORLEVEL%
