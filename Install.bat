@echo off
setlocal
set "SCRIPT=%~dp0system\start.ps1"
if not exist "%SCRIPT%" set "SCRIPT=%~dp0start.ps1"
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%" -Action Install
set "RESULT=%ERRORLEVEL%"
if not "%RESULT%"=="0" pause
exit /b %RESULT%
