@echo off
:: ========================================================
:: QuinloveRin Code - Standalone Telegram Outbox Sender (.BAT)
:: Features:
::   1. Send Prompt Ack: send_message.bat --ack "Preview" [thread_id]
::   2. Send Cancel Msg: send_message.bat --cancel [thread_id]
::   3. Send JSON File:  send_message.bat outbox\msg_123.json
::   4. Send Raw Text:   send_message.bat "Hello Telegram" [thread_id]
:: ========================================================

setlocal enabledelayedexpansion
set "SCRIPT_DIR=%~dp0"

if "%~1"=="" (
    echo [SendWorker BAT] Usage: send_message.bat ^<payload.json ^| --ack ^| --cancel ^| "Text"^>
    exit /b 1
)

:: Chạy worker ngầm độc lập qua Node.js (khắc phục lỗi khoảng trắng đường dẫn)
node "%SCRIPT_DIR%send_worker.cjs" %*

exit /b 0
