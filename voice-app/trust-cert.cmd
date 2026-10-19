@echo off
rem Volna - trust this installation certificate (optional step)
rem Usage: trust-cert.cmd [-Remove]
chcp 65001 >nul
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0trust-cert.ps1" %*
