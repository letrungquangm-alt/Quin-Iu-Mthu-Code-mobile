# ========================================================
# Telegram Remote Coder - Watchdog 24/7 (Fast Bridge)
# Giám sát và tự khởi động lại node fast_bridge.cjs khi crash
# ========================================================

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$rootDir = $PSScriptRoot
$bridgeScript = Join-Path $rootDir "fast_bridge.cjs"

Write-Host "==========================================================" -ForegroundColor Green
Write-Host " Watchdog Fast Bridge Supervisor dang hoat dong..." -ForegroundColor Green
Write-Host " Script: $bridgeScript" -ForegroundColor DarkCyan
Write-Host "==========================================================" -ForegroundColor Green

while ($true) {
    try {
        if (Test-Path $bridgeScript) {
            $proc = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object { $_.CommandLine -like "*fast_bridge.cjs*" }
            if (-not $proc) {
                Write-Host "[Watchdog $(Get-Date -Format 'HH:mm:ss')] Khoi dong node fast_bridge.cjs..." -ForegroundColor Yellow
                Start-Process node.exe -ArgumentList "`"$bridgeScript`"" -WorkingDirectory $rootDir -WindowStyle Hidden
            }
        }
    } catch {
        Write-Host "[Watchdog Error] $_" -ForegroundColor Red
    }

    Start-Sleep -Seconds 3
}
