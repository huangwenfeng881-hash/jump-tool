@echo off
rem Vertrise local server launcher (no dependencies)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-server.ps1" %*
pause
