@echo off
:: ========================================================
:: QuinloveRin Code - Standalone Telegram Outbox Sender (.BAT)
:: Syntax: send_message.bat <payload.json | "Message Text">
:: Example: send_message.bat "Hello from PC terminal"
:: ========================================================

setlocal enabledelayedexpansion
set "SCRIPT_DIR=%~dp0"
set "TARGET=%~1"

if "%TARGET%"=="" (
    echo [SendWorker BAT] Usage: send_message.bat ^<payload.json ^| "Text"^>
    exit /b 1
)

:: Chạy worker ngầm độc lập qua Node.js
node "%SCRIPT_DIR%send_worker.cjs" "%TARGET%"

exit /b 0
