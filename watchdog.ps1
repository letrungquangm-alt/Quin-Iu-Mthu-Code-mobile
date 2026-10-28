# ========================================================
# Telegram Remote Coder - Watchdog & Crash Auto-Recovery
# Giám sát 24/7 cho bot.ps1 và mirror_worker.ps1
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
Write-Host " Watchdog Crash Protection & Dual-Process Supervisor da khoi dong..." -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Green

$crashCount = 0

while ($true) {
    # 1. Giám sát Mirror Worker (Đồng bộ Working & Lệnh lên Telegram)
    if (Test-Path $mirrorScript) {
        try {
            $mProc = Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" | Where-Object { $_.CommandLine -like "*mirror_worker.ps1*" }
            if (-not $mProc) {
                Write-Host "[Watchdog $(Get-Date -Format 'HH:mm:ss')] Khoi dong Mirror Worker..." -ForegroundColor DarkCyan
                Start-Process powershell.exe -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$mirrorScript`"" -WindowStyle Hidden
            }
        } catch {}
    }

    # 2. Khởi chạy và bảo vệ Bot chính (bot.ps1)
    $startTime = Get-Date
    Write-Host "[Watchdog $(Get-Date -Format 'HH:mm:ss')] Khoi chay bot.ps1..." -ForegroundColor Cyan

    $proc = Start-Process -FilePath "powershell.exe" -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$botScript`"" -NoNewWindow -PassThru -Wait
    $exitCode = $proc.ExitCode
    $duration = (Get-Date) - $startTime

    Write-Host "[Watchdog $(Get-Date -Format 'HH:mm:ss')] Bot dung lai. ExitCode: $exitCode (Thoi gian chay: $($duration.TotalSeconds)s)" -ForegroundColor Yellow

    # Neu bot chay it hon 10 giay va bi thoat voi ma loi -> Crash!
    if ($duration.TotalSeconds -lt 10 -and $exitCode -ne 0) {
        $crashCount++
        Write-Host "[CRASH] Phat hien bot gap loi nghiem trong (lan $crashCount)!" -ForegroundColor Red

        # Tim ban backup gan nhat
        $latestBackup = Get-ChildItem -Path $backupDir -Filter "*.ps1" | Sort-Object LastWriteTime -Descending | Select-Object -First 1

        if ($latestBackup) {
            Write-Host "[RECOVERY] Dang tu dong phuc hoi tu: $($latestBackup.Name)" -ForegroundColor Yellow
            Copy-Item -Path $latestBackup.FullName -Destination $botScript -Force
            
            Send-Alert -text "🚨 Cảnh báo: Phát hiện mã nguồn bot bị lỗi lúc khởi động! Watchdog đã tự động hoàn tác về bản backup ổn định [$($latestBackup.Name)]."
        } else {
            Send-Alert -text "❌ Bot bị crash nhưng không tìm thấy file backup để khôi phục!"
        }

        Start-Sleep -Seconds 3
    } else {
        $crashCount = 0
        Start-Sleep -Seconds 1
    }
}

