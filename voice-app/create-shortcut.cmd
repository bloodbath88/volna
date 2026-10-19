@echo off
rem Volna - create Desktop shortcuts
rem Usage: create-shortcut.cmd [-InviteUrl "<link>"] [-Remove]
chcp 65001 >nul
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0create-shortcut.ps1" %*
