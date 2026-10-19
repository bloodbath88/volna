@echo off
rem Volna - install the desktop app (window without browser)
rem Usage: install-desktop.cmd [-Remove] [-Purge]
chcp 65001 >nul
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-desktop.ps1" %*
