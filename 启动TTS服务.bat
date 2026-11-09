@echo off
rem ============================================================
rem  Start the local TTS (IndexTTS2.5 / audio.cpp) service.
rem  Portable: all paths resolve relative to this file.
rem  The model must be installed first (QQ Agent -> 下载额外功能).
rem ============================================================
chcp 65001 >nul
setlocal
set "ROOT=%~dp0"
set "TTS=%ROOT%tts"
set "EXE=%TTS%\audio.cpp\audiocpp_server.exe"
set "CFG=%TTS%\server.json"

if not exist "%EXE%" (
  echo [TTS] runtime missing: %EXE%
  echo Run QQ Agent -^> 下载额外功能 -^> 下载语音模型 first.
  pause
  exit /b 1
)
if not exist "%CFG%" (
  echo [TTS] config missing: %CFG%
  pause
  exit /b 1
)

if not exist "%TTS%\temp" mkdir "%TTS%\temp"
set "TMP=%TTS%\temp"
set "TEMP=%TTS%\temp"

echo Starting TTS on http://127.0.0.1:8080 ...
echo Keep this window open. Close it to stop the service.
echo.
cd /d "%TTS%"
"%EXE%" --config "%CFG%"
echo.
echo TTS exited with code %ERRORLEVEL%
pause
