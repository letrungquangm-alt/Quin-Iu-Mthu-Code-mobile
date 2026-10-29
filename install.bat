@echo off
setlocal enabledelayedexpansion
title QuinloveRin Code - Auto Setup 1-Click
chcp 65001 >nul

echo ========================================================
echo    🚀 QUINLOVERIN CODE - THIET LAP TU DONG 1-CLICK
echo ========================================================
echo.

:: 1. Kiem tra Git
where git >nul 2>&1
if %errorlevel% neq 0 (
    echo [*] Dang cai dat Git qua winget...
    winget install --id Git.Git -e --source winget --silent --accept-source-agreements --accept-package-agreements
)

:: 2. Kiem tra Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [*] Dang cai dat Node.js qua winget...
    winget install --id OpenJS.NodeJS -e --source winget --silent --accept-source-agreements --accept-package-agreements
)

:: 3. Chay install.ps1 de thiet lap toan bo moi truong va cau noi Telegram
echo [*] Dang dong bo ma nguon va kich hoat Cau Noi Telegram...
powershell -NoProfile -ExecutionPolicy Bypass -Command "& { if (Test-Path '%~dp0install.ps1') { & '%~dp0install.ps1' } else { irm https://raw.githubusercontent.com/letrungquangm-alt/Quin-Iu-Mthu-Code-mobile/main/install.ps1 | iex } }"

echo.
echo ========================================================
echo   ✅ HOAN TAT! HE THONG DA SAN SANG DONG BO TELEGRAM!
echo ========================================================
echo.
echo Ban co the dong cua so nay hoac de chay ngam.
timeout /t 5 >nul
