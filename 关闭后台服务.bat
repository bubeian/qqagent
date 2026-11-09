@echo off
rem ============================================================
rem  Shut down all background services started by QQ Agent:
rem    - TTS      (audiocpp_server.exe)
rem    - QQ Agent (electron.exe / node.exe)
rem    - NapCat   (runs inside QQ.exe, needs admin)
rem  Self-elevates once (UAC) because NapCat lives in an
rem  elevated QQ process.
rem ============================================================
chcp 65001 >nul
net session >nul 2>&1
if errorlevel 1 (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

setlocal
echo Stopping background services...
taskkill /f /im audiocpp_server.exe >nul 2>&1
taskkill /f /im NapCatWinBootMain.exe >nul 2>&1
taskkill /f /im NapCatWinBootHook.exe >nul 2>&1
taskkill /f /im QQ.exe >nul 2>&1

rem QQ Agent desktop app (Electron) and headless server
taskkill /f /im electron.exe >nul 2>&1
rem node.exe: only kill our own server to avoid touching unrelated node apps
powershell -NoProfile -WindowStyle Hidden -Command "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -like '*qqagent-0.4*src\\server.js*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"

echo.
echo Done. Remaining:
tasklist /fi "imagename eq QQ.exe" 2>nul | findstr /i "QQ.exe" >nul && (echo   QQ: still running ^(may need a manual close^)) || (echo   QQ: stopped)
tasklist /fi "imagename eq electron.exe" 2>nul | findstr /i "electron.exe" >nul && (echo   QQ Agent: still running) || (echo   QQ Agent: stopped)
tasklist /fi "imagename eq audiocpp_server.exe" 2>nul | findstr /i "audiocpp" >nul && (echo   TTS: still running) || (echo   TTS: stopped)
echo.
timeout /t 3
