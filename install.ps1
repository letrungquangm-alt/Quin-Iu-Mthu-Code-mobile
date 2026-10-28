# ========================================================
# QuinloveRin Code - Trinh Cai Dat Tu Dong 1-Click Cho May Tinh Moi
# ========================================================

param(
    [string]$BotToken = "",
    [string]$GeminiKey = "",
    [string]$GhToken = "",
    [string]$VercelToken = "",
    [string]$VercelTeam = "team_ItjW6FczErxCHeZsipuwaeI7",
    [int64]$AllowedChatId = 2029333412,
    [string]$ConversationId = "7f7131ce-dc72-490f-97bd-4a675f9dd0c7"
)

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$userProfile = $env:USERPROFILE
$targetDir = if ($PSScriptRoot) { $PSScriptRoot } else { "$userProfile\.gemini\antigravity\scratch\telegram-remote-coder" }
$projectsRootDir = Join-Path (Split-Path $targetDir -Parent) "model"
if (-not (Test-Path $projectsRootDir)) {
    $projectsRootDir = "$userProfile\.gemini\antigravity\scratch\model"
}
$modelDir = Join-Path $projectsRootDir "Quin-Iu-Mthu"
$repoUrl = "https://github.com/letrungquangm-alt/Quin-Iu-Mthu-Code-mobile.git"

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host " DANG TU DONG CAI DAT QUINLOVERIN CODE TREN MAY TINH NAY..." -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Cyan

# 1. Tao thu muc lam viec
if (-not (Test-Path $targetDir)) { New-Item -ItemType Directory -Path $targetDir -Force | Out-Null }
if (-not (Test-Path $modelDir)) { New-Item -ItemType Directory -Path $modelDir -Force | Out-Null }

# 2. Cap nhat ma nguon tu GitHub
$gitExe = "git"
if (Test-Path "$userProfile\.gemini\antigravity\bin\git\cmd\git.exe") {
    $gitExe = "$userProfile\.gemini\antigravity\bin\git\cmd\git.exe"
}

Set-Location $targetDir
if (Test-Path (Join-Path $targetDir ".git")) {
    Write-Host "[1/5] Cap nhat ma nguon moi nhat tu GitHub..." -ForegroundColor Yellow
    & $gitExe pull origin main 2>&1 | Out-Null
} else {
    Write-Host "[1/5] Tai ma nguon tu GitHub..." -ForegroundColor Yellow
    & $gitExe clone $repoUrl . 2>&1 | Out-Null
}

# 3. Tao file cau hinh bao mat config.json neu duoc cung cap
$configPath = Join-Path $targetDir "config.json"
if (-not (Test-Path $configPath) -and $BotToken) {
    Write-Host "[2/5] Cau hinh Token bao mat (Telegram, Gemini, GitHub, Vercel)..." -ForegroundColor Yellow
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
        PROJECTS_ROOT_DIR = $projectsRootDir
        CURRENT_PROJECT = "Quin-Iu-Mthu"
        CURRENT_PROJECT_PATH = $modelDir
    }
    $cfg | ConvertTo-Json -Depth 5 | Set-Content $configPath -Encoding UTF8
}

# 4. Thiet lap trang thai ket noi dong bo san sang (CONNECTED)
Write-Host "[3/5] Khoi tao cau noi dong bo thoi gian thuc (Sync Bridge)..." -ForegroundColor Yellow
$syncPath = Join-Path $targetDir "sync_bridge.json"
$syncData = @{
    messages = @()
    active = $true
    syncCode = "GM_6585_Mthu"
    conversationId = $ConversationId
    status = "CONNECTED"
    isWorking = $false
    connectedAt = (Get-Date -Format "yyyy-MM-dd HH:mm:ss")
}
$syncData | ConvertTo-Json -Depth 5 | Set-Content $syncPath -Encoding UTF8

# 5. Dung cac tien trinh cu neu co va chay Watchdog + Mirror Worker
Write-Host "[4/5] Khoi dong Bot va Live Mirror Worker..." -ForegroundColor Yellow
Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" | Where-Object { $_.CommandLine -like "*bot.ps1*" -or $_.CommandLine -like "*watchdog.ps1*" -or $_.CommandLine -like "*mirror_worker.ps1*" } | ForEach-Object {
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
}
Start-Sleep -Seconds 1

Start-Process powershell.exe -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$targetDir\watchdog.ps1`"" -WindowStyle Hidden
Start-Process powershell.exe -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$targetDir\mirror_worker.ps1`"" -WindowStyle Hidden

# 6. Gui tin nhan thong bao ve Telegram cho nguoi dung
Write-Host "[5/5] Gui thong bao xac nhan ve Telegram..." -ForegroundColor Yellow
if (Test-Path $configPath) {
    try {
        $loadedCfg = Get-Content $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
        $tokenToUse = $loadedCfg.BOT_TOKEN
        $chatToUse = $loadedCfg.ALLOWED_CHAT_ID

        $msg = @(
            "[MAY TINH MOI DA SAN SANG!]",
            "",
            "Tool QuinloveRin Code da duoc cai dat va thiet lap thanh cong tren may tinh nay!",
            "Cau noi dong bo: DA KET NOI (GM_6585_Mthu)",
            "Vercel Live Web: https://quiniumthucode.vercel.app",
            "GitHub Repo: https://github.com/letrungquangm-alt/Quin-Iu-Mthu-Code-mobile",
            "",
            "Tu bay gio moi lenh va code ban gui tu dien thoai se duoc thuc thi truc tiep tren may tinh nay!"
        ) -join "`n"

        $sendUrl = "https://api.telegram.org/bot${tokenToUse}/sendMessage"
        $body = @{ chat_id = $chatToUse; text = $msg } | ConvertTo-Json -Compress
        Invoke-RestMethod -Uri $sendUrl -Method Post -ContentType "application/json; charset=utf-8" -Body ([System.Text.Encoding]::UTF8.GetBytes($body)) -TimeoutSec 10 | Out-Null
    } catch {}
}

Write-Host "==========================================================" -ForegroundColor Green
Write-Host " CAI DAT HOAN TAT 100%! HE THONG DANG HOAT DONG!" -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Green