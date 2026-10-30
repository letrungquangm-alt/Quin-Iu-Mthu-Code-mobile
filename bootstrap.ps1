# ========================================================
# 🚀 QUINLOVERIN REMOTE CODER - 1-CLICK ONBOARDING BOOTSTRAP
# Tự động kiểm tra Git, Node, Antigravity và hỏi ổ đĩa cài đặt
# ========================================================

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

Write-Host ""
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host " 🚀 QUINLOVERIN CODE - 1-CLICK REMOTE ONBOARDING BOOTSTRAP " -ForegroundColor Yellow
Write-Host " Kết nối máy mới / Quán net tới Telegram & Hugging Face   " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host ""

# --- BƯỚC 1: KIỂM TRA & CÀI ĐẶT GIT ---
Write-Host "🔍 [Bước 1/4] Đang kiểm tra Git trên máy tính..." -ForegroundColor Green
$hasGit = Get-Command git -ErrorAction SilentlyContinue
if ($hasGit) {
    $gitVer = (git --version)
    Write-Host "   ✅ Đã tìm thấy Git: $gitVer" -ForegroundColor Green
} else {
    Write-Host "   ⚠️ Máy này CHƯA CÀI GIT!" -ForegroundColor Red
    $installGit = Read-Host "   👉 Bro có muốn tự động cài Git cho máy này không? (Y/n) [Mặc định Y]"
    if ($installGit -ne 'n' -and $installGit -ne 'N') {
        Write-Host "   ⏳ Đang cài đặt Git qua winget..." -ForegroundColor Yellow
        try {
            winget install --id Git.Git -e --source winget --accept-source-agreements --accept-package-agreements
            $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
            Write-Host "   ✅ Cài đặt Git thành công!" -ForegroundColor Green
        } catch {
            Write-Host "   ⚠️ Không thể chạy winget tự động. Bro có thể tải Git thủ công tại https://git-scm.com" -ForegroundColor Yellow
        }
    }
}

Write-Host ""

# --- BƯỚC 2: KIỂM TRA NODE.JS ---
Write-Host "🔍 [Bước 2/4] Đang kiểm tra Node.js runtime..." -ForegroundColor Green
$hasNode = Get-Command node -ErrorAction SilentlyContinue
if ($hasNode) {
    $nodeVer = (node --version)
    Write-Host "   ✅ Đã tìm thấy Node.js: $nodeVer" -ForegroundColor Green
} else {
    Write-Host "   ⚠️ Máy này CHƯA CÓ Node.js!" -ForegroundColor Red
    $installNode = Read-Host "   👉 Bro có muốn tự động cài Node.js không? (Y/n) [Mặc định Y]"
    if ($installNode -ne 'n' -and $installNode -ne 'N') {
        Write-Host "   ⏳ Đang cài đặt Node.js qua winget..." -ForegroundColor Yellow
        try {
            winget install --id OpenJS.NodeJS.LTS -e --source winget --accept-source-agreements --accept-package-agreements
            $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
            Write-Host "   ✅ Cài đặt Node.js thành công!" -ForegroundColor Green
        } catch {
            Write-Host "   ⚠️ Bro có thể tải Node.js tại https://nodejs.org" -ForegroundColor Yellow
        }
    }
}

Write-Host ""

# --- BƯỚC 3: KIỂM TRA TRÌNH DUYỆT (CHROME, EDGE, BRAVE, FIREFOX) ---
Write-Host "🌐 [Bước 3/5] Đang kiểm tra các trình duyệt web trên máy..." -ForegroundColor Green
$chromePaths = @("$env:ProgramFiles\Google\Chrome\Application\chrome.exe", "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe", "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe", "D:\Browsers\Chrome\chrome.exe")
$hasChrome = $false
foreach ($cp in $chromePaths) { if (Test-Path $cp) { $hasChrome = $true; break } }

$edgePaths = @("${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe")
$hasEdge = $false
foreach ($ep in $edgePaths) { if (Test-Path $ep) { $hasEdge = $true; break } }

if ($hasChrome) {
    Write-Host "   ✅ Đã tìm thấy Google Chrome" -ForegroundColor Green
} elseif ($hasEdge) {
    Write-Host "   ✅ Đã tìm thấy Microsoft Edge" -ForegroundColor Green
} else {
    Write-Host "   ⚠️ Máy này CHƯA CÀI Chrome hoặc Edge!" -ForegroundColor Yellow
}

if (-not $hasChrome) {
    $installChrome = Read-Host "   👉 Máy chưa có Google Chrome. Bro có muốn tự động cài Chrome không? (Y/n) [Mặc định Y]"
    if ($installChrome -ne 'n' -and $installChrome -ne 'N') {
        $brTargetDrive = Read-Host "   👉 Chọn ổ đĩa cài đặt Chrome ([D] để chống đóng băng ở quán net | [C] Mặc định) [Mặc định D]"
        $locParam = if ($brTargetDrive -eq 'C' -or $brTargetDrive -eq 'c') { "" } else { '--location "D:\Browsers\Chrome"' }
        Write-Host "   ⏳ Đang cài đặt Google Chrome qua winget..." -ForegroundColor Yellow
        try {
            Invoke-Expression "winget install --id Google.Chrome -e $locParam --accept-source-agreements --accept-package-agreements --silent"
            Write-Host "   ✅ Cài đặt Google Chrome thành công!" -ForegroundColor Green
        } catch {
            Write-Host "   ⚠️ Không thể cài Chrome tự động qua winget." -ForegroundColor Yellow
        }
    }
}

Write-Host ""

# --- BƯỚC 4: KIỂM TRA ANTIGRAVITY ---
Write-Host "🔍 [Bước 4/5] Đang kiểm tra Antigravity IDE..." -ForegroundColor Green
$antigravityPath = "$env:LOCALAPPDATA\Programs\antigravity\Antigravity.exe"
if (Test-Path $antigravityPath) {
    Write-Host "   ✅ Đã tìm thấy Antigravity IDE tại: $antigravityPath" -ForegroundColor Green
} else {
    Write-Host "   ℹ️ Máy tính này CHƯA CÀI Antigravity IDE." -ForegroundColor Yellow
    Write-Host "      (Hệ thống vẫn hỗ trợ Remote CMD Controller & Cloud 24/7 độc lập mà không bắt buộc có Antigravity)" -ForegroundColor DarkCyan
    $antChoice = Read-Host "   👉 Bro có muốn: [1] Cài Antigravity IDE | [2] Dùng Remote CMD Controller nhẹ (Khuyên dùng cho net) [Mặc định 2]"
    if ($antChoice -eq '1') {
        Write-Host "   🌐 Đang mở trang tải Antigravity..." -ForegroundColor Yellow
        Start-Process "https://antigravity.google"
    }
}

Write-Host ""

# --- BƯỚC 4: HỎI USER Ổ ĐĨA & THƯ MỤC CÀI ĐẶT ---
Write-Host "📂 [Bước 5/5] Chọn ổ đĩa & thư mục cài đặt dự án..." -ForegroundColor Green
Write-Host "   Các ổ đĩa khả dụng trên máy này:" -ForegroundColor Cyan
$volumes = Get-Volume | Where-Object { $_.DriveLetter -and $_.DriveType -eq 'Fixed' }
$defaultDrive = "D:"
$foundD = $false
foreach ($vol in $volumes) {
    $freeGb = [math]::Round($vol.SizeRemaining / 1GB, 1)
    $isSys = if ($vol.DriveLetter -eq 'C') { " [Ổ hệ thống C: - Dễ bị đóng băng ở quán net]" } else { " [Khuyên dùng]" }
    Write-Host "   • Ổ $($vol.DriveLetter): (Còn trống: $freeGb GB)$isSys" -ForegroundColor White
    if ($vol.DriveLetter -eq 'D') { $foundD = $true }
}

if (-not $foundD) {
    $defaultDrive = "C:"
}

$defaultTarget = "$defaultDrive\MThu_Remote_Code"
Write-Host ""
Write-Host "   Bro có thể chỉ định bất kỳ ổ đĩa và thư mục nào theo ý muốn." -ForegroundColor Yellow
$userTarget = Read-Host "   👉 Nhập đường dẫn cài đặt (Bấm Enter để chọn mặc định: '$defaultTarget')"
if ([string]::IsNullOrWhiteSpace($userTarget)) {
    $userTarget = $defaultTarget
}

if (-not (Test-Path $userTarget)) {
    New-Item -ItemType Directory -Path $userTarget -Force | Out-Null
    Write-Host "   ✅ Đã tạo thư mục thành công: $userTarget" -ForegroundColor Green
} else {
    Write-Host "   ✅ Đã liên kết thư mục hiện có: $userTarget" -ForegroundColor Green
}

Write-Host ""
Write-Host "📥 Đang tải bộ mã nguồn Remote Bridge vào: $userTarget..." -ForegroundColor Green

# Sao chép hoặc tải các file bridge cần thiết vào thư mục mục tiêu
$repoUrl = "https://github.com/letrungquangm-alt/Quin-Iu-Mthu-Code-mobile.git"
try {
    if (Get-Command git -ErrorAction SilentlyContinue) {
        if (-not (Test-Path (Join-Path $userTarget ".git"))) {
            git clone $repoUrl $userTarget
        } else {
            git -C $userTarget pull
        }
    }
} catch {}

# Tạo file chạy start_net.bat tại thư mục vừa tạo
$startBatContent = @"
@echo off
title QuinloveRin Remote CMD Bridge
cd /d "$userTarget"
node fast_bridge.cjs
pause
"@
Set-Content -Path (Join-Path $userTarget "start_net.bat") -Value $startBatContent -Encoding UTF8

Write-Host ""
Write-Host "==========================================================" -ForegroundColor Green
Write-Host " 🎉 THIẾT LẬP HOÀN TẤT! REMOTE CMD CONTROLLER ĐÃ SẴN SÀNG  " -ForegroundColor Yellow
Write-Host " 📂 Thư mục làm việc: $userTarget" -ForegroundColor Cyan
Write-Host " 🚀 File khởi động: $(Join-Path $userTarget 'start_net.bat')" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Green
Write-Host ""

# Hỏi có muốn bật bridge ngay không
$startNow = Read-Host "👉 Bro có muốn khởi động Remote Bridge kết nối Telegram ngay bây giờ? (Y/n) [Mặc định Y]"
if ($startNow -ne 'n' -and $startNow -ne 'N') {
    Set-Location $userTarget
    if (Test-Path (Join-Path $userTarget "fast_bridge.cjs")) {
        node (Join-Path $userTarget "fast_bridge.cjs")
    }
}
