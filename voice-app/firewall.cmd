@echo off
rem Volna - open firewall ports.
rem Run as Administrator: right-click this file -> "Run as administrator".
chcp 65001 >nul
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0firewall.ps1"
