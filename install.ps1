# ========================================================
# QuinloveRin Code - Trình Cài Đặt Tự Động 1-Click Cho Máy Tính Mới
# ========================================================

param(
    [string]$BotToken = "",
    [string]$GeminiKey = "",
    [string]$GhToken = "",
    [string]$VercelToken = "",
    [string]$VercelTeam = "team_ItjW6FczErxCHeZsipuwaeI7",
    [int64]$AllowedChatId = 2029333412
)

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$targetDir = "C:\Users\Administrator\.gemini\antigravity\scratch\telegram-remote-coder"
$modelDir = "C:\Users\Administrator\.gemini\antigravity\scratch\model\Quin-Iu-Mthu"
$repoUrl = "https://github.com/letrungquangm-alt/Quin-Iu-Mthu-Code-mobile.git"

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host " ĐANG TỰ ĐỘNG CÀI ĐẶT QUINLOVERIN CODE TRÊN MÁY TÍNH NÀY..." -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Cyan

# 1. Tạo thư mục làm việc
if (-not (Test-Path $targetDir)) { New-Item -ItemType Directory -Path $targetDir -Force | Out-Null }
if (-not (Test-Path $modelDir)) { New-Item -ItemType Directory -Path $modelDir -Force | Out-Null }

# 2. Tải mã nguồn mới nhất từ GitHub
$gitExe = "git"
if (Test-Path "C:\Users\Administrator\.gemini\antigravity\bin\git\cmd\git.exe") {
    $gitExe = "C:\Users\Administrator\.gemini\antigravity\bin\git\cmd\git.exe"
}

Set-Location $targetDir
if (Test-Path (Join-Path $targetDir ".git")) {
    Write-Host "[1/5] Cập nhật mã nguồn mới nhất từ GitHub..." -ForegroundColor Yellow
    & $gitExe pull origin main 2>&1 | Out-Null
} else {
    Write-Host "[1/5] Tải mã nguồn từ GitHub..." -ForegroundColor Yellow
    & $gitExe clone $repoUrl . 2>&1 | Out-Null
}

# 3. Tạo file cấu hình bảo mật config.json nếu được cung cấp
$configPath = Join-Path $targetDir "config.json"
if (-not (Test-Path $configPath) -and $BotToken) {
    Write-Host "[2/5] Cấu hình Token bảo mật (Telegram, Gemini, GitHub, Vercel)..." -ForegroundColor Yellow
    $cfg = @{
        BOT_TOKEN = $BotToken
        ALLOWED_CHAT_ID = $AllowedChatId
        GEMINI_API_KEY = $GeminiKey
        GITHUB_TOKEN = $GhToken
        VERCEL_TOKEN = $VercelToken
        VERCEL_TEAM_ID = $VercelTeam
        PRO_EXPIRATION_DATE = ""
        SELECTED_MODEL = "Gemini 3.8 Flash (High)"
        MODEL_ID = "gemini-3.8-flash"
        THINKING_LEVEL = "high"
        EXECUTION_MODE = "auto"
        MAX_TOKENS = 1000000000
        USED_TOKENS = 160774
        PROJECTS_ROOT_DIR = "C:\Users\Administrator\.gemini\antigravity\scratch\model"
        CURRENT_PROJECT = "Quin-Iu-Mthu"
        CURRENT_PROJECT_PATH = $modelDir
    }
    $cfg | ConvertTo-Json -Depth 5 | Set-Content $configPath -Encoding UTF8
}

# 4. Thiết lập trạng thái kết nối đồng bộ sẵn sàng (CONNECTED)
Write-Host "[3/5] Khởi tạo cầu nối đồng bộ thời gian thực (Sync Bridge)..." -ForegroundColor Yellow
$syncPath = Join-Path $targetDir "sync_bridge.json"
$syncData = @{
    messages = @()
    active = $true
    syncCode = "GM_6585_Mthu"
    conversationId = ""
    status = "CONNECTED"
    isWorking = $false
    connectedAt = (Get-Date -Format "yyyy-MM-dd HH:mm:ss")
}
$syncData | ConvertTo-Json -Depth 5 | Set-Content $syncPath -Encoding UTF8

# 5. Dừng các tiến trình cũ nếu có và chạy Watchdog + Mirror Worker
Write-Host "[4/5] Khởi động Bot và Live Mirror Worker..." -ForegroundColor Yellow
Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" | Where-Object { $_.CommandLine -like "*bot.ps1*" -or $_.CommandLine -like "*watchdog.ps1*" -or $_.CommandLine -like "*mirror_worker.ps1*" } | ForEach-Object {
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
}
Start-Sleep -Seconds 1

Start-Process powershell.exe -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$targetDir\watchdog.ps1`"" -WindowStyle Hidden
Start-Process powershell.exe -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$targetDir\mirror_worker.ps1`"" -WindowStyle Hidden

# 6. Gửi tin nhắn thông báo về Telegram cho người dùng
Write-Host "[5/5] Gửi thông báo xác nhận về Telegram..." -ForegroundColor Yellow
if (Test-Path $configPath) {
    try {
        $loadedCfg = Get-Content $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
        $tokenToUse = $loadedCfg.BOT_TOKEN
        $chatToUse = $loadedCfg.ALLOWED_CHAT_ID

        $msg = @(
            "🎉 [MÁY TÍNH MỚI ĐÃ SẴN SÀNG!]",
            "",
            "✅ Tool QuinloveRin Code đã được cài đặt và thiết lập thành công trên máy tính này!",
            "🔗 Cầu nối đồng bộ: ĐÃ KẾT NỐI (GM_6585_Mthu)",
            "🌐 Vercel Live Web: https://quiniumthucode.vercel.app",
            "🐙 GitHub Repo: https://github.com/letrungquangm-alt/Quin-Iu-Mthu-Code-mobile",
            "",
            "Từ bây giờ mọi lệnh và code bạn gửi từ điện thoại sẽ được thực thi trực tiếp trên máy tính này!"
        ) -join "`n"

        $sendUrl = "https://api.telegram.org/bot${tokenToUse}/sendMessage"
        $body = @{ chat_id = $chatToUse; text = $msg } | ConvertTo-Json -Compress
        Invoke-RestMethod -Uri $sendUrl -Method Post -ContentType "application/json; charset=utf-8" -Body ([System.Text.Encoding]::UTF8.GetBytes($body)) -TimeoutSec 10 | Out-Null
    } catch {}
}

Write-Host "==========================================================" -ForegroundColor Green
Write-Host " CÀI ĐẶT HOÀN TẤT 100%! HỆ THỐNG ĐANG HOẠT ĐỘNG!" -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Green
