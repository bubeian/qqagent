@echo off
rem Create (or overwrite) the two scheduled tasks used by QQ Agent.
rem Both point at hidden VBS launchers so no console window appears:
rem   QQAgent-NapCat   -> scripts\start-napcat.vbs (hidden start-napcat.bat)
rem   QQAgent-StopAll  -> scripts\stop-all.vbs    (hidden stop-all.bat)
rem Called from QQ Agent on first launch (one UAC). Afterwards no admin needed.
chcp 65001 >nul
setlocal

schtasks /create /tn "QQAgent-NapCat" /tr "%~dp0start-napcat.vbs" /sc once /st 00:00 /rl HIGHEST /it /f
set "RC1=%ERRORLEVEL%"
schtasks /create /tn "QQAgent-StopAll" /tr "%~dp0stop-all.vbs" /sc once /st 00:00 /rl HIGHEST /it /f
set "RC2=%ERRORLEVEL%"

echo [tasks] NapCat=%RC1% StopAll=%RC2%
if not "%RC1%"=="0" exit /b %RC1%
if not "%RC2%"=="0" exit /b %RC2%
exit /b 0
