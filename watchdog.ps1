# ========================================================
# Telegram Remote Coder - Watchdog & Crash Auto-Recovery
# Giám sát 24/7 song song cho bot.ps1 và mirror_worker.ps1
# ========================================================

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$rootDir = $PSScriptRoot
$botScript = Join-Path $rootDir "bot.ps1"
$mirrorScript = Join-Path $rootDir "mirror_worker.ps1"
$backupDir = Join-Path $rootDir "backups"
$configPath = Join-Path $rootDir "config.json"

if (-not (Test-Path $backupDir)) {
    New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
}

function Send-Alert {
    param([string]$text)
    if (Test-Path $configPath) {
        try {
            $cfg = Get-Content $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
            if ($cfg.BOT_TOKEN -and $cfg.ALLOWED_CHAT_ID) {
                $url = "https://api.telegram.org/bot$($cfg.BOT_TOKEN)/sendMessage"
                $body = @{ chat_id = $cfg.ALLOWED_CHAT_ID; text = $text } | ConvertTo-Json -Compress
                Invoke-RestMethod -Uri $url -Method Post -ContentType "application/json; charset=utf-8" -Body ([System.Text.Encoding]::UTF8.GetBytes($body)) -TimeoutSec 10 | Out-Null
            }
        } catch {}
    }
}

Write-Host "==========================================================" -ForegroundColor Green
Write-Host " Watchdog Dual-Process Supervisor 24/7 dang hoat dong..." -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Green

while ($true) {
    try {
        # 1. Giám sát Mirror Worker (Đồng bộ Working & Lệnh lên Telegram)
        if (Test-Path $mirrorScript) {
            $mProc = Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" | Where-Object { $_.CommandLine -like "*mirror_worker.ps1*" }
            if (-not $mProc) {
                Write-Host "[Watchdog $(Get-Date -Format 'HH:mm:ss')] Khoi dong Mirror Worker..." -ForegroundColor DarkCyan
                Start-Process powershell.exe -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$mirrorScript`"" -WindowStyle Hidden
            }
        }

        # 2. Giám sát Bot chính (bot.ps1)
        if (Test-Path $botScript) {
            $bProc = Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" | Where-Object { $_.CommandLine -like "*bot.ps1*" }
            if (-not $bProc) {
                Write-Host "[Watchdog $(Get-Date -Format 'HH:mm:ss')] Khoi dong bot.ps1..." -ForegroundColor Cyan
                Start-Process powershell.exe -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$botScript`"" -WindowStyle Hidden
            }
        }
    } catch {}

    Start-Sleep -Seconds 3
}