@echo off
title QuinloveRin Remote Coder - Onboarding Net
chcp 65001 > nul
echo ========================================================
echo     Dang khoi dong 1-Click Bootstrap cho quan Net...
echo ========================================================
powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://raw.githubusercontent.com/letrungquangm-alt/Quin-Iu-Mthu-Code-mobile/main/bootstrap.ps1 | iex"
pause
