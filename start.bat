@echo off
title Telegram Remote Coder with Crash Guard
chcp 65001 > nul
cd /d "%~dp0"
echo ========================================================
echo     Khoi dong Telegram Remote Coder (Watchdog Mode)...
echo ========================================================
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0watchdog.ps1"
pause
