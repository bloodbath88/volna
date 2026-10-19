@echo off
rem Volna - launch (double-click this file)
rem Volna - zapusk: LiveKit + web server + app window
chcp 65001 >nul
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1"
