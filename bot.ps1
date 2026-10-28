# ========================================================
# Telegram Remote Coder v8.4 - Prompt Queue & Priority Engine
# Hàng đợi Prompt đa nhiệm, Ưu tiên Send Now & Chỉnh sửa
# ========================================================

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$rootDir = $PSScriptRoot
$configPath = Join-Path $rootDir "config.json"
$backupDir = Join-Path $rootDir "backups"
$botScript = Join-Path $rootDir "bot.ps1"
$syncBridgePath = Join-Path $rootDir "sync_bridge.json"
$notifScript = Join-Path $rootDir "show_notification.ps1"
$historyPath = Join-Path $rootDir "chat_history.json"

if (-not (Test-Path $backupDir)) {
    New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
}

if (-not (Test-Path $configPath)) {
    Write-Host "[ERROR] Không tìm thấy file config.json!" -ForegroundColor Red
    exit 1
}

$config = Get-Content $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
$botToken = $config.BOT_TOKEN
$allowedChatId = [int64]$config.ALLOWED_CHAT_ID
$geminiApiKey = if ($config.GEMINI_API_KEY) { $config.GEMINI_API_KEY.ToString().Trim() } else { "" }
$selectedModel = if ($config.SELECTED_MODEL) { $config.SELECTED_MODEL.ToString().Trim() } else { "Gemini 3.8 Flash (High)" }
$modelId = if ($config.MODEL_ID) { $config.MODEL_ID.ToString().Trim() } else { "gemini-3.8-flash" }
$thinkingLevel = if ($config.THINKING_LEVEL) { $config.THINKING_LEVEL.ToString().Trim() } else { "high" }
$executionMode = if ($config.EXECUTION_MODE) { $config.EXECUTION_MODE.ToString().Trim() } else { "auto" }
$projectsRootDir = if ($config.PROJECTS_ROOT_DIR) { $config.PROJECTS_ROOT_DIR.ToString().Trim() } else { "C:\Users\Administrator\.gemini\antigravity\scratch\model" }

# --- QUẢN LÝ HÀNG ĐỢI PROMPT & TRẠNG THÁI THỰC THI ---
$global:isExecuting = $false
$global:currentExecutingPrompt = ""
$global:currentJob = $null
$global:currentJobPrompt = ""
$global:promptQueue = [System.Collections.Generic.List[PSObject]]::new()
$global:waitingForEditPromptId = ""
$pendingCommands = @{}

if ([string]::IsNullOrWhiteSpace($botToken)) {
    Write-Host "[CẢNH BÁO] BOT_TOKEN đang trống!" -ForegroundColor Yellow
    exit 1
}

# --- CƠ CHẾ ĐẾM VÀ FORMAT TOKEN QUOTA ---

function Format-TokenFooter {
    param([int]$tokensThisCall = 0)
    
    $cfg = Get-Content $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $maxTok = if ($cfg.MAX_TOKENS) { [int64]$cfg.MAX_TOKENS } else { 1000000000 }
    $usedTok = if ($cfg.USED_TOKENS) { [int64]$cfg.USED_TOKENS } else { 0 }
    
    $usedTok += $tokensThisCall
    $cfg.USED_TOKENS = $usedTok
    $cfg | ConvertTo-Json | Set-Content $configPath -Encoding UTF8
    
    $remaining = [math]::Max(0, ($maxTok - $usedTok))
    
    $remStr = $remaining.ToString("D9")
    $maxStr = $maxTok.ToString("D9")
    return "$remStr/$maxStr"
}

# --- BỘ NHỚ LỊCH SỬ NGỮ CẢNH (CHAT CONTEXT MEMORY) ---

function Get-ChatMemory {
    if (Test-Path $historyPath) {
        try {
            $raw = Get-Content $historyPath -Raw -Encoding UTF8
            if (-not [string]::IsNullOrWhiteSpace($raw)) {
                $hist = $raw | ConvertFrom-Json
                if ($hist -is [array]) {
                    if ($hist.Count -gt 16) {
                        $hist = $hist | Select-Object -Skip ($hist.Count - 16)
                    }
                    return ,$hist
                }
            }
        } catch {}
    }
    return ,@()
}

function Save-ChatMemory {
    param($history)
    try {
        $arr = @($history)
        $arr | ConvertTo-Json -Depth 6 | Set-Content $historyPath -Encoding UTF8
    } catch {}
}

function Clear-ChatMemory {
    try {
        if (Test-Path $historyPath) {
            Remove-Item $historyPath -Force
        }
    } catch {}
}

# --- HIỂN THỊ THÔNG BÁO NỔI TRÊN MÀN HÌNH MÁY TÍNH ---

function Show-ScreenNotification {
    param(
        [string]$title = "📱 Telegram Đồng Bộ",
        [string]$msg = "",
        [int]$durationSec = 4
    )
    if (Test-Path $notifScript) {
        try {
            $safeTitle = $title.Replace('"', '\"')
            $safeMsg = $msg.Replace('"', '\"')
            Start-Process powershell.exe -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$notifScript`" -Title `"$safeTitle`" -Message `"$safeMsg`" -DurationSec $durationSec" -WindowStyle Hidden
        } catch {}
    }
}

# --- CÁC HÀM GIAO TIẾP TELEGRAM & INLINE KEYBOARD ---

function Send-TelegramMessage {
    param(
        [int64]$chatId,
        [string]$text
    )
    $url = "https://api.telegram.org/bot$botToken/sendMessage"
    if ($text.Length -gt 3800) {
        $text = $text.Substring(0, 3800) + "`n`n...[Output đã bị cắt bớt do quá dài]"
    }
    $bodyObj = @{
        chat_id = $chatId
        text = $text
        disable_web_page_preview = $true
    }
    $jsonBody = $bodyObj | ConvertTo-Json -Compress
    try {
        $res = Invoke-RestMethod -Uri $url -Method Post -ContentType "application/json; charset=utf-8" -Body ([System.Text.Encoding]::UTF8.GetBytes($jsonBody)) -TimeoutSec 15
        if ($res.ok -and $res.result) {
            return $res.result.message_id
        }
    } catch {
        Write-Host "Lỗi gửi tin nhắn: $_" -ForegroundColor Red
    }
    return $null
}

function Edit-TelegramMessage {
    param(
        [int64]$chatId,
        [int]$messageId,
        [string]$text
    )
    $url = "https://api.telegram.org/bot$botToken/editMessageText"
    if ($text.Length -gt 3800) {
        $text = $text.Substring(0, 3800) + "`n`n...[Output đã bị cắt bớt do quá dài]"
    }
    $bodyObj = @{
        chat_id = $chatId
        message_id = $messageId
        text = $text
        disable_web_page_preview = $true
    }
    $jsonBody = $bodyObj | ConvertTo-Json -Compress
    try {
        $res = Invoke-RestMethod -Uri $url -Method Post -ContentType "application/json; charset=utf-8" -Body ([System.Text.Encoding]::UTF8.GetBytes($jsonBody)) -TimeoutSec 15
        return $res.ok
    } catch {
        Send-TelegramMessage -chatId $chatId -text $text | Out-Null
    }
    return $false
}

function Send-TelegramKeyboard {
    param(
        [int64]$chatId,
        [string]$text,
        [array]$buttons
    )
    $url = "https://api.telegram.org/bot$botToken/sendMessage"
    $bodyObj = @{
        chat_id = $chatId
        text = $text
        disable_web_page_preview = $true
        reply_markup = @{
            inline_keyboard = $buttons
        }
    }
    $jsonBody = $bodyObj | ConvertTo-Json -Depth 6 -Compress
    try {
        $res = Invoke-RestMethod -Uri $url -Method Post -ContentType "application/json; charset=utf-8" -Body ([System.Text.Encoding]::UTF8.GetBytes($jsonBody)) -TimeoutSec 15
        if ($res.ok -and $res.result) {
            return $res.result.message_id
        }
    } catch {
        Write-Host "Lỗi gửi bàn phím: $_" -ForegroundColor Red
    }
    return $null
}

function Edit-TelegramKeyboard {
    param(
        [int64]$chatId,
        [int]$messageId,
        [string]$text,
        [array]$buttons = $null
    )
    $url = "https://api.telegram.org/bot$botToken/editMessageText"
    $bodyObj = @{
        chat_id = $chatId
        message_id = $messageId
        text = $text
        disable_web_page_preview = $true
    }
    if ($buttons) {
        $bodyObj["reply_markup"] = @{
            inline_keyboard = $buttons
        }
    }
    $jsonBody = $bodyObj | ConvertTo-Json -Depth 6 -Compress
    try {
        Invoke-RestMethod -Uri $url -Method Post -ContentType "application/json; charset=utf-8" -Body ([System.Text.Encoding]::UTF8.GetBytes($jsonBody)) -TimeoutSec 15 | Out-Null
    } catch {
        Write-Host "Lỗi sửa bàn phím: $_" -ForegroundColor Red
    }
}

function Send-TelegramAction {
    param(
        [int64]$chatId,
        [string]$action = "typing"
    )
    $url = "https://api.telegram.org/bot$botToken/sendChatAction"
    $bodyObj = @{ chat_id = $chatId; action = $action }
    $jsonBody = $bodyObj | ConvertTo-Json -Compress
    try {
        Invoke-RestMethod -Uri $url -Method Post -ContentType "application/json; charset=utf-8" -Body ([System.Text.Encoding]::UTF8.GetBytes($jsonBody)) -TimeoutSec 5 | Out-Null
    } catch {}
}

function Answer-TelegramCallback {
    param(
        [string]$callbackId,
        [string]$text = ""
    )
    $url = "https://api.telegram.org/bot$botToken/answerCallbackQuery"
    $bodyObj = @{ callback_query_id = $callbackId }
    if ($text) { $bodyObj["text"] = $text }
    $jsonBody = $bodyObj | ConvertTo-Json -Compress
    try {
        Invoke-RestMethod -Uri $url -Method Post -ContentType "application/json; charset=utf-8" -Body ([System.Text.Encoding]::UTF8.GetBytes($jsonBody)) -TimeoutSec 10 | Out-Null
    } catch {}
}

function Send-TelegramPhoto {
    param(
        [int64]$chatId,
        [string]$imagePath,
        [string]$caption = ""
    )
    if (-not (Test-Path $imagePath)) {
        Send-TelegramMessage -chatId $chatId -text "Không tìm thấy file ảnh: $imagePath"
        return
    }
    try {
        $url = "https://api.telegram.org/bot$botToken/sendPhoto"
        & curl.exe -s -X POST $url -F "chat_id=$chatId" -F "photo=@$imagePath" -F "caption=$caption" | Out-Null
    } catch {
        Write-Host "Lỗi gửi ảnh: $_" -ForegroundColor Red
    }
}

# --- CÁC HÀM TỰ SAO LƯU & NÂNG CẤP ---

function Backup-BotScript {
    $timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
    $bakFile = Join-Path $backupDir "bot_$timestamp.ps1"
    try {
        Copy-Item -Path $botScript -Destination $bakFile -Force
        $allBaks = Get-ChildItem -Path $backupDir -Filter "*.ps1" | Sort-Object LastWriteTime -Descending
        if ($allBaks.Count -gt 15) {
            $allBaks | Select-Object -Skip 15 | Remove-Item -Force
        }
        return $bakFile
    } catch {
        return $null
    }
}

function Test-ScriptSyntax {
    param([string]$codeContent)
    $errors = $null
    [void][System.Management.Automation.Language.Parser]::ParseInput($codeContent, [ref]$null, [ref]$errors)
    if ($errors -and $errors.Count -gt 0) {
        $errMsgs = $errors | ForEach-Object { "- Dòng $($_.Extent.StartLineNumber): $($_.Message)" }
        return ($errMsgs -join "`n")
    }
    return $null
}

function Apply-SelfUpgrade {
    param(
        [int64]$chatId,
        [string]$newCode,
        [string]$reason = ""
    )
    Send-TelegramMessage -chatId $chatId -text "Đang kiểm tra cú pháp bản nâng cấp..."

    $syntaxErrors = Test-ScriptSyntax -codeContent $newCode
    if ($syntaxErrors) {
        $errReport = @(
            "TỪ CHỐI NÂNG CẤP DO LỖI CÚ PHÁP:",
            "",
            $syntaxErrors,
            "",
            "Bản nâng cấp chưa đạt an toàn nên không thể áp dụng."
        ) -join "`n"
        Send-TelegramMessage -chatId $chatId -text $errReport
        return $false
    }

    $bak = Backup-BotScript
    if (-not $bak) {
        Send-TelegramMessage -chatId $chatId -text "Không thể sao lưu file hiện tại. Hủy thao tác nâng cấp."
        return $false
    }

    try {
        [System.IO.File]::WriteAllText($botScript, $newCode, [System.Text.Encoding]::UTF8)
        Send-TelegramMessage -chatId $chatId -text "ĐÃ CẬP NHẬT MÃ NGUỒN AN TOÀN!`nĐã sao lưu về: $(Split-Path $bak -Leaf)`nĐang khởi động lại bot..."
        Start-Sleep -Seconds 1
        exit 0
    } catch {
        Send-TelegramMessage -chatId $chatId -text "Lỗi khi ghi đè mã nguồn: $_"
        return $false
    }
}

function Rollback-ToPreviousBackup {
    param([int64]$chatId)
    $baks = Get-ChildItem -Path $backupDir -Filter "*.ps1" | Sort-Object LastWriteTime -Descending
    if (-not $baks -or $baks.Count -lt 1) {
        Send-TelegramMessage -chatId $chatId -text "Không tìm thấy bản backup nào để hoàn tác."
        return
    }
    $targetBak = $baks[0]
    try {
        Copy-Item -Path $targetBak.FullName -Destination $botScript -Force
        Send-TelegramMessage -chatId $chatId -text "ĐÃ HOÀN TÁC VỀ BẢN BẢO VỆ: $($targetBak.Name)! Đang khởi động lại..."
        Start-Sleep -Seconds 2
        exit 0
    } catch {
        Send-TelegramMessage -chatId $chatId -text "Lỗi rollback: $_"
    }
}

# --- CẦU NỐI ĐỒNG BỘ VỚI BOX CHAT ANTIGRAVITY (SYNC BRIDGE) ---

function Initialize-SyncBridge {
    param([int64]$chatId)
    $randomCode = "SYNC-" + (Get-Random -Minimum 1000 -Maximum 9999).ToString()
    
    $bridgeData = @{
        syncCode = $randomCode
        status = "PENDING"
        connectedAt = ""
        active = $false
        conversationId = "ecedb8d9-583d-4320-b8ee-9602abb6b87f"
        messages = @()
    }
    $bridgeData | ConvertTo-Json -Depth 5 | Set-Content $syncBridgePath -Encoding UTF8

    Show-ScreenNotification -title "🔗 Yêu Cầu Kết Nối Đồng Bộ" -msg "Mã từ Telegram: $randomCode" -durationSec 5

    $msg = @(
        "🔗 MÃ KẾT NỐI ĐỒNG BỘ: $randomCode",
        "",
        "Bạn hãy copy mã trên và dán vào ô chat Antigravity trên máy tính để kết nối!",
        "",
        "Khi đã kết nối, mọi tin nhắn bạn gửi ở đây sẽ NHẢY LÊN MÀN HÌNH MÁY TÍNH trong thời gian thực.",
        "(Để ngắt kết nối bất cứ lúc nào, chỉ cần nói: 'ngắt kết nối')"
    ) -join "`n"

    Send-TelegramMessage -chatId $chatId -text $msg
}

function Disconnect-SyncBridge {
    param([int64]$chatId)
    if (Test-Path $syncBridgePath) {
        $bridgeData = @{
            syncCode = ""
            status = "DISCONNECTED"
            connectedAt = ""
            active = $false
            conversationId = ""
            messages = @()
        }
        $bridgeData | ConvertTo-Json -Depth 5 | Set-Content $syncBridgePath -Encoding UTF8
    }
    Show-ScreenNotification -title "🔌 Đồng Bộ Telegram" -msg "Đã ngắt kết nối đồng bộ với máy tính." -durationSec 4
    Send-TelegramMessage -chatId $chatId -text "🔌 Đã ngắt kết nối đồng bộ với box chat máy tính. Bot đã trở về chế độ độc lập bình thường!"
}

function Send-ToAntigravityChat {
    param([string]$text)
    if (Test-Path $syncBridgePath) {
        try {
            $bridge = Get-Content $syncBridgePath -Raw -Encoding UTF8 | ConvertFrom-Json
            if ($bridge.active -and $bridge.conversationId) {
                $langServer = "C:\Users\Administrator\AppData\Local\Programs\antigravity\resources\bin\language_server.exe"
                if (Test-Path $langServer) {
                    & $langServer agentapi send-message $bridge.conversationId "[Điện thoại gửi]: $text" 2>&1 | Out-Null
                    return $true
                }
            }
        } catch {}
    }
    return $false
}

function Check-SyncBridgeStatus {
    if (Test-Path $syncBridgePath) {
        try {
            $data = Get-Content $syncBridgePath -Raw -Encoding UTF8 | ConvertFrom-Json
            if ($data.active -eq $true -and $data.status -eq "CONNECTED") {
                return $true
            }
        } catch {}
    }
    return $false
}

function Append-SyncMessage {
    param([string]$sender, [string]$text)
    if (Test-Path $syncBridgePath) {
        try {
            $data = Get-Content $syncBridgePath -Raw -Encoding UTF8 | ConvertFrom-Json
            if ($null -eq $data.messages) { $data.messages = @() }
            
            $newMsg = @{
                id = [System.Guid]::NewGuid().ToString("N").Substring(0, 8)
                sender = $sender
                text = $text
                timestamp = (Get-Date -Format "yyyy-MM-dd HH:mm:ss")
            }
            $data.messages += $newMsg
            if ($data.messages.Count -gt 50) {
                $data.messages = $data.messages | Select-Object -Skip ($data.messages.Count - 50)
            }
            $data | ConvertTo-Json -Depth 5 | Set-Content $syncBridgePath -Encoding UTF8
        } catch {}
    }
}

# --- CÁC HÀM TIỆN ÍCH HỆ THỐNG & MENU MODEL GIỐNG HỆT IDE ---

function Get-ModelMainMenuButtons {
    param([string]$curModelId = $modelId, [string]$curLevel = $thinkingLevel)

    $g38Label = "Gemini 3.8 Flash"
    if ($curModelId -eq "gemini-3.8-flash") {
        $capLevel = if ($curLevel) { $curLevel.Substring(0,1).ToUpper() + $curLevel.Substring(1).ToLower() } else { "High" }
        $g38Label = "Gemini 3.8 Flash   $capLevel   ✓"
    } else {
        $g38Label = "Gemini 3.8 Flash ❯"
    }

    $sonnetLabel = "Claude Sonnet 4.6 (Thinking)   Notice ⓘ" + $(if ($curModelId -eq "claude-sonnet-4.6") { " ✓" } else { "" })
    $opusLabel = "Claude Opus 4.6 (Thinking)   Notice ⓘ" + $(if ($curModelId -eq "claude-opus-4.6") { " ✓" } else { "" })
    $gptLabel = "GPT-OSS 120B (Medium)   Notice ⓘ" + $(if ($curModelId -eq "gpt-oss-120b") { " ✓" } else { "" })
    $argonLabel = "Gemini 4 Argon   Unavailable ⓘ" + $(if ($curModelId -eq "gemini-4-argon") { " ✓" } else { "" })

    return @(
        @( @{ text = $g38Label; callback_data = "menu:gemini38" } ),
        @( @{ text = $sonnetLabel; callback_data = "setmodel:claude-sonnet-4.6:Claude Sonnet 4.6 (Thinking)" } ),
        @( @{ text = $opusLabel; callback_data = "setmodel:claude-opus-4.6:Claude Opus 4.6 (Thinking)" } ),
        @( @{ text = $gptLabel; callback_data = "setmodel:gpt-oss-120b:GPT-OSS 120B (Medium)" } ),
        @( @{ text = $argonLabel; callback_data = "setmodel:gemini-4-argon:Gemini 4 Argon" } ),
        @( @{ text = "⏲ View Usage >"; callback_data = "menu:usage" } )
    )
}

function Show-ModelMenu {
    param([int64]$chatId)
    $text = "Model (Hiện tại: $selectedModel):"
    $buttons = Get-ModelMainMenuButtons
    Send-TelegramKeyboard -chatId $chatId -text $text -buttons $buttons
}

# --- HÀM NẠP GỢI Ý HÀNG ĐỢI PROMPT (4 HOẶC 5 NÚT) ---

function Get-QueueButtons {
    param([string]$targetId)

    $buttons = @()
    # Nút 1: Ưu tiên dùng prompt này (Send now)
    $buttons += ,@( @{ text = "⚡ Ưu tiên dùng prompt này (Send now)"; callback_data = "q_now:$targetId" } )
    # Nút 2: Sửa prompt đang chờ đó
    $buttons += ,@( @{ text = "✏️ Sửa prompt đang chờ đó"; callback_data = "q_edit:$targetId" } )
    # Nút 3: Xóa prompt này
    $buttons += ,@( @{ text = "🗑️ Xóa prompt này"; callback_data = "q_del:$targetId" } )
    # Nút 4: Gửi thêm vào hàng chờ
    $buttons += ,@( @{ text = "➕ Gửi thêm vào hàng chờ"; callback_data = "q_add" } )

    # Nút 5: Nếu có từ 2 prompt trở lên trong hàng chờ
    if ($global:promptQueue.Count -ge 2) {
        $buttons += ,@( @{ text = "📝 Chỉnh prompt trong hàng chờ ($($global:promptQueue.Count) prompt)"; callback_data = "q_list" } )
    }

    return $buttons
}

# --- KIỂM TRA VÀ CHẠY TIẾP PROMPT TRONG HÀNG ĐỢI ---

function Check-And-Run-Next-In-Queue {
    param([int64]$chatId)

    if ($global:promptQueue.Count -gt 0) {
        $next = $global:promptQueue[0]
        $global:promptQueue.RemoveAt(0)

        $remCount = $global:promptQueue.Count
        $remNotice = if ($remCount -gt 0) { "`n*(Còn lại trong hàng chờ: $remCount prompt)*" } else { "" }

        Send-TelegramMessage -chatId $chatId -text "🚀 Đang thực thi prompt tiếp theo từ hàng đợi:`n""pro: $($next.preview)""$remNotice"
        Execute-UserPrompt -chatId $chatId -text $next.text
    } else {
        $global:isExecuting = $false
        $global:currentExecutingPrompt = ""
    }
}

# --- NÃO BỘ AI GEMINI (TƯ DUY & XỬ LÝ) ---

function Ask-GeminiAI {
    param([string]$userText)
    $reqFile = Join-Path $env:TEMP "gemini_req_$([System.Guid]::NewGuid().ToString('N')).json"

    $botContext = ""
    if ($userText -match '(?i)(mã nguồn bot|code của bot|nâng cấp bot|sửa file bot|bot\.ps1)') {
        $currentBotCode = Get-Content -Path $botScript -Raw -Encoding UTF8
        $botContext = "`n`n[MÃ NGUỒN BOT.PS1 HIỆN TẠI]:`n$currentBotCode"
    }

    $thinkingInstruction = ""
    if ($thinkingLevel -eq "high") {
        $thinkingInstruction = "Mức độ tư duy: HIGH (Phân tích sâu sắc, xem xét nhiều khía cạnh và tối ưu mã nguồn)."
    } elseif ($thinkingLevel -eq "medium") {
        $thinkingInstruction = "Mức độ tư duy: MEDIUM (Cân bằng giữa tốc độ và chiều sâu)."
    } else {
        $thinkingInstruction = "Mức độ tư duy: LOW (Trả lời nhanh, súc tích, ngắn gọn)."
    }

    $history = Get-ChatMemory
    $contentsList = [System.Collections.Generic.List[PSObject]]::new()
    
    $expectedRole = "user"
    foreach ($turn in $history) {
        if ($turn.role -eq $expectedRole -and $turn.parts -and $turn.parts[0].text) {
            $contentsList.Add(@{
                role = $turn.role
                parts = @(@{ text = $turn.parts[0].text })
            })
            $expectedRole = if ($expectedRole -eq "user") { "model" } else { "user" }
        }
    }

    if ($contentsList.Count -gt 0 -and $contentsList[$contentsList.Count - 1].role -eq "user") {
        $contentsList.RemoveAt($contentsList.Count - 1)
    }

    $contentsList.Add(@{
        role = "user"
        parts = @(@{ text = "User: $userText$botContext" })
    })

    $sysPrompt = @"
Bạn là trợ lý lập trình AI thông minh cao cấp, có toàn quyền điều khiển hệ thống và terminal máy tính từ xa qua Telegram của người dùng.
Model đang dùng: $selectedModel.
$thinkingInstruction
Người dùng đang trò chuyện bằng điện thoại.

QUY TẮC QUẢN LÝ PROJECT & THƯ MỤC LƯU FILE:
- Thư mục gốc chứa mọi project: $projectsRootDir
- BẤT KỲ KHI NÀO người dùng yêu cầu làm một project mới hoặc viết tính năng:
  1. TUYỆT ĐỐI KHÔNG hỏi người dùng "lưu file ở đâu?".
  2. Tự động đặt tên project và tạo một thư mục con bên trong thư mục gốc: "$projectsRootDir\<tên_project>\".
  3. Mọi file code, dữ liệu, cấu hình tạo ra PHẢI nằm gọn trong thư mục con đó!

CÁC NGUYÊN TẮC HÀNH ĐỘNG BẮT BUỘC:
1. GHI NHỚ TOÀN DIỆN NGỮ CẢNH: Bạn có trí nhớ theo dõi toàn bộ các lượt trò chuyện trước đó. Khi người dùng nói "cứ làm đi", "làm tiếp đi", "sửa đi", "bạn làm được mà cứ làm đó đi", "sao chưa làm", bạn PHẢI hiểu ngay người dùng đang nhắc đến công việc nào ở các câu trước và HÀNH ĐỘNG NGAY LẬP TỨC!
2. HÀNH ĐỘNG THỰC TẾ THAY VÌ NÓI SUÔNG:
   - TUYỆT ĐỐI KHÔNG chỉ nói "Tôi sẽ làm...", "Tôi có thể giúp gì...", "Bạn chờ nhé...", "Được rồi...".
   - BẤT KỲ KHI NÀO người dùng yêu cầu thực hiện một hành động (như tạo file, sửa code, chạy script, tải file, kiểm tra thư mục, cài đặt phần mềm, chạy terminal...):
     BẠN PHẢI XUẤT NGAY KHỐI LỆNH THỰC THI:
     ```run
     <câu lệnh powershell cụ thể để máy tính thực thi ngay>
     ```
   - Giải thích ngắn gọn việc bạn đang làm trước khối ```run.
3. TUYỆT ĐỐI KHÔNG xuất khối ```upgrade:powershell trừ khi người dùng nói rõ: 'sửa mã nguồn bot', 'sửa file bot.ps1', 'nâng cấp code của bot'.
4. Nếu người dùng chỉ nói đổi model hoặc đổi cài đặt, hãy xác nhận là đã hiểu và KHÔNG xuất khối upgrade hay run.
5. Ngôn ngữ: Nói chuyện tự nhiên, thân thiện, thông minh, Tiếng Việt có dấu chuẩn xác 100%.
"@

    $payload = @{
        systemInstruction = @{
            parts = @(@{ text = $sysPrompt })
        }
        contents = $contentsList
    } | ConvertTo-Json -Depth 6

    [System.IO.File]::WriteAllText($reqFile, $payload, [System.Text.Encoding]::UTF8)

    $modelsToTry = @("gemini-flash-lite-latest", "gemini-flash-latest", "gemini-2.5-flash")

    $tokensUsedThisCall = 25
    $responseText = ""

    foreach ($m in $modelsToTry) {
        $url = "https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent"
        try {
            $rawRes = cmd.exe /c "curl -s -X POST `"$url`" -H ""Content-Type: application/json"" -H ""X-goog-api-key: $geminiApiKey"" -d @`"$reqFile`""
            if (-not [string]::IsNullOrWhiteSpace($rawRes)) {
                $parsed = $rawRes | ConvertFrom-Json
                if ($parsed.candidates -and $parsed.candidates[0].content.parts) {
                    $responseText = $parsed.candidates[0].content.parts[0].text
                    if ($parsed.usageMetadata -and $parsed.usageMetadata.totalTokenCount) {
                        $tokensUsedThisCall = [int]$parsed.usageMetadata.totalTokenCount
                    }
                    break
                }
            }
        } catch {}
    }

    Remove-Item $reqFile -Force -ErrorAction SilentlyContinue

    if ([string]::IsNullOrWhiteSpace($responseText)) {
        return "Các model AI đang tạm thời quá tải, bạn vui lòng thử lại sau vài giây nhé!"
    }

    $historyToSave = [System.Collections.Generic.List[PSObject]]::new()
    foreach ($item in $contentsList) {
        $historyToSave.Add($item)
    }
    $historyToSave.Add(@{
        role = "model"
        parts = @(@{ text = $responseText })
    })
    Save-ChatMemory -history $historyToSave

    $tokenFooter = Format-TokenFooter -tokensThisCall $tokensUsedThisCall
    return "$responseText`n`n$tokenFooter"
}

function Ask-GeminiVision {
    param(
        [string]$userText,
        [string]$base64Image,
        [string]$mimeType = "image/jpeg"
    )
    $reqFile = Join-Path $env:TEMP "gemini_vision_$([System.Guid]::NewGuid().ToString('N')).json"
    if ([string]::IsNullOrWhiteSpace($userText)) {
        $userText = "Hãy nhìn bức ảnh này và phân tích chi tiết giúp tôi. Nếu có code hoặc thông báo lỗi, hãy đọc nội dung và hướng dẫn xử lý."
    }

    $sysPrompt = "Bạn là trợ lý lập trình AI có thị giác siêu việt (Multimodal Vision) điều khiển máy tính từ xa. Hãy quan sát ảnh kỹ lưỡng và trả lời bằng Tiếng Việt có dấu rõ ràng, chuẩn xác."

    $payload = @{
        systemInstruction = @{
            parts = @(@{ text = $sysPrompt })
        }
        contents = @(
            @{
                role = "user"
                parts = @(
                    @{ text = $userText },
                    @{
                        inlineData = @{
                            mimeType = $mimeType
                            data = $base64Image
                        }
                    }
                )
            }
        )
    } | ConvertTo-Json -Depth 6

    [System.IO.File]::WriteAllText($reqFile, $payload, [System.Text.Encoding]::UTF8)

    $modelsToTry = @("gemini-flash-lite-latest", "gemini-flash-latest", "gemini-2.5-flash")
    $tokensUsedThisCall = 40
    $responseText = ""

    foreach ($m in $modelsToTry) {
        $url = "https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent"
        try {
            $rawRes = cmd.exe /c "curl -s -X POST `"$url`" -H ""Content-Type: application/json"" -H ""X-goog-api-key: $geminiApiKey"" -d @`"$reqFile`""
            if (-not [string]::IsNullOrWhiteSpace($rawRes)) {
                $parsed = $rawRes | ConvertFrom-Json
                if ($parsed.candidates -and $parsed.candidates[0].content.parts) {
                    $responseText = $parsed.candidates[0].content.parts[0].text
                    if ($parsed.usageMetadata -and $parsed.usageMetadata.totalTokenCount) {
                        $tokensUsedThisCall = [int]$parsed.usageMetadata.totalTokenCount
                    }
                    break
                }
            }
        } catch {}
    }

    Remove-Item $reqFile -Force -ErrorAction SilentlyContinue

    if ([string]::IsNullOrWhiteSpace($responseText)) {
        return "AI Vision đang tạm thời bận, bạn hãy gửi lại ảnh nhé!"
    }

    $tokenFooter = Format-TokenFooter -tokensThisCall $tokensUsedThisCall
    return "$responseText`n`n$tokenFooter"
}

# --- HÀM THỰC THI CHÍNH CỦA PROMPT (EXECUTE ENGINE) ---

function Execute-UserPrompt {
    param(
        [int64]$chatId,
        [string]$text
    )

    $global:isExecuting = $true
    $preview = if ($text.Length -gt 35) { $text.Substring(0, 35) + "..." } else { $text }
    $global:currentExecutingPrompt = "pro: $preview"

    if (Check-SyncBridgeStatus) {
        Append-SyncMessage -sender "phone" -text $text
        Send-ToAntigravityChat -text $text
    }

    # 1. Các lệnh cài đặt & cấu hình nhanh
    if ($text -match '(?i)(3\.8|gemini 3\.8)') {
        $level = "high"
        $levelName = "High"
        if ($text -match '(?i)(low|thấp|nhanh)') { $level = "low"; $levelName = "Low" }
        elseif ($text -match '(?i)(medium|vừa|trung bình)') { $level = "medium"; $levelName = "Medium" }

        $selectedModel = "Gemini 3.8 Flash ($levelName)"
        $modelId = "gemini-3.8-flash"
        $thinkingLevel = $level

        $config.SELECTED_MODEL = $selectedModel
        $config.MODEL_ID = $modelId
        $config.THINKING_LEVEL = $level
        $config | ConvertTo-Json | Set-Content $configPath -Encoding UTF8

        Show-ScreenNotification -title "⚙️ Đổi Model Thành Công" -msg "$selectedModel" -durationSec 3
        $tokenCur = Format-TokenFooter -tokensThisCall 0
        Send-TelegramMessage -chatId $chatId -text "✅ Đã chuyển sang Model: $selectedModel!`n`n• Thinking: $($level.ToUpper())`n• Token: $tokenCur"
        Check-And-Run-Next-In-Queue -chatId $chatId
        return
    }
    elseif ($text -match '(?i)(sonnet|claude.*sonnet)') {
        $selectedModel = "Claude Sonnet 4.6 (Thinking)"
        $modelId = "claude-sonnet-4.6"
        $config.SELECTED_MODEL = $selectedModel
        $config.MODEL_ID = $modelId
        $config | ConvertTo-Json | Set-Content $configPath -Encoding UTF8
        Show-ScreenNotification -title "⚙️ Đổi Model Thành Công" -msg "$selectedModel" -durationSec 3
        Send-TelegramMessage -chatId $chatId -text "✅ Đã chuyển sang: Claude Sonnet 4.6 (Thinking)!"
        Check-And-Run-Next-In-Queue -chatId $chatId
        return
    }
    elseif ($text -match '(?i)(opus|claude.*opus)') {
        $selectedModel = "Claude Opus 4.6 (Thinking)"
        $modelId = "claude-opus-4.6"
        $config.SELECTED_MODEL = $selectedModel
        $config.MODEL_ID = $modelId
        $config | ConvertTo-Json | Set-Content $configPath -Encoding UTF8
        Show-ScreenNotification -title "⚙️ Đổi Model Thành Công" -msg "$selectedModel" -durationSec 3
        Send-TelegramMessage -chatId $chatId -text "✅ Đã chuyển sang: Claude Opus 4.6 (Thinking)!"
        Check-And-Run-Next-In-Queue -chatId $chatId
        return
    }
    elseif ($text -match '(?i)(argon|gemini 4)') {
        $selectedModel = "Gemini 4 Argon"
        $modelId = "gemini-4-argon"
        $config.SELECTED_MODEL = $selectedModel
        $config.MODEL_ID = $modelId
        $config | ConvertTo-Json | Set-Content $configPath -Encoding UTF8
        Show-ScreenNotification -title "⚙️ Đổi Model Thành Công" -msg "$selectedModel" -durationSec 3
        Send-TelegramMessage -chatId $chatId -text "✅ Đã chuyển sang: Gemini 4 Argon!"
        Check-And-Run-Next-In-Queue -chatId $chatId
        return
    }
    elseif ($text -match '(?i)(hỏi từng lượt|hoi tung luot|ask mode)') {
        $executionMode = "ask"
        $config.EXECUTION_MODE = "ask"
        $config | ConvertTo-Json | Set-Content $configPath -Encoding UTF8
        Show-ScreenNotification -title "⚙️ Đổi Chế Độ Code" -msg "Hỏi từng lượt" -durationSec 3
        Send-TelegramMessage -chatId $chatId -text "✅ Đã chuyển sang: ❓ Hỏi từng lượt."
        Check-And-Run-Next-In-Queue -chatId $chatId
        return
    }
    elseif ($text -match '(?i)(chấp nhận tất cả|chap nhan tat ca|auto run|tự chạy)') {
        $executionMode = "auto"
        $config.EXECUTION_MODE = "auto"
        $config | ConvertTo-Json | Set-Content $configPath -Encoding UTF8
        Show-ScreenNotification -title "⚙️ Đổi Chế Độ Code" -msg "Chấp nhận tất cả" -durationSec 3
        Send-TelegramMessage -chatId $chatId -text "✅ Đã chuyển sang: ⚡ Chấp nhận tất cả."
        Check-And-Run-Next-In-Queue -chatId $chatId
        return
    }
    elseif ($text -match '(?i)(đường dẫn.*model|folder.*model|thư mục.*model|/setdir)\s*[:=]?\s*([a-zA-Z]:[\\/][^\r\n]+)') {
        $newDir = $matches[2].Trim()
        $config.PROJECTS_ROOT_DIR = $newDir
        $projectsRootDir = $newDir
        if (-not (Test-Path $newDir)) { New-Item -ItemType Directory -Path $newDir -Force | Out-Null }
        $config | ConvertTo-Json | Set-Content $configPath -Encoding UTF8
        Show-ScreenNotification -title "📁 Cấu Hình Thư Mục Project" -msg "$newDir" -durationSec 4
        Send-TelegramMessage -chatId $chatId -text "📁 ĐÃ LƯU THƯ MỤC GỐC MODEL THÀNH CÔNG!`n`nĐường dẫn: $newDir`n`nTừ bây giờ mọi project sẽ tự động sinh thư mục con bên trong folder này!"
        Check-And-Run-Next-In-Queue -chatId $chatId
        return
    }
    elseif ($text -eq "/clear" -or $text -match '(?i)(^xóa lịch sử|^xóa nhớ|^clear memory|^reset chat)') {
        Clear-ChatMemory
        Send-TelegramMessage -chatId $chatId -text "🧹 Đã xóa sạch bộ nhớ ngữ cảnh trò chuyện!"
        Check-And-Run-Next-In-Queue -chatId $chatId
        return
    }
    elseif ($text -eq "/stop" -or $text -match '(?i)(^dừng lại|^hủy lệnh|^cancel command)') {
        if ($global:currentJob) {
            Stop-Job $global:currentJob -Force
            Remove-Job $global:currentJob -Force
            $global:currentJob = $null
        }
        $global:promptQueue.Clear()
        $global:isExecuting = $false
        $global:currentExecutingPrompt = ""
        Send-TelegramMessage -chatId $chatId -text "⏹️ Đã dừng lệnh đang chạy và xóa sạch hàng đợi!"
        return
    }
    elseif ($text.StartsWith("/cmd ") -or $text.StartsWith("! ")) {
        $cmdToRun = if ($text.StartsWith("/cmd ")) { $text.Substring(5).Trim() } else { $text.Substring(2).Trim() }
        Show-ScreenNotification -title "🖥️ Chạy Lệnh Terminal" -msg $cmdToRun -durationSec 3
        Send-TelegramMessage -chatId $chatId -text "⚡ Đang chạy lệnh từ pro: ""$preview""`n`n(powershell: $cmdToRun)"
        $global:currentJobPrompt = $preview
        $global:currentJob = Start-Job -ScriptBlock {
            param($c)
            powershell.exe -NoProfile -ExecutionPolicy Bypass -Command $c 2>&1 | Out-String
        } -ArgumentList $cmdToRun
        return
    }

    # 2. Xử lý qua AI Gemini
    if (-not [string]::IsNullOrWhiteSpace($geminiApiKey)) {
        Send-TelegramAction -chatId $chatId -action "typing"
        $aiResponse = Ask-GeminiAI -userText $text

        $cleanPreview = ($aiResponse -split "`n`n\d{9}/\d{9}")[0]
        if ($cleanPreview.Length -gt 150) { $cleanPreview = $cleanPreview.Substring(0, 150) + "..." }
        Show-ScreenNotification -title "🤖 AI Phản Hồi -> Máy tính" -msg $cleanPreview -durationSec 4

        if (Check-SyncBridgeStatus) { Append-SyncMessage -sender "ai" -text $aiResponse }

        if ($aiResponse -match '```upgrade:powershell\s*([\s\S]*?)```') {
            $newScriptCode = $matches[1].Trim()
            Send-TelegramMessage -chatId $chatId -text "AI đã tạo bản nâng cấp mới! Đang bắt đầu sao lưu và kiểm tra an toàn..."
            Apply-SelfUpgrade -chatId $chatId -newCode $newScriptCode -reason "Yêu cầu từ người dùng: $text"
            Check-And-Run-Next-In-Queue -chatId $chatId
            return
        }
        elseif ($aiResponse -match '```run\s*([\s\S]*?)```') {
            $cmdToAutoRun = $matches[1].Trim()
            $cleanText = $aiResponse -replace '```run[\s\S]*?```', ''

            if ($executionMode -eq "ask") {
                $cmdId = [System.Guid]::NewGuid().ToString('N').Substring(0, 8)
                $pendingCommands[$cmdId] = $cmdToAutoRun

                $promptText = "$cleanText`n`n⚠️ AI yêu cầu thực thi lệnh sau trên máy tính:`n`powershell: $cmdToAutoRun`n`nBạn có cho phép chạy không?"
                $askButtons = @(
                    @(
                        @{ text = "✅ Cho phép chạy"; callback_data = "exec:$cmdId" },
                        @{ text = "❌ Hủy bỏ"; callback_data = "cancel:$cmdId" }
                    )
                )
                Send-TelegramKeyboard -chatId $chatId -text $promptText -buttons $askButtons
                $global:isExecuting = $false
                return
            }
            else {
                # CHẾ ĐỘ AUTO-RUN: BẮT ĐẦU CHẠY NỀN QUA START-JOB ĐỂ KHÔNG CHẶN HÀNG ĐỢI
                Show-ScreenNotification -title "⚡ Đang chạy lệnh máy tính" -msg $cmdToAutoRun -durationSec 3
                Send-TelegramMessage -chatId $chatId -text "$cleanText`n`n⚡ Đang chạy lệnh từ pro: ""$preview""`n`n(powershell: $cmdToAutoRun)"
                $global:currentJobPrompt = $preview
                $global:currentJob = Start-Job -ScriptBlock {
                    param($c)
                    powershell.exe -NoProfile -ExecutionPolicy Bypass -Command $c 2>&1 | Out-String
                } -ArgumentList $cmdToAutoRun
                return
            }
        }
        else {
            Send-TelegramMessage -chatId $chatId -text $aiResponse
            Check-And-Run-Next-In-Queue -chatId $chatId
            return
        }
    }
    else {
        Send-TelegramMessage -chatId $chatId -text "Vui lòng cài đặt Gemini API Key bằng lệnh: /setkey <key>"
        Check-And-Run-Next-In-Queue -chatId $chatId
        return
    }
}

# --- VÒNG LẶP CHÍNH CỦA BOT ---

Write-Host "==========================================================" -ForegroundColor Green
Write-Host " Telegram Remote Coder v8.4 (Prompt Queue & Priority) đang chạy..." -ForegroundColor Green
Write-Host " Owner ID: $allowedChatId" -ForegroundColor Yellow
Write-Host " Current Model: $selectedModel | Execution Mode: $executionMode" -ForegroundColor Cyan
Write-Host " Projects Root: $projectsRootDir" -ForegroundColor DarkCyan
Write-Host "==========================================================" -ForegroundColor Green

$offset = 0

while ($true) {
    # 1. KIỂM TRA TIẾN TRÌNH LỆNH CHẠY NỀN HIỆN TẠI
    if ($global:currentJob) {
        if ($global:currentJob.State -in @('Completed', 'Failed', 'Stopped')) {
            $jobOut = Receive-Job $global:currentJob | Out-String
            Remove-Job $global:currentJob -Force
            $global:currentJob = $null

            if ([string]::IsNullOrWhiteSpace($jobOut)) {
                $jobOut = "(Lệnh đã chạy xong, không có output)"
            }
            $tokenEnd = Format-TokenFooter -tokensThisCall 10
            Send-TelegramMessage -chatId $allowedChatId -text "=== [Kết quả: $($global:currentJobPrompt)] ===`n$jobOut`n`n$tokenEnd"

            $global:isExecuting = $false
            $global:currentExecutingPrompt = ""

            # TỰ ĐỘNG LẤY PROMPT TIẾP THEO TRONG HÀNG ĐỢI ĐỂ CHẠY
            Check-And-Run-Next-In-Queue -chatId $allowedChatId
        }
    }

    # 2. LẮNG NGHE TIN NHẮN TỪ TELEGRAM (TIMEOUT NHANH 1S NẾU ĐANG CHẠY ĐỂ BẮT HÀNG ĐỢI)
    try {
        $pollTimeout = if ($global:isExecuting -or $global:currentJob) { 1 } else { 12 }
        $updatesUrl = "https://api.telegram.org/bot$botToken/getUpdates?offset=$offset&timeout=$pollTimeout"
        $response = Invoke-RestMethod -Uri $updatesUrl -Method Get -TimeoutSec ($pollTimeout + 10)

        if ($response.ok -and $response.result) {
            foreach ($item in $response.result) {
                $offset = [int64]$item.update_id + 1

                # ========================================================
                # A. XỬ LÝ SỰ KIỆN BẤM NÚT (INLINE CALLBACK QUERY)
                # ========================================================
                if ($item.callback_query) {
                    $cb = $item.callback_query
                    $cbId = $cb.id
                    $cbChatId = [int64]$cb.message.chat.id
                    $cbMsgId = [int]$cb.message.message_id
                    $data = $cb.data.Trim()

                    if ($cbChatId -ne $allowedChatId) {
                        Answer-TelegramCallback -callbackId $cbId -text "Bạn không có quyền!"
                        continue
                    }

                    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Bấm nút: $data" -ForegroundColor Magenta

                    # --- XỬ LÝ CÁC NÚT TRONG HÀNG ĐỢI PROMPT (QUEUE ACTIONS) ---

                    # Nút 1: Ưu tiên dùng prompt này (Send now)
                    if ($data.StartsWith("q_now:")) {
                        $targetId = $data.Substring(6).Trim()
                        $foundItem = $global:promptQueue | Where-Object { $_.id -eq $targetId } | Select-Object -First 1
                        if ($foundItem) {
                            $global:promptQueue.Remove($foundItem)
                            Answer-TelegramCallback -callbackId $cbId -text "Đang ưu tiên thực thi ngay..."
                            
                            # Dừng lệnh hiện tại nếu có
                            if ($global:currentJob) {
                                Stop-Job $global:currentJob -Force
                                Remove-Job $global:currentJob -Force
                                $global:currentJob = $null
                                Send-TelegramMessage -chatId $cbChatId -text "⏹️ Đã dừng tiến trình trước đó để ưu tiên chạy ngay prompt mới!"
                            }

                            Send-TelegramMessage -chatId $cbChatId -text "⚡ [SEND NOW]: Đang thực thi ngay lập tức prompt:`n""$($foundItem.preview)"""
                            Execute-UserPrompt -chatId $cbChatId -text $foundItem.text
                        } else {
                            Answer-TelegramCallback -callbackId $cbId -text "Prompt này không còn trong hàng đợi."
                        }
                        continue
                    }
                    # Nút 2: Sửa prompt đang chờ đó
                    elseif ($data.StartsWith("q_edit:")) {
                        $targetId = $data.Substring(7).Trim()
                        $foundItem = $global:promptQueue | Where-Object { $_.id -eq $targetId } | Select-Object -First 1
                        if ($foundItem) {
                            $global:waitingForEditPromptId = $targetId
                            Answer-TelegramCallback -callbackId $cbId
                            Send-TelegramMessage -chatId $cbChatId -text "✏️ Bạn hãy nhập nội dung mới bên dưới để thay thế cho prompt:`n""$($foundItem.preview)"""
                        } else {
                            Answer-TelegramCallback -callbackId $cbId -text "Prompt không còn trong hàng đợi."
                        }
                        continue
                    }
                    # Nút 3: Xóa prompt này
                    elseif ($data.StartsWith("q_del:")) {
                        $targetId = $data.Substring(6).Trim()
                        $foundItem = $global:promptQueue | Where-Object { $_.id -eq $targetId } | Select-Object -First 1
                        if ($foundItem) {
                            $global:promptQueue.Remove($foundItem)
                            Answer-TelegramCallback -callbackId $cbId -text "Đã xóa khỏi hàng đợi!"
                            Edit-TelegramMessage -chatId $cbChatId -messageId $cbMsgId -text "🗑️ Đã xóa prompt ""$($foundItem.preview)"" khỏi hàng đợi!`n*(Còn lại trong hàng chờ: $($global:promptQueue.Count) prompt)*"
                        } else {
                            Answer-TelegramCallback -callbackId $cbId -text "Prompt không còn trong hàng đợi."
                        }
                        continue
                    }
                    # Nút 4: Gửi thêm vào hàng chờ
                    elseif ($data -eq "q_add") {
                        Answer-TelegramCallback -callbackId $cbId
                        Send-TelegramMessage -chatId $cbChatId -text "➕ Bạn cứ gõ tin nhắn tiếp theo, bot sẽ tự động xếp vào hàng đợi!"
                        continue
                    }
                    # Nút 5: Chọn prompt nào trong hàng chờ (Khi có 2 cái trở lên)
                    elseif ($data -eq "q_list") {
                        Answer-TelegramCallback -callbackId $cbId
                        if ($global:promptQueue.Count -eq 0) {
                            Edit-TelegramMessage -chatId $cbChatId -messageId $cbMsgId -text "Hàng đợi hiện tại đang trống."
                        } else {
                            $listText = "📋 DANH SÁCH PROMPT ĐANG CHỜ TRONG HÀNG ĐỢI ($($global:promptQueue.Count) prompt):`n`nBấm vào một prompt bên dưới để Sửa, Xóa hoặc Ưu tiên chạy ngay:"
                            $listButtons = @()
                            $idx = 1
                            foreach ($item in $global:promptQueue) {
                                $listButtons += ,@( @{ text = "$idx. $($item.preview)"; callback_data = "q_sel:$($item.id)" } )
                                $idx++
                            }
                            $listButtons += ,@( @{ text = "⬅️ Đóng danh sách"; callback_data = "q_close" } )
                            Edit-TelegramKeyboard -chatId $cbChatId -messageId $cbMsgId -text $listText -buttons $listButtons
                        }
                        continue
                    }
                    # Quản lý 1 prompt được chọn trong danh sách
                    elseif ($data.StartsWith("q_sel:")) {
                        $targetId = $data.Substring(6).Trim()
                        $foundItem = $global:promptQueue | Where-Object { $_.id -eq $targetId } | Select-Object -First 1
                        if ($foundItem) {
                            Answer-TelegramCallback -callbackId $cbId
                            $selText = "⚙️ QUẢN LÝ PROMPT ĐANG CHỜ:`n`n""$($foundItem.text)""`n`n• Thêm lúc: $($foundItem.addedAt)`nChọn thao tác bên dưới:"
                            $selButtons = @(
                                @( @{ text = "⚡ Ưu tiên chạy ngay (Send now)"; callback_data = "q_now:$targetId" } ),
                                @( @{ text = "✏️ Sửa nội dung prompt này"; callback_data = "q_edit:$targetId" } ),
                                @( @{ text = "🗑️ Xóa khỏi hàng đợi"; callback_data = "q_del:$targetId" } ),
                                @( @{ text = "⬅️ Quay lại danh sách"; callback_data = "q_list" } )
                            )
                            Edit-TelegramKeyboard -chatId $cbChatId -messageId $cbMsgId -text $selText -buttons $selButtons
                        } else {
                            Answer-TelegramCallback -callbackId $cbId -text "Prompt không tồn tại."
                        }
                        continue
                    }
                    elseif ($data -eq "q_close") {
                        Answer-TelegramCallback -callbackId $cbId
                        Edit-TelegramMessage -chatId $cbChatId -messageId $cbMsgId -text "Đã đóng danh sách hàng đợi."
                        continue
                    }

                    # --- CÁC NÚT CÀI ĐẶT HỆ THỐNG CŨ ---
                    if ($data -eq "menu:gemini38") {
                        Answer-TelegramCallback -callbackId $cbId
                        $g38Text = "⚡ Chọn mức độ tư duy (Thinking Level) cho Gemini 3.8 Flash:"
                        $checkLow = if ($thinkingLevel -eq "low") { " ✓" } else { "" }
                        $checkMed = if ($thinkingLevel -eq "medium") { " ✓" } else { "" }
                        $checkHigh = if ($thinkingLevel -eq "high") { " ✓" } else { "" }
                        $g38Buttons = @(
                            @( @{ text = "Gemini 3.8 Flash (Low)$checkLow"; callback_data = "setmodel:gemini-3.8-flash:low:Gemini 3.8 Flash (Low)" } ),
                            @( @{ text = "Gemini 3.8 Flash (Medium)$checkMed"; callback_data = "setmodel:gemini-3.8-flash:medium:Gemini 3.8 Flash (Medium)" } ),
                            @( @{ text = "Gemini 3.8 Flash (High)$checkHigh"; callback_data = "setmodel:gemini-3.8-flash:high:Gemini 3.8 Flash (High)" } ),
                            @( @{ text = "⬅️ Quay lại danh sách Model"; callback_data = "menu:main" } )
                        )
                        Edit-TelegramKeyboard -chatId $cbChatId -messageId $cbMsgId -text $g38Text -buttons $g38Buttons
                    }
                    elseif ($data -eq "menu:main") {
                        Answer-TelegramCallback -callbackId $cbId
                        $text = "Model (Hiện tại: $selectedModel):"
                        $buttons = Get-ModelMainMenuButtons
                        Edit-TelegramKeyboard -chatId $cbChatId -messageId $cbMsgId -text $text -buttons $buttons
                    }
                    elseif ($data -eq "menu:usage") {
                        Answer-TelegramCallback -callbackId $cbId
                        $tokenStatus = Format-TokenFooter -tokensThisCall 0
                        $cfg = Get-Content $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
                        $used = if ($cfg.USED_TOKENS) { $cfg.USED_TOKENS } else { 0 }
                        $usageMsg = "📊 VIEW USAGE (THỐNG KÊ TOKEN):`n`n• Token hiện tại: $tokenStatus`n• Đã sử dụng: $used tokens`n• Hạn mức: 1,000,000,000 tokens`n• Model đang dùng: $selectedModel"
                        $backButtons = @(
                            @( @{ text = "⬅️ Quay lại danh sách Model"; callback_data = "menu:main" } )
                        )
                        Edit-TelegramKeyboard -chatId $cbChatId -messageId $cbMsgId -text $usageMsg -buttons $backButtons
                    }
                    elseif ($data.StartsWith("setmodel:")) {
                        $parts = $data.Substring(9).Split(":")
                        $mId = $parts[0]
                        $tLevel = if ($parts.Length -gt 2) { $parts[1] } else { "normal" }
                        $dispName = if ($parts.Length -gt 2) { $parts[2] } else { $parts[1] }

                        $selectedModel = $dispName
                        $modelId = $mId
                        $thinkingLevel = $tLevel

                        $config.SELECTED_MODEL = $dispName
                        $config.MODEL_ID = $mId
                        $config.THINKING_LEVEL = $tLevel
                        $config | ConvertTo-Json | Set-Content $configPath -Encoding UTF8

                        Answer-TelegramCallback -callbackId $cbId -text "Đã chọn: $dispName"
                        Show-ScreenNotification -title "⚙️ Đổi Cấu Hình" -msg "Model: $dispName" -durationSec 3

                        $step2Text = "✅ Đã chọn Model: $dispName`n`n⚙️ Vui lòng chọn cơ chế chấp thuận chạy code trên máy tính:"
                        $step2Buttons = @(
                            @( @{ text = "❓ Chấp nhận code hỏi từng lượt"; callback_data = "setmode:ask" } ),
                            @( @{ text = "⚡ Chấp nhận tất cả"; callback_data = "setmode:auto" } )
                        )
                        Edit-TelegramKeyboard -chatId $cbChatId -messageId $cbMsgId -text $step2Text -buttons $step2Buttons
                    }
                    elseif ($data.StartsWith("setmode:")) {
                        $newMode = $data.Substring(8).Trim()
                        $executionMode = $newMode
                        $config.EXECUTION_MODE = $newMode
                        $config | ConvertTo-Json | Set-Content $configPath -Encoding UTF8

                        Answer-TelegramCallback -callbackId $cbId -text "Đã lưu chế độ: $newMode"

                        $modeDesc = if ($newMode -eq 'ask') { "❓ Hỏi từng lượt (Cần xác nhận trước khi chạy code)" } else { "⚡ Chấp nhận tất cả (Tự động thực thi không cần hỏi)" }
                        Show-ScreenNotification -title "⚙️ Đổi Chế Độ" -msg $modeDesc -durationSec 3

                        $curToken = Format-TokenFooter -tokensThisCall 0
                        $doneText = "🎉 CẤU HÌNH HOÀN TẤT!`n`n• Model AI: $selectedModel`n• Chế độ: $modeDesc`n• Token hiện tại: $curToken`n`nTừ bây giờ bạn có thể chat thoải mái hoặc nhờ AI code/chạy lệnh trên máy tính!"
                        
                        Edit-TelegramMessage -chatId $cbChatId -messageId $cbMsgId -text $doneText
                    }
                    elseif ($data.StartsWith("exec:")) {
                        $cmdId = $data.Substring(5).Trim()
                        if ($pendingCommands.ContainsKey($cmdId)) {
                            $cmdToExec = $pendingCommands[$cmdId]
                            $pendingCommands.Remove($cmdId)
                            Answer-TelegramCallback -callbackId $cbId -text "Đang chạy lệnh trên máy tính..."
                            
                            Show-ScreenNotification -title "⚡ Đang chạy lệnh đã duyệt" -msg $cmdToExec -durationSec 3
                            Edit-TelegramMessage -chatId $cbChatId -messageId $cbMsgId -text "⏳ Đang chạy: $cmdToExec..."

                            try {
                                $runOut = powershell.exe -NoProfile -ExecutionPolicy Bypass -Command $cmdToExec 2>&1 | Out-String
                                if ([string]::IsNullOrWhiteSpace($runOut)) { $runOut = "(Lệnh đã hoàn tất, không có output)" }
                                $tokenEnd = Format-TokenFooter -tokensThisCall 10
                                Edit-TelegramMessage -chatId $cbChatId -messageId $cbMsgId -text "=== [Kết quả: $cmdToExec] ===`n$runOut`n`n$tokenEnd"
                            } catch {
                                Edit-TelegramMessage -chatId $cbChatId -messageId $cbMsgId -text "Lỗi thực thi: $_"
                            }
                            Check-And-Run-Next-In-Queue -chatId $cbChatId
                        } else {
                            Answer-TelegramCallback -callbackId $cbId -text "Lệnh đã hết hạn hoặc đã được thực thi!"
                        }
                    }
                    elseif ($data.StartsWith("cancel:")) {
                        $cmdId = $data.Substring(7).Trim()
                        if ($pendingCommands.ContainsKey($cmdId)) {
                            $pendingCommands.Remove($cmdId)
                        }
                        Answer-TelegramCallback -callbackId $cbId -text "Đã hủy lệnh."
                        Edit-TelegramMessage -chatId $cbChatId -messageId $cbMsgId -text "❌ Bạn đã từ chối thực thi lệnh này."
                        Check-And-Run-Next-In-Queue -chatId $cbChatId
                    }
                    continue
                }

                # ========================================================
                # B. XỬ LÝ TIN NHẮN (MESSAGE)
                # ========================================================
                if (-not $item.message) {
                    continue
                }

                $msg = $item.message
                $chatId = [int64]$msg.chat.id

                if ($chatId -ne $allowedChatId) {
                    Send-TelegramMessage -chatId $chatId -text "Xin lỗi, bạn không có quyền điều khiển máy tính này!"
                    continue
                }

                # --- XỬ LÝ ẢNH (VISION) ---
                if ($msg.photo) {
                    $largestPhoto = $msg.photo | Sort-Object file_size -Descending | Select-Object -First 1
                    $fileId = $largestPhoto.file_id
                    $userCaption = if ($msg.caption) { $msg.caption.Trim() } else { "" }

                    Show-ScreenNotification -title "📷 Telegram: Ảnh Mới" -msg (if ($userCaption) { $userCaption } else { "Đã nhận 1 bức ảnh" }) -durationSec 4

                    $loadingMsgId = Send-TelegramMessage -chatId $chatId -text "Đang phân tích hình ảnh qua Gemini Multimodal Vision..."

                    try {
                        $getFileUrl = "https://api.telegram.org/bot$botToken/getFile?file_id=$fileId"
                        $fileInfo = Invoke-RestMethod -Uri $getFileUrl -Method Get
                        if ($fileInfo.ok -and $fileInfo.result.file_path) {
                            $filePath = $fileInfo.result.file_path
                            $downloadUrl = "https://api.telegram.org/file/bot$botToken/$filePath"
                            $tempImg = Join-Path $env:TEMP "tg_img_$([System.Guid]::NewGuid().ToString('N')).jpg"

                            & curl.exe -s -o $tempImg $downloadUrl

                            $imgBytes = [System.IO.File]::ReadAllBytes($tempImg)
                            $base64 = [System.Convert]::ToBase64String($imgBytes)
                            Remove-Item $tempImg -Force -ErrorAction SilentlyContinue

                            $visionAnswer = Ask-GeminiVision -userText $userCaption -base64Image $base64 -mimeType "image/jpeg"

                            if ($loadingMsgId) {
                                Edit-TelegramMessage -chatId $chatId -messageId $loadingMsgId -text $visionAnswer
                            } else {
                                Send-TelegramMessage -chatId $chatId -text $visionAnswer
                            }
                        }
                    } catch {
                        if ($loadingMsgId) {
                            Edit-TelegramMessage -chatId $chatId -messageId $loadingMsgId -text "Lỗi tải và xử lý ảnh: $_"
                        }
                    }
                    continue
                }

                # --- XỬ LÝ TIN NHẮN VĂN BẢN ---
                if (-not $msg.text) {
                    continue
                }

                $text = $msg.text.Trim()
                Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Nhập: $text" -ForegroundColor White

                # NHẢY LÊN MÀN HÌNH MÁY TÍNH & CLIPBOARD
                Show-ScreenNotification -title "📱 Telegram: Trung Quân" -msg $text -durationSec 4
                try { Set-Clipboard -Value $text } catch {}

                # 1. NẾU ĐANG CHỜ SỬA NỘI DUNG CỦA MỘT PROMPT TRONG HÀNG ĐỢI
                if (-not [string]::IsNullOrWhiteSpace($global:waitingForEditPromptId)) {
                    $targetId = $global:waitingForEditPromptId
                    $global:waitingForEditPromptId = ""
                    $foundItem = $global:promptQueue | Where-Object { $_.id -eq $targetId } | Select-Object -First 1
                    if ($foundItem) {
                        $foundItem.text = $text
                        $newPrev = if ($text.Length -gt 35) { $text.Substring(0, 35) + "..." } else { $text }
                        $foundItem.preview = $newPrev
                        Send-TelegramMessage -chatId $chatId -text "✅ Đã sửa prompt thành:`n""$newPrev""`ntrong hàng đợi!"
                    } else {
                        Send-TelegramMessage -chatId $chatId -text "Prompt cần sửa không còn trong hàng đợi."
                    }
                    continue
                }

                # 2. XỬ LÝ LỆNH ĐỒNG BỘ TRỰC TIẾP
                if ($text -match '(?i)(kết nối.*đoạn chat|kết nối.*code|đồng bộ|dong bo|/connect|/sync)') {
                    Initialize-SyncBridge -chatId $chatId
                    continue
                }
                elseif ($text -match '(?i)(ngắt kết nối|ngat ket noi|hủy kết nối|disconnect|/disconnect)') {
                    Disconnect-SyncBridge -chatId $chatId
                    continue
                }

                # 3. NẾU MÁY TÍNH ĐANG BẬN CHẠY LỆNH HOẶC CÓ JOB NỀN -> ĐƯA VÀO HÀNG ĐỢI (PROMPT QUEUE)
                if ($global:isExecuting -eq $true -or $global:currentJob -ne $null) {
                    $qId = [System.Guid]::NewGuid().ToString('N').Substring(0, 6)
                    $preview = if ($text.Length -gt 35) { $text.Substring(0, 35) + "..." } else { $text }

                    $qItem = [PSCustomObject]@{
                        id = $qId
                        text = $text
                        addedAt = (Get-Date -Format "HH:mm:ss")
                        preview = $preview
                    }
                    $global:promptQueue.Add($qItem)

                    $currentNotice = if ($global:currentExecutingPrompt) { "(⚡ Đang chạy lệnh từ $global:currentExecutingPrompt)" } else { "(⚡ Đang chạy lệnh máy tính)" }
                    $queueNotice = "⏳ Đã thêm prompt: ""$preview"" vào hàng đợi, xin bạn chờ một lát!`n`n$currentNotice"
                    $queueButtons = Get-QueueButtons -targetId $qId

                    Send-TelegramKeyboard -chatId $chatId -text $queueNotice -buttons $queueButtons
                    continue
                }

                # 4. CÁC LỆNH HỆ THỐNG CƠ BẢN (KHI ĐANG RẢNH)
                if ($text -eq "/start" -or $text -eq "/help") {
                    $helpLines = @(
                        "=== Telegram Remote Coder v8.4 ===",
                        "",
                        "- Nói 'kết nối đoạn chat' : Đồng bộ trực tiếp với box chat máy tính",
                        "- /clear : Xóa sạch bộ nhớ ngữ cảnh",
                        "- /stop : Dừng lệnh đang chạy và xóa sạch hàng đợi",
                        "- /model : Menu chọn Model & chế độ duyệt lệnh",
                        "- /usage : Kiểm tra Token và hạn mức sử dụng",
                        "- /cmd <câu_lệnh> : Chạy lệnh Terminal trực tiếp",
                        "",
                        "Model: $selectedModel | Chế độ: $executionMode",
                        "Thư mục gốc: $projectsRootDir",
                        "Token: $(Format-TokenFooter -tokensThisCall 0)"
                    )
                    Send-TelegramMessage -chatId $chatId -text ($helpLines -join "`n")
                    continue
                }
                elseif ($text -match '^(?i)(/model|model|/settings|chọn model)$') {
                    Show-ModelMenu -chatId $chatId
                    continue
                }
                elseif ($text -eq "/usage" -or $text -eq "/pro" -or $text -eq "/checkkey") {
                    $tokenStatus = Format-TokenFooter -tokensThisCall 0
                    $cfg = Get-Content $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
                    $used = if ($cfg.USED_TOKENS) { $cfg.USED_TOKENS } else { 0 }
                    $msgUsage = "📊 VIEW USAGE:`n`n• Token hiện tại: $tokenStatus`n• Đã sử dụng: $used tokens`n• Model: $selectedModel`n• Chế độ: $executionMode`n• Thư mục gốc: $projectsRootDir"
                    Send-TelegramMessage -chatId $chatId -text $msgUsage
                    continue
                }
                elseif ($text -eq "/backups") {
                    $allBaks = Get-ChildItem -Path $backupDir -Filter "*.ps1" | Sort-Object LastWriteTime -Descending
                    if ($allBaks) {
                        $bakList = $allBaks | ForEach-Object { "- $($_.Name) ($([math]::Round($_.Length / 1KB, 1)) KB) - $($_.LastWriteTime.ToString('yyyy-MM-dd HH:mm'))" }
                        Send-TelegramMessage -chatId $chatId -text ("DANH SÁCH BẢN SAO LƯU:`n`n" + ($bakList -join "`n"))
                    } else {
                        Send-TelegramMessage -chatId $chatId -text "Chưa có bản backup nào."
                    }
                    continue
                }
                elseif ($text -eq "/rollback") {
                    Rollback-ToPreviousBackup -chatId $chatId
                    continue
                }
                elseif ($text -eq "/restart") {
                    Send-TelegramMessage -chatId $chatId -text "Đang khởi động lại bot..."
                    Start-Sleep -Seconds 1
                    exit 0
                }
                elseif ($text.StartsWith("/setkey")) {
                    $newKey = $text.Substring(7).Trim()
                    if ([string]::IsNullOrWhiteSpace($newKey)) {
                        Send-TelegramMessage -chatId $chatId -text "Cú pháp: /setkey <GEMINI_API_KEY>"
                    } else {
                        $geminiApiKey = $newKey
                        $config.GEMINI_API_KEY = $newKey
                        $config | ConvertTo-Json | Set-Content $configPath -Encoding UTF8
                        Send-TelegramMessage -chatId $chatId -text "Đã lưu API Key thành công!"
                        Show-ModelMenu -chatId $chatId
                    }
                    continue
                }
                elseif ($text -eq "/pwd") {
                    $curr = (Get-Location).Path
                    Send-TelegramMessage -chatId $chatId -text "Thư mục hiện tại:`n$curr"
                    continue
                }
                elseif ($text.StartsWith("/cd")) {
                    $target = $text.Substring(3).Trim()
                    if ([string]::IsNullOrWhiteSpace($target)) {
                        Send-TelegramMessage -chatId $chatId -text "Cú pháp: /cd [đường_dẫn]"
                    } else {
                        try {
                            Set-Location $target -ErrorAction Stop
                            $curr = (Get-Location).Path
                            Send-TelegramMessage -chatId $chatId -text "Đã chuyển sang: $curr"
                        } catch {
                            Send-TelegramMessage -chatId $chatId -text "Không tìm thấy thư mục: $target"
                        }
                    }
                    continue
                }
                elseif ($text -eq "/ls" -or $text -eq "/dir") {
                    try {
                        $items = Get-ChildItem -ErrorAction SilentlyContinue | ForEach-Object {
                            if ($_.PSIsContainer) { "[DIR]  " + $_.Name } else { "[FILE] " + $_.Name + " (" + [math]::Round($_.Length / 1KB, 1) + " KB)" }
                        }
                        $result = if ($items) { $items -join "`n" } else { "(Thư mục trống)" }
                        Send-TelegramMessage -chatId $chatId -text $result
                    } catch {
                        Send-TelegramMessage -chatId $chatId -text "Lỗi: $_"
                    }
                    continue
                }
                elseif ($text.StartsWith("/read")) {
                    $fileName = $text.Substring(5).Trim()
                    if ([string]::IsNullOrWhiteSpace($fileName)) {
                        Send-TelegramMessage -chatId $chatId -text "Cú pháp: /read [tên_file]"
                    } else {
                        try {
                            if (Test-Path $fileName) {
                                $ext = [System.IO.Path]::GetExtension($fileName).ToLower()
                                if ($ext -in @(".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp")) {
                                    Send-TelegramPhoto -chatId $chatId -imagePath (Resolve-Path $fileName).Path -caption "Ảnh: $fileName"
                                } else {
                                    $content = Get-Content -Path $fileName -Raw -Encoding UTF8
                                    Send-TelegramMessage -chatId $chatId -text $content
                                }
                            } else {
                                Send-TelegramMessage -chatId $chatId -text "File không tồn tại: $fileName"
                            }
                        } catch {
                            Send-TelegramMessage -chatId $chatId -text "Lỗi đọc file: $_"
                        }
                    }
                    continue
                }

                # 5. NẾU RẢNH RỖI (IDLE) -> THỰC THI NGAY PROMPT
                Execute-UserPrompt -chatId $chatId -text $text
            }
        }
    }
    catch {
        Write-Host "Lỗi kết nối Telegram: $_" -ForegroundColor DarkGray
        Start-Sleep -Seconds 2
    }
}
