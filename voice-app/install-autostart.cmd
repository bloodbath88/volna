@echo off
rem Volna - enable autostart at Windows boot (for a server / always-on PC)
rem Run as Administrator: right-click this file -> "Run as administrator"
chcp 65001 >nul
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-autostart.ps1"
