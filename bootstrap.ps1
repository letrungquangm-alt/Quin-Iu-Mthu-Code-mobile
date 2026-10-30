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
Write-Host "🔢 Mã ngẫu nhiên từ CMD: " -NoNewline
Write-Host "[$cmdCode]" -ForegroundColor Green

# 2. Đăng ký lệnh 'quinloverin' toàn cục vào máy
$binDir = "$env:USERPROFILE\.quinloverin"
if (-not (Test-Path $binDir)) { New-Item -ItemType Directory -Path $binDir -Force | Out-Null }
$cmdWrapper = "@echo off`r`npowershell -ExecutionPolicy Bypass -Command `"irm $workerUrl/net | iex`""
Set-Content -Path "$binDir\quinloverin.cmd" -Value $cmdWrapper -Encoding ASCII
$currentPath = [System.Environment]::GetEnvironmentVariable("Path", "User")
if ($currentPath -notlike "*$binDir*") {
    [System.Environment]::SetEnvironmentVariable("Path", "$currentPath;$binDir", "User")
    $env:Path += ";$binDir"
    Write-Host "✨ Đã ghim lệnh 'quinloverin' vào CMD hệ thống!" -ForegroundColor Gray
}

# 3. Gửi Handshake bắt tay với Cloudflare
Write-Host "📡 Đang gửi tín hiệu kết nối lên Telegram qua Cloud..." -ForegroundColor Yellow
$handshakeBody = @{
    cmd_code = $cmdCode
    hostname = $env:COMPUTERNAME
    drive = (Get-Location).Drive.Name + ":"
} | ConvertTo-Json

try {
    $resp = Invoke-RestMethod -Uri "$workerUrl/net/handshake" -Method POST -Body $handshakeBody -ContentType "application/json" -TimeoutSec 15
    $sessionId = $resp.session_id
    $teleCode = $resp.tele_code

    Write-Host ""
    Write-Host "==========================================================" -ForegroundColor Green
    Write-Host " ✅ ĐÃ BẮT TAY KẾT NỐI VỚI TELEGRAM THÀNH CÔNG!" -ForegroundColor Green
    Write-Host " 📱 Mã Telegram trả về: " -NoNewline
    Write-Host "[$teleCode]" -ForegroundColor Cyan
    Write-Host " 🔑 MÃ GHÉP ĐÔI HOÀN CHỈNH: " -NoNewline
    Write-Host "$sessionId" -ForegroundColor Yellow
    Write-Host "==========================================================" -ForegroundColor Green
    Write-Host "✨ Điện thoại đã nhận được thông báo xác thực phiên $sessionId!" -ForegroundColor Gray
    Write-Host ""
} catch {
    Write-Host "❌ Lỗi kết nối Cloudflare: $($_.Exception.Message)" -ForegroundColor Red
}
