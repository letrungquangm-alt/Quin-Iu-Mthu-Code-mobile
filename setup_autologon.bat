@echo off
:: ========================================================
:: QuinloveRin Code - AutoAdminLogon Installer (Run as Admin)
:: ========================================================
chcp 65001 >nul
setlocal

:: Kiem tra quyen Administrator, neu chua co thi tu dong goi UAC RunAs
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo [QuinloveRin Code] Dang yeu cau quyen Administrator de cau hinh Winlogon...
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process cmd.exe -ArgumentList '/c \"\"%~f0\"\"' -Verb RunAs"
    exit /b
)

:: Chay script PowerShell cau hinh
set "SCRIPT_DIR=%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%setup_autologon.ps1"

exit /b 0
