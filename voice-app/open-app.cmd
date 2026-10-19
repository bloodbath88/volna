@echo off
rem Volna - open the app window (double-click this file)
chcp 65001 >nul
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0open-app.ps1" %*
