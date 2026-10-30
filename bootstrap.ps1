# ========================================================
# QUINLOVERIN NET ONBOARDING - PROTOCOL gm_xxx-yyy_mthu
# ========================================================
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

Write-Host ""
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host " 🚀 QUINLOVERIN NET ONBOARDING (GM-TELE)                  " -ForegroundColor Yellow
Write-Host " Kết nối máy net / máy mới thẳng với Cloudflare & Telegram " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host ""

$workerUrl = "https://quin-iu-mthu-code-mobile.letrungquangm.workers.dev"

# 1. Khởi tạo mã CMD ngẫu nhiên 3 số
$cmdCode = (Get-Random -Minimum 100 -Maximum 999).ToString()

# 2. Đăng ký lệnh 'quinloverin' toàn cục vào máy
$binDir = "$env:USERPROFILE\.quinloverin"
if (-not (Test-Path $binDir)) { New-Item -ItemType Directory -Path $binDir -Force | Out-Null }
$cmdWrapper = "@echo off`r`npowershell -ExecutionPolicy Bypass -Command `"irm $workerUrl/net | iex`""
Set-Content -Path "$binDir\quinloverin.cmd" -Value $cmdWrapper -Encoding ASCII
$currentPath = [System.Environment]::GetEnvironmentVariable("Path", "User")
if ($currentPath -notlike "*$binDir*") {
    [System.Environment]::SetEnvironmentVariable("Path", "$currentPath;$binDir", "User")
    $env:Path += ";$binDir"
    Write-Host "✨ Đã ghim lệnh 'quinloverin' vào hệ thống!" -ForegroundColor Gray
}

# 3. Gửi thông tin về Cloudflare để sẵn sàng cho Lobby
$regBody = @{
    cmd_code = $cmdCode
    hostname = $env:COMPUTERNAME
    drive = (Get-Location).Drive.Name + ":"
} | ConvertTo-Json

try {
    $resp = Invoke-RestMethod -Uri "$workerUrl/net/register" -Method POST -Body $regBody -ContentType "application/json" -TimeoutSec 15
    Write-Host "==========================================================" -ForegroundColor Yellow
    Write-Host " 📡 ĐÃ GỬI THÔNG TIN VỀ GM-TELE" -ForegroundColor Green
    Write-Host " 👉 Bro hãy vào Sảnh (Lobby) bấm nút [Connect Net]" -ForegroundColor Cyan
    Write-Host "    và nhập mã này: " -NoNewline
    Write-Host "[$cmdCode]" -ForegroundColor Green
    Write-Host "==========================================================" -ForegroundColor Yellow
    Write-Host ""

    # Chờ user nhập mã 3 số từ tin nhắn riêng của Bot gửi về
    $inputTele = Read-Host "🔑 Nhập mã 3 chữ số từ Telegram gửi riêng về để kết nối"
    $inputTele = $inputTele.Trim()

    # Gửi xác thực
    $verifyBody = @{
        cmd_code = $cmdCode
        tele_code = $inputTele
    } | ConvertTo-Json

    $vResp = Invoke-RestMethod -Uri "$workerUrl/net/verify" -Method POST -Body $verifyBody -ContentType "application/json" -TimeoutSec 15
    if ($vResp.ok) {
        $sessionId = $vResp.session_id
        Write-Host ""
        Write-Host "==========================================================" -ForegroundColor Green
        Write-Host " ✅ XÁC THỰC THÀNH CÔNG RỰC RỠ!" -ForegroundColor Green
        Write-Host " 🔑 MÃ LIÊN KẾT PHIÊN: " -NoNewline
        Write-Host "$sessionId" -ForegroundColor Yellow
        Write-Host " 🌐 Đã liên kết với Topic dự án trên Telegram qua Cloud 24/7!" -ForegroundColor Cyan
        Write-Host "==========================================================" -ForegroundColor Green
        Write-Host ""
    } else {
        Write-Host "❌ Mã xác thực không chính xác!" -ForegroundColor Red
    }
} catch {
    Write-Host "❌ Lỗi kết nối Cloud: $($_.Exception.Message)" -ForegroundColor Red
}
