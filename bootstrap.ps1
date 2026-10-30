# ========================================================
# QUINLOVERIN DIRECT CMD CONNECTOR - PROTOCOL gm_xxx-yyy_mthu
# ========================================================
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

Write-Host ""
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host " 🚀 QUINLOVERIN DIRECT CMD CONNECTOR (GIAO THỨC MÁY PHỤ)   " -ForegroundColor Yellow
Write-Host " Kết nối máy net / máy mới thẳng với Cloudflare & Telegram " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host ""

$workerUrl = "https://quin-iu-mthu-code-mobile.letrungquangm.workers.dev"

# 1. Khởi tạo mã CMD ngẫu nhiên 3 số
$cmdCode = (Get-Random -Minimum 100 -Maximum 999).ToString()
Write-Host "⚡ [BƯỚC 1] Mã ngẫu nhiên CMD: " -NoNewline
Write-Host "[$cmdCode]" -ForegroundColor Green

# 2. Hỏi ổ đĩa làm việc
$drives = Get-PSDrive -PSProvider FileSystem | Where-Object { $_.Free -gt 1GB } | Select-Object -ExpandProperty Name
$defaultDrive = if ($drives -contains 'D') { 'D' } else { 'C' }
$chosenDrive = Read-Host "📁 Chọn ổ đĩa làm việc trên máy này (Mặc định: $defaultDrive)"
if (-not $chosenDrive) { $chosenDrive = $defaultDrive }
$workDir = "$($chosenDrive):\QuinloveRin_Workspace"
if (-not (Test-Path $workDir)) { New-Item -ItemType Directory -Path $workDir -Force | Out-Null }
Set-Location $workDir
Write-Host "   -> Thư mục làm việc: $workDir" -ForegroundColor Gray

# 3. Đăng ký lệnh 'quinloverin' toàn cục vào máy
$binDir = "$env:USERPROFILE\.quinloverin"
if (-not (Test-Path $binDir)) { New-Item -ItemType Directory -Path $binDir -Force | Out-Null }
$cmdWrapper = "@echo off`r`npowershell -ExecutionPolicy Bypass -Command `"irm $workerUrl/net | iex`""
Set-Content -Path "$binDir\quinloverin.cmd" -Value $cmdWrapper -Encoding ASCII
$currentPath = [System.Environment]::GetEnvironmentVariable("Path", "User")
if ($currentPath -notlike "*$binDir*") {
    [System.Environment]::SetEnvironmentVariable("Path", "$currentPath;$binDir", "User")
    $env:Path += ";$binDir"
    Write-Host "✨ Đã đăng ký lệnh toàn cục 'quinloverin' vào hệ thống!" -ForegroundColor Green
}

# 4. Gửi Handshake bắt tay với Cloudflare
Write-Host "📡 [BƯỚC 2] Đang bắt tay xác thực với Cloudflare Worker 24/7..." -ForegroundColor Yellow
$handshakeBody = @{
    cmd_code = $cmdCode
    hostname = $env:COMPUTERNAME
    drive = "$($chosenDrive):"
    os = (Get-CimInstance Win32_OperatingSystem).Caption
} | ConvertTo-Json

try {
    $resp = Invoke-RestMethod -Uri "$workerUrl/net/handshake" -Method POST -Body $handshakeBody -ContentType "application/json" -TimeoutSec 15
    $sessionId = $resp.session_id
    $teleCode = $resp.tele_code

    Write-Host ""
    Write-Host "==========================================================" -ForegroundColor Green
    Write-Host " ✅ KẾT NỐI MÁY PHỤ THÀNH CÔNG RỰC RỠ!" -ForegroundColor Green
    Write-Host " 🔑 MÃ ĐỊNH DANH PHIÊN: " -NoNewline
    Write-Host "$sessionId" -ForegroundColor Yellow
    Write-Host " 📱 Đã gửi mã '$sessionId' về Telegram Topic #1160" -ForegroundColor Cyan
    Write-Host " ⌨️ Giờ bro có thể điều khiển máy này từ Telegram qua:" -ForegroundColor Gray
    Write-Host "    /cmd <lệnh_bất_kỳ>" -ForegroundColor Yellow
    Write-Host "==========================================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "⚡ Đang lắng nghe lệnh trực tiếp từ Telegram... (Bấm Ctrl+C để thoát)" -ForegroundColor Gray

    # 5. Vòng lặp nhận lệnh Remote Terminal
    while ($true) {
        Start-Sleep -Milliseconds 1500
        try {
            $poll = Invoke-RestMethod -Uri "$workerUrl/cmd/poll?session=$sessionId" -Method GET -TimeoutSec 10
            if ($poll.has_command) {
                $cmdToRun = $poll.command
                $cmdId = $poll.cmd_id
                Write-Host "[Telegram Exec]: $cmdToRun" -ForegroundColor Cyan

                $cmdOutput = ""
                $exitCode = 0
                try {
                    $cmdOutput = Invoke-Expression $cmdToRun 2>&1 | Out-String
                } catch {
                    $cmdOutput = $_.Exception.Message
                    $exitCode = 1
                }

                if (-not $cmdOutput) { $cmdOutput = "[Lệnh đã thực thi xong (Không có đầu ra văn bản)]" }

                $resultBody = @{
                    cmd_id = $cmdId
                    session = $sessionId
                    command = $cmdToRun
                    output = $cmdOutput
                    exit_code = $exitCode
                } | ConvertTo-Json

                Invoke-RestMethod -Uri "$workerUrl/cmd/result" -Method POST -Body $resultBody -ContentType "application/json" -TimeoutSec 10 | Out-Null
            }
        } catch {}
    }
} catch {
    Write-Host "❌ Lỗi kết nối Cloudflare: $($_.Exception.Message)" -ForegroundColor Red
}
