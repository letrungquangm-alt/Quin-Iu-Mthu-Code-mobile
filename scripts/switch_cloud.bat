@echo off
:: ========================================================
:: QuinloveRin Code - Fast Webhook Cloud Switcher
:: ========================================================

set "BOT_TOKEN=9295576468:AAEWszGzGSvgYDeNBFh4zZBhuxkOzixfz4o"
set "WEBHOOK_URL=https://quiniumthucode.vercel.app/api/webhook"

if "%~1"=="pc" (
    echo [Cloud Switcher] Ban giao cho PC...
    curl -s "https://api.telegram.org/bot%BOT_TOKEN%/deleteWebhook" >nul
) else (
    echo [Cloud Switcher] Ban giao cho Vercel Cloud 24/7...
    curl -s "https://api.telegram.org/bot%BOT_TOKEN%/setWebhook?url=%WEBHOOK_URL%" >nul
)

exit /b 0
