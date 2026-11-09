@echo off
rem Stop every background service started by QQ Agent.
rem Invoked by the "QQAgent-StopAll" scheduled task (highest privileges),
rem so this script itself does NOT elevate.
chcp 65001 >nul
setlocal
taskkill /f /im audiocpp_server.exe >nul 2>&1
taskkill /f /im NapCatWinBootMain.exe >nul 2>&1
taskkill /f /im NapCatWinBootHook.exe >nul 2>&1
taskkill /f /im QQ.exe >nul 2>&1
exit /b 0
