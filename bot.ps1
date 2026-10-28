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
$projectsRootDir = if ($config.PROJECTS_ROOT_DIR) { $config.PROJECTS_ROOT_DIR.ToString().Trim() } else { "$env:USERPROFILE\.gemini\antigravity\scratch\model" }
$currentProject = if ($config.CURRENT_PROJECT) { $config.CURRENT_PROJECT.ToString().Trim() } else { "telegram-remote-coder" }
$currentProjectPath = if ($config.CURRENT_PROJECT_PATH) { $config.CURRENT_PROJECT_PATH.ToString().Trim() } else { $rootDir }
$global:waitingForNewProjectName = $false
$global:tempNewProjName = ""
$global:waitingForSuperAdminPassword = $false
$global:isSuperAdmin = $false
$global:projNewClicks = [System.Collections.Generic.List[DateTime]]::new()

# --- QUẢN LÝ HÀNG ĐỢI PROMPT & TRẠNG THÁI THỰC THI ---
$global:isExecuting = $false
$global:currentExecutingPrompt = ""
$global:currentJob = $null
$global:currentJobPrompt = ""
$global:promptQueue = [System.Collections.Generic.List[PSObject]]::new()
$global:waitingForEditPromptId = ""
$pendingCommands = @{}
$global:pendingMediaGroups = @{}

# Gỡ Webhook Cloud nếu có để máy tính tiếp quản Long Polling
try {
    Invoke-RestMethod -Uri "https://api.telegram.org/bot$botToken/deleteWebhook" -Method Get -TimeoutSec 5 | Out-Null
} catch {}

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

function Convert-MdToTgHtml {
    param([string]$text)
    if ([string]::IsNullOrWhiteSpace($text)) { return "" }
    
    $codeBlocks = New-Object System.Collections.Generic.List[string]
    $codeBlockPattern = '(?s)```([a-zA-Z0-9_\-\+]*)\r?\n([\s\S]*?)```'
    $text = [regex]::Replace($text, $codeBlockPattern, [System.Text.RegularExpressions.MatchEvaluator]{
        param($m)
        $lang = $m.Groups[1].Value.Trim()
        if (-not $lang) { $lang = "powershell" }
        $c = [System.Net.WebUtility]::HtmlEncode($m.Groups[2].Value)
        $idx = $codeBlocks.Count
        $codeBlocks.Add("<pre><code class=""language-$lang"">$c</code></pre>")
        return "___TG_CODE_BLOCK_${idx}___"
    })

    $inlineCodes = New-Object System.Collections.Generic.List[string]
    $inlinePattern = '`([^`\r\n]+)`'
    $text = [regex]::Replace($text, $inlinePattern, [System.Text.RegularExpressions.MatchEvaluator]{
        param($m)
        $c = [System.Net.WebUtility]::HtmlEncode($m.Groups[1].Value)
        $idx = $inlineCodes.Count
        $inlineCodes.Add("<code>$c</code>")
        return "___TG_INLINE_CODE_${idx}___"
    })

    $text = [System.Net.WebUtility]::HtmlEncode($text)
    $text = [regex]::Replace($text, '\*\*([^\*\r\n]+)\*\*', '<b>$1</b>')
    $text = [regex]::Replace($text, '(?<!\w)\*([^\*\r\n]+)\*(?!\w)', '<i>$1</i>')
    $text = [regex]::Replace($text, '(?m)^&gt;\s*([^\r\n]+)', '<blockquote>$1</blockquote>')

    for ($i = 0; $i -lt $codeBlocks.Count; $i++) {
        $text = $text.Replace("___TG_CODE_BLOCK_${i}___", $codeBlocks[$i])
    }
    for ($i = 0; $i -lt $inlineCodes.Count; $i++) {
        $text = $text.Replace("___TG_INLINE_CODE_${i}___", $inlineCodes[$i])
    }

    return $text
}

function Split-TelegramText {
    param([string]$text, [int]$maxLen = 3500)
    $chunks = [System.Collections.Generic.List[string]]::new()
    if ([string]::IsNullOrWhiteSpace($text)) { return ,@() }

    while ($text.Length -gt $maxLen) {
        $splitIdx = $text.LastIndexOf("`n`n", $maxLen)
        if ($splitIdx -lt ($maxLen / 2)) {
            $splitIdx = $text.LastIndexOf("`n", $maxLen)
        }
        if ($splitIdx -lt ($maxLen / 2)) {
            $splitIdx = $text.LastIndexOf(". ", $maxLen)
        }
        if ($splitIdx -lt ($maxLen / 2)) {
            $splitIdx = $maxLen
        } else {
            $splitIdx += 1
        }

        $chunk = $text.Substring(0, $splitIdx).Trim()
        if ($chunk) { $chunks.Add($chunk) }
        $text = $text.Substring($splitIdx).Trim()
    }
    if ($text) { $chunks.Add($text) }
    return ,($chunks.ToArray())
}

function Send-TelegramMessage {
    param(
        [int64]$chatId,
        [string]$text,
        [string]$parseMode = "HTML",
        [int]$messageThreadId = 0
    )
    if ([string]::IsNullOrWhiteSpace($text)) { return $null }

    $chunks = @(Split-TelegramText -text $text -maxLen 3500)
    $lastMsgId = $null
    $totalParts = $chunks.Count

    for ($i = 0; $i -lt $totalParts; $i++) {
        $chunkText = $chunks[$i]
        if ($totalParts -gt 1) {
            $chunkText = "<b>[Phần $($i + 1)/$totalParts]</b>`n" + $chunkText
        }

        $url = "https://api.telegram.org/bot$botToken/sendMessage"
        $bodyObj = @{
            chat_id = $chatId
            text = $chunkText
            disable_web_page_preview = $true
        }
        if ($parseMode) { $bodyObj["parse_mode"] = $parseMode }
        if ($messageThreadId -gt 0) { $bodyObj["message_thread_id"] = $messageThreadId }
        $jsonBody = $bodyObj | ConvertTo-Json -Compress

        try {
            $res = Invoke-RestMethod -Uri $url -Method Post -ContentType "application/json; charset=utf-8" -Body ([System.Text.Encoding]::UTF8.GetBytes($jsonBody)) -TimeoutSec 15
            if ($res.ok -and $res.result) { $lastMsgId = $res.result.message_id }
        } catch {
            if ($parseMode) {
                try {
                    $bodyObj.Remove("parse_mode")
                    $plainBody = $bodyObj | ConvertTo-Json -Compress
                    $res = Invoke-RestMethod -Uri $url -Method Post -ContentType "application/json; charset=utf-8" -Body ([System.Text.Encoding]::UTF8.GetBytes($plainBody)) -TimeoutSec 10
                    if ($res.ok -and $res.result) { $lastMsgId = $res.result.message_id }
                } catch {}
            }
            Write-Host "Lỗi gửi tin nhắn: $_" -ForegroundColor Red
        }

        if ($totalParts -gt 1 -and $i -lt ($totalParts - 1)) {
            Start-Sleep -Milliseconds 150
        }
    }
    return $lastMsgId
}

function Edit-TelegramMessage {
    param(
        [int64]$chatId,
        [int]$messageId,
        [string]$text,
        [string]$parseMode = "HTML",
        [int]$messageThreadId = 0
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
    if ($parseMode) { $bodyObj["parse_mode"] = $parseMode }
    $jsonBody = $bodyObj | ConvertTo-Json -Compress
    try {
        $res = Invoke-RestMethod -Uri $url -Method Post -ContentType "application/json; charset=utf-8" -Body ([System.Text.Encoding]::UTF8.GetBytes($jsonBody)) -TimeoutSec 15
        return $res.ok
    } catch {
        if ($parseMode) {
            try {
                $bodyObj.Remove("parse_mode")
                $plainBody = $bodyObj | ConvertTo-Json -Compress
                $res = Invoke-RestMethod -Uri $url -Method Post -ContentType "application/json; charset=utf-8" -Body ([System.Text.Encoding]::UTF8.GetBytes($plainBody)) -TimeoutSec 10
                return $res.ok
            } catch {}
        }
        Send-TelegramMessage -chatId $chatId -text $text -parseMode "" | Out-Null
    }
    return $false
}

function Delete-TelegramMessage {
    param(
        [int64]$chatId,
        [int]$messageId
    )
    if (-not $messageId) { return }
    $url = "https://api.telegram.org/bot$botToken/deleteMessage"
    $bodyObj = @{ chat_id = $chatId; message_id = $messageId }
    $jsonBody = $bodyObj | ConvertTo-Json -Compress
    try {
        Invoke-RestMethod -Uri $url -Method Post -ContentType "application/json; charset=utf-8" -Body ([System.Text.Encoding]::UTF8.GetBytes($jsonBody)) -TimeoutSec 5 | Out-Null
    } catch {}
}

function Send-TelegramKeyboard {
    param(
        [int64]$chatId,
        [string]$text,
        [array]$buttons,
        [string]$parseMode = "HTML",
        [int]$messageThreadId = 0
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
    if ($parseMode) { $bodyObj["parse_mode"] = $parseMode }
    if ($messageThreadId -gt 0) { $bodyObj["message_thread_id"] = $messageThreadId }
    $jsonBody = $bodyObj | ConvertTo-Json -Depth 6 -Compress
    try {
        $res = Invoke-RestMethod -Uri $url -Method Post -ContentType "application/json; charset=utf-8" -Body ([System.Text.Encoding]::UTF8.GetBytes($jsonBody)) -TimeoutSec 15
        if ($res.ok -and $res.result) {
            return $res.result.message_id
        }
    } catch {
        if ($parseMode) {
            try {
                $bodyObj.Remove("parse_mode")
                $plainBody = $bodyObj | ConvertTo-Json -Depth 6 -Compress
                $res = Invoke-RestMethod -Uri $url -Method Post -ContentType "application/json; charset=utf-8" -Body ([System.Text.Encoding]::UTF8.GetBytes($plainBody)) -TimeoutSec 10
                if ($res.ok -and $res.result) { return $res.result.message_id }
            } catch {}
        }
        Write-Host "Lỗi gửi bàn phím: $_" -ForegroundColor Red
    }
    return $null
}

function Edit-TelegramKeyboard {
    param(
        [int64]$chatId,
        [int]$messageId,
        [string]$text,
        [array]$buttons = $null,
        [string]$parseMode = "HTML",
        [int]$messageThreadId = 0
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
    if ($parseMode) { $bodyObj["parse_mode"] = $parseMode }
    if ($messageThreadId -gt 0) { $bodyObj["message_thread_id"] = $messageThreadId }
    $jsonBody = $bodyObj | ConvertTo-Json -Depth 6 -Compress
    try {
        Invoke-RestMethod -Uri $url -Method Post -ContentType "application/json; charset=utf-8" -Body ([System.Text.Encoding]::UTF8.GetBytes($jsonBody)) -TimeoutSec 15 | Out-Null
    } catch {
        if ($parseMode) {
            try {
                $bodyObj.Remove("parse_mode")
                $plainBody = $bodyObj | ConvertTo-Json -Depth 6 -Compress
                Invoke-RestMethod -Uri $url -Method Post -ContentType "application/json; charset=utf-8" -Body ([System.Text.Encoding]::UTF8.GetBytes($plainBody)) -TimeoutSec 10 | Out-Null
            } catch {}
        }
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
    $randNum = (Get-Random -Minimum 1000 -Maximum 9999).ToString()
    $randomCode = "GM_${randNum}_Mthu"
    
    $bridgeData = @{
        syncCode = $randomCode
        status = "PENDING"
        connectedAt = ""
        active = $false
        conversationId = "ecedb8d9-583d-4320-b8ee-9602abb6b87f"
        messages = @()
    }
    $bridgeData | ConvertTo-Json -Depth 5 | Set-Content $syncBridgePath -Encoding UTF8

    Show-ScreenNotification -title "🔗 Yêu Cầu Kết Nối Đồng Bộ" -msg "Mã: $randomCode" -durationSec 5

    $msg = @(
        "🔗 MÃ KẾT NỐI ĐỒNG BỘ: $randomCode",
        "",
        "Bạn hãy copy mã trên và dán vào ô chat Antigravity trên máy tính để kết nối!",
        "",
        "✨ Định dạng mã: GM_<mã số>_Mthu (hỗ trợ cả chữ thường gm_..._mthu).",
        "Khi đã kết nối, toàn bộ lệnh và code bạn gửi từ điện thoại sẽ được chuyển thẳng sang máy tính và lưu vào đúng thư mục dự án!",
        "(Để ngắt kết nối: chỉ cần gõ đúng từ 'ngắt kết nối' hoặc /disconnect)"
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
                $langServer = if (Test-Path "$env:LOCALAPPDATA\Programs\antigravity\resources\bin\language_server.exe") { "$env:LOCALAPPDATA\Programs\antigravity\resources\bin\language_server.exe" } else { "C:\Users\Administrator\AppData\Local\Programs\antigravity\resources\bin\language_server.exe" }
                if (Test-Path $langServer) {
                    Start-Process -FilePath $langServer -ArgumentList "agentapi", "send-message", $bridge.conversationId, "[Điện thoại gửi]: $text" -WindowStyle Hidden
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

function Get-ProjectMenuButtons {
    $buttons = @()
    $buttons += ,@( @{ text = "✨ Tạo Project Mới (Ctrl+Shift+N)"; callback_data = "proj:new" } )
    $buttons += ,@( @{ text = "📂 Chọn Project Đã Có"; callback_data = "proj:list" } )
    if (-not [string]::IsNullOrWhiteSpace($currentProject)) {
        $buttons += ,@( @{ text = "▶️ Tiếp Tục: $currentProject"; callback_data = "proj:continue" } )
    }
    $buttons += ,@( @{ text = "⚙️ Chọn Model Trực Tiếp ❯"; callback_data = "menu:main" } )
    return $buttons
}

function Show-ProjectMenu {
    param([int64]$chatId)
    $text = "📁 BƯỚC 1: QUẢN LÝ DỰ ÁN (PROJECT)`n`n• Project hiện tại: $currentProject`n• Thư mục gốc: $projectsRootDir`n`nBạn muốn tạo mới hay mở project nào để làm việc?"
    $buttons = Get-ProjectMenuButtons
    Send-TelegramKeyboard -chatId $chatId -text $text -buttons $buttons
}

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
        @( @{ text = "⏲ View Usage >"; callback_data = "menu:usage" } ),
        @( @{ text = "📁 Đổi Project (Quay lại Bước 1)"; callback_data = "proj:menu" } )
    )
}

function Show-ModelMenu {
    param([int64]$chatId)
    $text = "BƯỚC 2: CHỌN MODEL CHO PROJECT ($currentProject):`nHiện tại: $selectedModel"
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

    $postBytes = [System.Text.Encoding]::UTF8.GetBytes(($payload | ConvertTo-Json -Depth 6 -Compress))
    $modelsToTry = @("gemini-2.5-flash", "gemini-flash-latest", "gemini-flash-lite-latest")
    $tokensUsedThisCall = 25
    $responseText = ""

    foreach ($m in $modelsToTry) {
        $url = "https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=$geminiApiKey"
        try {
            $parsed = Invoke-RestMethod -Uri $url -Method Post -ContentType "application/json; charset=utf-8" -Body $postBytes -TimeoutSec 25
            if ($parsed.candidates -and $parsed.candidates[0].content.parts) {
                $responseText = $parsed.candidates[0].content.parts[0].text
                if ($parsed.usageMetadata -and $parsed.usageMetadata.totalTokenCount) {
                    $tokensUsedThisCall = [int]$parsed.usageMetadata.totalTokenCount
                }
                break
            }
        } catch {}
    }

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

    $postBytes = [System.Text.Encoding]::UTF8.GetBytes(($payload | ConvertTo-Json -Depth 6 -Compress))
    $modelsToTry = @("gemini-2.5-flash", "gemini-flash-latest", "gemini-flash-lite-latest")
    $tokensUsedThisCall = 40
    $responseText = ""

    foreach ($m in $modelsToTry) {
        $url = "https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=$geminiApiKey"
        try {
            $parsed = Invoke-RestMethod -Uri $url -Method Post -ContentType "application/json; charset=utf-8" -Body $postBytes -TimeoutSec 25
            if ($parsed.candidates -and $parsed.candidates[0].content.parts) {
                $responseText = $parsed.candidates[0].content.parts[0].text
                if ($parsed.usageMetadata -and $parsed.usageMetadata.totalTokenCount) {
                    $tokensUsedThisCall = [int]$parsed.usageMetadata.totalTokenCount
                }
                break
            }
        } catch {}
    }

    if ([string]::IsNullOrWhiteSpace($responseText)) {
        return "AI Vision đang tạm thời bận, bạn hãy gửi lại ảnh nhé!"
    }

    $tokenFooter = Format-TokenFooter -tokensThisCall $tokensUsedThisCall
    return "$responseText`n`n$tokenFooter"
}

# --- HÀM THỰC THI CHÍNH CỦA PROMPT (EXECUTE ENGINE) ---

function Ask-GeminiVisionMulti {
    param(
        [string]$userText,
        [string[]]$imagePaths
    )
    if ([string]::IsNullOrWhiteSpace($userText)) {
        $userText = "Hãy quan sát toàn bộ các bức ảnh này và phân tích chi tiết giúp tôi. Nếu có code hoặc thông báo lỗi, hãy đọc nội dung và hướng dẫn xử lý."
    }

    $sysPrompt = "Bạn là trợ lý lập trình AI có thị giác siêu việt (Multimodal Vision) điều khiển máy tính từ xa. Hãy quan sát kỹ lưỡng tất cả các bức ảnh được gửi và trả lời lời khuyên/giải pháp bằng Tiếng Việt có dấu rõ ràng, chuẩn xác."

    $partsList = [System.Collections.Generic.List[Object]]::new()
    $partsList.Add(@{ text = $userText })

    foreach ($p in $imagePaths) {
        if (Test-Path $p) {
            try {
                $imgBytes = [System.IO.File]::ReadAllBytes($p)
                $b64 = [System.Convert]::ToBase64String($imgBytes)
                $ext = [System.IO.Path]::GetExtension($p).ToLower()
                $mime = switch ($ext) {
                    ".png"  { "image/png" }
                    ".webp" { "image/webp" }
                    ".gif"  { "image/gif" }
                    default { "image/jpeg" }
                }
                $partsList.Add(@{
                    inlineData = @{
                        mimeType = $mime
                        data = $b64
                    }
                })
            } catch {}
        }
    }

    $payload = @{
        systemInstruction = @{
            parts = @(@{ text = $sysPrompt })
        }
        contents = @(
            @{
                role = "user"
                parts = $partsList
            }
        )
    }

    $postBytes = [System.Text.Encoding]::UTF8.GetBytes(($payload | ConvertTo-Json -Depth 6 -Compress))
    $modelsToTry = @("gemini-2.5-flash", "gemini-flash-latest", "gemini-flash-lite-latest")
    $tokensUsedThisCall = 40 * [math]::Max(1, $imagePaths.Count)
    $responseText = ""

    foreach ($m in $modelsToTry) {
        $url = "https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=$geminiApiKey"
        try {
            $parsed = Invoke-RestMethod -Uri $url -Method Post -ContentType "application/json; charset=utf-8" -Body $postBytes -TimeoutSec 35
            if ($parsed.candidates -and $parsed.candidates[0].content.parts) {
                $responseText = $parsed.candidates[0].content.parts[0].text
                if ($parsed.usageMetadata -and $parsed.usageMetadata.totalTokenCount) {
                    $tokensUsedThisCall = [int]$parsed.usageMetadata.totalTokenCount
                }
                break
            }
        } catch {}
    }

    if ([string]::IsNullOrWhiteSpace($responseText)) {
        return "AI Vision đang tạm thời bận, bạn hãy thử gửi lại ảnh nhé!"
    }

    $tokenFooter = Format-TokenFooter -tokensThisCall $tokensUsedThisCall
    return "$responseText`n`n$tokenFooter"
}

# --- XỬ LÝ ALBUM ĐA ẢNH (MEDIA GROUP PROCESSOR) ---
function Process-PendingMediaGroups {
    if (-not $global:pendingMediaGroups -or $global:pendingMediaGroups.Count -eq 0) { return }

    $now = [DateTime]::Now
    $readyKeys = @()
    foreach ($key in @($global:pendingMediaGroups.Keys)) {
        $grp = $global:pendingMediaGroups[$key]
        if (($now - $grp.lastUpdated).TotalMilliseconds -ge 700) {
            $readyKeys += $key
        }
    }

    foreach ($key in $readyKeys) {
        $grp = $global:pendingMediaGroups[$key]
        $global:pendingMediaGroups.Remove($key)

        $chatId = $grp.chatId
        $total = $grp.items.Count
        $userCaption = if (-not [string]::IsNullOrWhiteSpace($grp.caption)) { $grp.caption.Trim() } else { "Hãy quan sát tất cả $total bức ảnh này và phân tích, hỗ trợ tôi." }
        $safeCaption = [System.Net.WebUtility]::HtmlEncode($userCaption)

        # Cập nhật trạng thái đang tải ảnh
        Edit-TelegramMessage -chatId $chatId -messageId $grp.statusMsgId -text "📥 <b>[ĐÃ NHẬN ĐỦ $total ẢNH - ĐANG TẢI VỀ MÁY TÍNH...]</b>`n<blockquote><i>`"$safeCaption`"</i></blockquote>" | Out-Null

        # Tải tất cả các ảnh về thư mục uploads
        $uploadDir = Join-Path $currentProjectPath "uploads"
        if (-not (Test-Path $uploadDir)) { New-Item -ItemType Directory -Path $uploadDir -Force | Out-Null }

        $savedImgPaths = @()
        $idx = 1
        $stamp = (Get-Date -Format 'yyyyMMdd_HHmmss')
        $downloadItems = @()
        foreach ($item in $grp.items) {
            $fId = $item.fileId
            $ext = if ($item.ext) { $item.ext } else { ".jpg" }
            $targetFile = Join-Path $uploadDir "album_${key}_${idx}_${stamp}${ext}"
            try {
                $getFileUrl = "https://api.telegram.org/bot$botToken/getFile?file_id=$fId"
                $fileInfo = Invoke-RestMethod -Uri $getFileUrl -Method Get
                if ($fileInfo.ok -and $fileInfo.result.file_path) {
                    $dlUrl = "https://api.telegram.org/file/bot$botToken/$($fileInfo.result.file_path)"
                    $downloadItems += [PSCustomObject]@{
                        url = $dlUrl
                        targetPath = $targetFile
                    }
                }
            } catch {}
            $idx++
        }

        # Tải toàn bộ ảnh cùng lúc qua cơ chế song song (curl -Z HTTP/2 Multiplexing)
        if ($downloadItems.Count -gt 0) {
            $curlArgs = @("-Z", "-s")
            foreach ($di in $downloadItems) {
                $curlArgs += @("-o", $di.targetPath, $di.url)
            }
            & curl.exe @curlArgs
            foreach ($di in $downloadItems) {
                if (Test-Path $di.targetPath) {
                    $savedImgPaths += $di.targetPath
                }
            }
        }

        if ($savedImgPaths.Count -eq 0) {
            Edit-TelegramMessage -chatId $chatId -messageId $grp.statusMsgId -text "❌ Không thể tải các ảnh trong album về máy tính!"
            continue
        }

        # Nếu đang kết nối đồng bộ Antigravity PC:
        if (Check-SyncBridgeStatus) {
            $pathsList = @()
            for ($k = 0; $k -lt $savedImgPaths.Count; $k++) {
                $pathsList += "$($k + 1). $($savedImgPaths[$k])"
            }
            $pathsStr = $pathsList -join "`n"
            $fullPrompt = "[Điện thoại gửi album $($savedImgPaths.Count) ảnh]: $userCaption`nDanh sách file ảnh trên máy tính:`n$pathsStr"

            # Thiết lập Stopwatch Prompt Reading
            $global:promptReadingStart = [DateTime]::Now
            $global:promptReadingPreview = "[Album $($savedImgPaths.Count) ảnh] $userCaption"
            $global:lastReadingSec = 1
            $global:promptReadingMsgId = $grp.statusMsgId

            Edit-TelegramMessage -chatId $chatId -messageId $grp.statusMsgId -text "📷 <b>[ĐÃ NHẬN ĐỦ $($savedImgPaths.Count) ẢNH - ĐANG PHÂN TÍCH (1s)...]</b>`n<blockquote expandable><i>`"$safeCaption`"</i></blockquote>" | Out-Null

            Append-SyncMessage -sender "phone" -text $fullPrompt
            Send-ToAntigravityChat -text $fullPrompt
            Show-ScreenNotification -title "📷 Telegram: Album $($savedImgPaths.Count) Ảnh" -msg "$userCaption" -durationSec 4

            if (Test-Path $syncBridgePath) {
                try {
                    $br = Get-Content $syncBridgePath -Raw -Encoding UTF8 | ConvertFrom-Json
                    $br | Add-Member -NotePropertyName "promptReadingMsgId" -NotePropertyValue $grp.statusMsgId -Force
                    $br | Add-Member -NotePropertyName "promptReadingStart" -NotePropertyValue ([DateTime]::Now.ToString("o")) -Force
                    $br | Add-Member -NotePropertyName "promptReadingPreview" -NotePropertyValue "[Album $($savedImgPaths.Count) ảnh] $userCaption" -Force
                    $br | ConvertTo-Json -Depth 5 | Set-Content $syncBridgePath -Encoding UTF8
                } catch {}
            }
            continue
        }

        # Nếu chế độ độc lập (Standalone Gemini Vision):
        $loadingMsgId = Send-TelegramMessage -chatId $chatId -text "🧠 <b>[ĐANG PHÂN TÍCH $($savedImgPaths.Count) ẢNH QUA VISION (1s)...]</b>"
        try {
            $visionAnswer = Ask-GeminiVisionMulti -userText $userCaption -imagePaths $savedImgPaths
            $formattedVision = Convert-MdToTgHtml -text $visionAnswer
            if ($loadingMsgId) {
                Edit-TelegramMessage -chatId $chatId -messageId $loadingMsgId -text $formattedVision
            } else {
                Send-TelegramMessage -chatId $chatId -text $formattedVision
            }
        } catch {
            if ($loadingMsgId) {
                Edit-TelegramMessage -chatId $chatId -messageId $loadingMsgId -text "Lỗi phân tích album ảnh: $_"
            }
        }
    }
}

function Execute-UserPrompt {
    param(
        [int64]$chatId,
        [string]$text
    )

    $global:isExecuting = $true
    $preview = if ($text.Length -gt 35) { $text.Substring(0, 35) + "..." } else { $text }
    $global:currentExecutingPrompt = "pro: $preview"

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
    # 2. KHỞI CHẠY TIẾN TRÌNH THỰC THI CHẠY NỀN
    if (Check-SyncBridgeStatus) {
        # 1. GỬI NGAY PHẢN HỒI TỨC THÌ ĐẦU TIÊN CHO TELEGRAM (< 0.5s)
        $global:promptReadingStart = [DateTime]::Now
        $global:promptReadingPreview = $preview
        $global:lastReadingSec = 1
        $safePrev = [System.Net.WebUtility]::HtmlEncode($preview)
        Send-TelegramAction -chatId $chatId -action "typing"

        if (Test-Path $syncBridgePath) {
            try {
                $br = Get-Content $syncBridgePath -Raw -Encoding UTF8 | ConvertFrom-Json
                $br | Add-Member -NotePropertyName "promptReadingMsgId" -NotePropertyValue $global:promptReadingMsgId -Force
                $br | Add-Member -NotePropertyName "promptReadingStart" -NotePropertyValue ([DateTime]::Now.ToString("o")) -Force
                $br | Add-Member -NotePropertyName "promptReadingPreview" -NotePropertyValue $preview -Force
                $br | ConvertTo-Json -Depth 5 | Set-Content $syncBridgePath -Encoding UTF8
            } catch {}
        }

        # 2. Gửi ngầm không chặn (Non-blocking) vào Antigravity PC
        Append-SyncMessage -sender "phone" -text $text
        Send-ToAntigravityChat -text $text
        Show-ScreenNotification -title "📱 Tin Nhắn Đồng Bộ Từ Điện Thoại" -msg "$preview" -durationSec 3
        return
    }

    # CHẾ ĐỘ ĐỘC LẬP (STANDALONE): KHI KHÔNG KẾT NỐI MÁY TÍNH
    Send-TelegramAction -chatId $chatId -action "typing"
    $global:currentJobPrompt = $preview
    $global:jobStartTime = [DateTime]::Now
    $global:lastThinkingSec = 1
    $global:thinkingMsgId = Send-TelegramMessage -chatId $chatId -text "🧠 AI đang suy nghĩ (1s)..."
    
    $workerScript = Join-Path $rootDir "worker_execute.ps1"
    $global:currentJob = Start-Job -FilePath $workerScript -ArgumentList $chatId, $text, $rootDir
    return
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
    # 0. KIỂM TRA TRẠNG THÁI MÁY TÍNH KHI ĐANG KẾT NỐI ĐỒNG BỘ
    if (Check-SyncBridgeStatus) {
        try {
            if (Test-Path $syncBridgePath) {
                $brData = Get-Content $syncBridgePath -Raw -Encoding UTF8 | ConvertFrom-Json
                if ($brData.isWorking -eq $false -and $global:isExecuting -eq $true -and $null -eq $global:currentJob) {
                    $global:isExecuting = $false
                    $global:currentExecutingPrompt = ""
                    Check-And-Run-Next-In-Queue -chatId $allowedChatId
                }
            }
        } catch {}
    }

    # Đếm giây liên tục cho trạng thái ĐANG ĐỌC PROMPT CỦA BẠN (Cập nhật 2s/lần)
    if ($global:promptReadingStart -and $global:promptReadingMsgId) {
        if (Test-Path $syncBridgePath) {
            try {
                $brData = Get-Content $syncBridgePath -Raw -Encoding UTF8 | ConvertFrom-Json
                if (-not $brData.promptReadingMsgId) {
                    $global:promptReadingStart = $null
                    $global:promptReadingMsgId = $null
                }
            } catch {}
        }
        if ($global:promptReadingStart -and $global:promptReadingMsgId) {
            $currReadSec = [math]::Max(1, [int]([DateTime]::Now - $global:promptReadingStart).TotalSeconds)
            if ($currReadSec -ge ($global:lastReadingSec + 2)) {
                $global:lastReadingSec = $currReadSec
                $safePrev = [System.Net.WebUtility]::HtmlEncode($global:promptReadingPreview)
                # Da bo thong bao doc prompt theo yeu cau cua bro
            }
        }
    }

    # 1. KIỂM TRA TIẾN TRÌNH LỆNH CHẠY NỀN HIỆN TẠI (CHẠY THEO GIÂY LIÊN TỤC VÀ KẾT THÚC KHI XONG)
    if ($global:currentJob) {
        if ($global:currentJob.State -eq 'Running') {
            $elapsedSec = [math]::Max(1, [int]([DateTime]::Now - $global:jobStartTime).TotalSeconds)
            if ($elapsedSec -ge ($global:lastThinkingSec + 2)) {
                $global:lastThinkingSec = $elapsedSec
                Edit-TelegramMessage -chatId $allowedChatId -messageId $global:thinkingMsgId -text "🧠 AI đang suy nghĩ (${elapsedSec}s)..." | Out-Null
            }
        }
        elseif ($global:currentJob.State -in @('Completed', 'Failed', 'Stopped')) {
            $elapsedSec = [math]::Max(1, [int]([DateTime]::Now - $global:jobStartTime).TotalSeconds)
            if ($global:thinkingMsgId) {
                Edit-TelegramMessage -chatId $allowedChatId -messageId $global:thinkingMsgId -text "🧠 [AI ĐÃ SUY NGHĨ XONG - ${elapsedSec}s]" | Out-Null
            }
            $jobRaw = Receive-Job $global:currentJob | Out-String
            Remove-Job $global:currentJob -Force
            $global:currentJob = $null

            if (-not [string]::IsNullOrWhiteSpace($jobRaw)) {
                try {
                    $resObj = $jobRaw | ConvertFrom-Json
                    if ($resObj.type -eq "cmd") {
                        $tokenEnd = Format-TokenFooter -tokensThisCall ($resObj.tokensUsed)
                        Send-TelegramMessage -chatId $allowedChatId -text "=== [Kết quả: $($global:currentJobPrompt)] ===`n$($resObj.output)`n`n$tokenEnd"
                    }
                    elseif ($resObj.type -eq "ai") {
                        $cleanReply = $resObj.cleanReply
                        $cmdToRun = $resObj.cmdToRun
                        $autoOutput = $resObj.autoOutput
                        $execMode = $resObj.executionMode
                        $savedFiles = $resObj.savedFiles
                        $curProjPath = $resObj.currentProjectPath
                        
                        if ($savedFiles -and $savedFiles.Count -gt 0) {
                            $fileListStr = $savedFiles -join ", "
                            Show-ScreenNotification -title "💾 File Đã Lưu Vào Máy Tính" -msg "$fileListStr" -durationSec 5
                        } elseif ($cleanReply.Length -gt 150) { 
                            Show-ScreenNotification -title "🤖 AI Phản Hồi -> Máy tính" -msg ($cleanReply.Substring(0, 150) + "...") -durationSec 4 
                        }

                        if ($cmdToRun) {
                            if ($execMode -eq "ask") {
                                $cmdId = [System.Guid]::NewGuid().ToString('N').Substring(0, 8)
                                $pendingCommands[$cmdId] = $cmdToRun
                                $promptText = "$cleanReply`n`n⚠️ AI yêu cầu thực thi lệnh sau trên máy tính:`n`powershell: $cmdToRun`n`nBạn có cho phép chạy không?"
                                $askButtons = @(
                                    @(
                                        @{ text = "✅ Cho phép chạy"; callback_data = "exec:$cmdId" },
                                        @{ text = "❌ Hủy bỏ"; callback_data = "cancel:$cmdId" }
                                    )
                                )
                                Send-TelegramKeyboard -chatId $allowedChatId -text $promptText -buttons $askButtons
                                $global:isExecuting = $false
                                $global:currentExecutingPrompt = ""
                                continue
                            } else {
                                $outText = "$cleanReply`n`n⚡ [ĐÃ TỰ ĐỘNG THỰC THI]:`n$autoOutput"
                                if ($savedFiles -and $savedFiles.Count -gt 0) {
                                    $fileListStr = $savedFiles -join ", "
                                    $outText += "`n`n💾 [FILE ĐÃ LƯU TRÊN MÁY TÍNH]:`n📄 $fileListStr`n📁 $curProjPath"
                                }
                                $tokenEnd = Format-TokenFooter -tokensThisCall ($resObj.tokensUsed)
                                Send-TelegramMessage -chatId $allowedChatId -text "$outText`n`n$tokenEnd"
                            }
                        } else {
                            $outText = $cleanReply
                            if ($savedFiles -and $savedFiles.Count -gt 0) {
                                $fileListStr = $savedFiles -join ", "
                                $outText += "`n`n💾 [FILE ĐÃ LƯU TRÊN MÁY TÍNH]:`n📄 $fileListStr`n📁 $curProjPath"
                            }
                            $tokenEnd = Format-TokenFooter -tokensThisCall ($resObj.tokensUsed)
                            Send-TelegramMessage -chatId $allowedChatId -text "$outText`n`n$tokenEnd"
                        }
                    }
                    else {
                        $tokenEnd = Format-TokenFooter -tokensThisCall 10
                        Send-TelegramMessage -chatId $allowedChatId -text "=== [Kết quả: $($global:currentJobPrompt)] ===`n$jobRaw`n`n$tokenEnd"
                    }
                } catch {
                    $tokenEnd = Format-TokenFooter -tokensThisCall 10
                    Send-TelegramMessage -chatId $allowedChatId -text "=== [Kết quả: $($global:currentJobPrompt)] ===`n$jobRaw`n`n$tokenEnd"
                }
            }

            $global:isExecuting = $false
            $global:currentExecutingPrompt = ""

            # TỰ ĐỘNG LẤY PROMPT TIẾP THEO TRONG HÀNG ĐỢI ĐỂ CHẠY
            Check-And-Run-Next-In-Queue -chatId $allowedChatId
        }
    }

    # 2. LẮNG NGHE TIN NHẮN TỪ TELEGRAM (TIMEOUT NHANH 1S NẾU ĐANG CHẠY ĐỂ BẮT HÀNG ĐỢI)
    try {
        Process-PendingMediaGroups
        $pollTimeout = if ($global:isExecuting -or $global:currentJob -or ($global:pendingMediaGroups -and $global:pendingMediaGroups.Count -gt 0)) { 1 } else { 12 }
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

                    $cbFromId = if ($cb.from) { [int64]$cb.from.id } else { 0 }
                    if ($cbChatId -ne $allowedChatId -and $cbFromId -ne $allowedChatId) {
                        Answer-TelegramCallback -callbackId $cbId -text "Bạn không có quyền!"
                        continue
                    }

                    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Bấm nút: $data" -ForegroundColor Magenta

                    # --- XỬ LÝ CÁC NÚT TRONG HÀNG ĐỢI PROMPT (QUEUE ACTIONS) ---

                    # Nút 1: Ưu tiên dùng prompt này (Send now)
                    if ($data -eq "tunnel:stop") {
                        Answer-TelegramCallback -callbackId $cbId -text "Đang đóng xem trước web..."
                        Start-Process powershell.exe -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$rootDir\preview_tunnel.ps1`" -action stop -chatId $cbChatId" -WindowStyle Hidden
                        continue
                    }

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
                                        # --- XỬ LÝ CÁC NÚT DỰ ÁN (PROJECT WORKFLOW - BƯỚC 1) ---
                    if ($data -eq "proj:new") {
                        # 1. KIỂM TRA EASTER EGG (NHẤP 7 LẦN TRONG 2.5 GIÂY)
                        $now = [DateTime]::Now
                        if ($null -eq $global:projNewClicks) { $global:projNewClicks = [System.Collections.Generic.List[DateTime]]::new() }
                        $global:projNewClicks.Add($now)
                        
                        $recentClicks = $global:projNewClicks | Where-Object { ($now - $_).TotalSeconds -le 2.5 }
                        $global:projNewClicks = [System.Collections.Generic.List[DateTime]]::new()
                        foreach ($c in $recentClicks) { $global:projNewClicks.Add($c) }
                        
                        if ($global:projNewClicks.Count -ge 7) {
                            $global:projNewClicks.Clear()
                            $global:waitingForSuperAdminPassword = $true
                            Answer-TelegramCallback -callbackId $cbId -text "🚨 SYSTEM OVERRIDE DETECTED!"
                            
                            $secPrompt = @(
                                "🔒 [HỆ THỐNG BẢO MẬT QUINLOVERIN ROOT]",
                                "",
                                "Phát hiện 7 thao tác nhấp liên tiếp!",
                                "Hệ thống đang chuyển sang chế độ xác thực tối cao.",
                                "",
                                "👉 Vui lòng nhập mật khẩu bảo mật để mở khóa toàn quyền hệ sinh thái:"
                            ) -join "`n"
                            Send-TelegramMessage -chatId $cbChatId -text $secPrompt
                            continue
                        }

                        # 2. XỬ LÝ BÌNH THƯỜNG (KHI CHƯA ĐỦ 7 LẦN)
                        Answer-TelegramCallback -callbackId $cbId -text "Đang mở trình tạo dự án..."
                        $global:waitingForNewProjectName = $true
                        $promptNewProj = @(
                            "✨ TẠO PROJECT MỚI (Tương đương Ctrl+Shift+N):",
                            "",
                            "Bạn hãy gõ TÊN PROJECT bên dưới để khởi tạo:",
                            "Ví dụ: game_caro, website_shop, discord_bot, app_mobile...",
                            "",
                            "Sau khi nhập tên, bạn sẽ được chọn ổ đĩa lưu trữ và chế độ kết nối với máy tính!"
                        ) -join "`n"
                        Send-TelegramMessage -chatId $cbChatId -text $promptNewProj
                        continue
                    }
                    elseif ($data.StartsWith("proj:drive:")) {
                        $drv = $data.Substring(11).Trim()
                        Answer-TelegramCallback -callbackId $cbId
                        
                        $pName = if ($global:tempNewProjName) { $global:tempNewProjName } else { "project_" + (Get-Date -Format "yyyyMMdd_HHmmss") }
                        
                        $targetFolder = ""
                        if ($drv -eq "DEFAULT") {
                            $targetFolder = Join-Path $projectsRootDir $pName
                        } else {
                            $targetFolder = "$($drv):\Projects\$pName"
                        }
                        
                        if (-not (Test-Path $targetFolder)) {
                            New-Item -ItemType Directory -Path $targetFolder -Force | Out-Null
                        }
                        
                        $currentProject = $pName
                        $currentProjectPath = $targetFolder
                        $config.CURRENT_PROJECT = $currentProject
                        $config.CURRENT_PROJECT_PATH = $currentProjectPath
                        $config | ConvertTo-Json | Set-Content $configPath -Encoding UTF8
                        
                        Show-ScreenNotification -title "📁 Đã Tạo Thư Mục Dự Án" -msg "$currentProject ($currentProjectPath)" -durationSec 4
                        
                        # HỎI CÓ KẾT NỐI VỚI MÁY TÍNH KHÔNG?
                        $askConnText = @(
                            "🎉 ĐÃ KHỞI TẠO DỰ ÁN THÀNH CÔNG!",
                            "",
                            "• Tên dự án: $currentProject",
                            "• Thư mục lưu: $currentProjectPath",
                            "",
                            "🔗 Bạn có muốn kết nối đồng bộ trực tiếp dự án này với máy tính không?"
                        ) -join "`n"
                        
                        $connButtons = @(
                            @( @{ text = "🔗 Có, kết nối với máy tính"; callback_data = "proj:conn:yes" } ),
                            @( @{ text = "⚡ Không, dùng AI độc lập"; callback_data = "proj:conn:no" } )
                        )
                        Edit-TelegramKeyboard -chatId $cbChatId -messageId $cbMsgId -text $askConnText -buttons $connButtons
                        continue
                    }
                    elseif ($data -eq "proj:conn:no") {
                        Answer-TelegramCallback -callbackId $cbId -text "Chế độ độc lập"
                        $noMsg = @(
                            "⚡ ĐÃ KÍCH HOẠT CHẾ ĐỘ ĐỘC LẬP TRÊN ĐIỆN THOẠI!",
                            "",
                            "• Dự án: $currentProject",
                            "• Thư mục lưu trên máy tính: $currentProjectPath",
                            "",
                            "Mọi file và mã nguồn bạn yêu cầu sinh ra sẽ được tự động ghi thẳng vào máy tính!",
                            "",
                            "👉 BƯỚC 2: Vui lòng chọn Model AI để bắt đầu lập trình:"
                        ) -join "`n"
                        Edit-TelegramKeyboard -chatId $cbChatId -messageId $cbMsgId -text $noMsg -buttons (Get-ModelMainMenuButtons)
                        continue
                    }
                    elseif ($data -eq "proj:conn:yes") {
                        Answer-TelegramCallback -callbackId $cbId
                        # HỎI CHẾ ĐỘ MÁY TÍNH: CÓ IDE HAY KHÔNG IDE
                        $askModeText = @(
                            "🖥️ BƯỚC KẾT NỐI: CHỌN CHẾ ĐỘ MÁY TÍNH",
                            "",
                            "Bạn muốn mở dự án trên máy tính theo chế độ nào?",
                            "",
                            "1️⃣ Antigravity IDE: Bật nguyên cửa sổ IDE đầy đủ (Editor + File Tree + Terminal).",
                            "2️⃣ Antigravity App Chuẩn: Mở ứng dụng Antigravity tiêu chuẩn.",
                            "3️⃣ Chạy Ngầm (Không IDE): Không bật cửa sổ, chạy ngầm cực nhẹ và tự động lưu code."
                        ) -join "`n"
                        
                        $modeButtons = @(
                            @( @{ text = "💻 Antigravity IDE (Có IDE)"; callback_data = "proj:launch:ide" } ),
                            @( @{ text = "🚀 Antigravity (App Chuẩn)"; callback_data = "proj:launch:standard" } ),
                            @( @{ text = "🔇 Chạy Ngầm (Không IDE)"; callback_data = "proj:launch:headless" } )
                        )
                        Edit-TelegramKeyboard -chatId $cbChatId -messageId $cbMsgId -text $askModeText -buttons $modeButtons
                        continue
                    }
                    elseif ($data.StartsWith("proj:launch:")) {
                        $launchMode = $data.Substring(12).Trim()
                        Answer-TelegramCallback -callbackId $cbId -text "Đang khởi chạy $launchMode..."
                        
                        $modeDesc = ""
                        if ($launchMode -eq "ide") {
                            $modeDesc = "Antigravity IDE (Có IDE)"
                            $ideExe = if (Test-Path "E:\Antigravity IDE\Antigravity IDE.exe") { "E:\Antigravity IDE\Antigravity IDE.exe" } else { "$env:LOCALAPPDATA\Programs\antigravity\Antigravity.exe" }
                            try {
                                Start-Process -FilePath $ideExe -ArgumentList "`"$currentProjectPath`""
                            } catch {}
                        }
                        elseif ($launchMode -eq "standard") {
                            $modeDesc = "Antigravity (App Chuẩn)"
                            $stdExe = "$env:LOCALAPPDATA\Programs\antigravity\Antigravity.exe"
                            try {
                                if (Test-Path $stdExe) { Start-Process -FilePath $stdExe -ArgumentList "`"$currentProjectPath`"" }
                            } catch {}
                        }
                        else {
                            $modeDesc = "Chạy Ngầm (Không IDE)"
                        }
                        
                        # Kích hoạt trạng thái đồng bộ
                        if (Test-Path $syncBridgePath) {
                            try {
                                $br = Get-Content $syncBridgePath -Raw -Encoding UTF8 | ConvertFrom-Json
                                $br.active = $true
                                $br.status = "CONNECTED"
                                $br.connectedAt = (Get-Date -Format "yyyy-MM-dd HH:mm:ss")
                                $br | ConvertTo-Json -Depth 5 | Set-Content $syncBridgePath -Encoding UTF8
                            } catch {}
                        }
                        
                        Show-ScreenNotification -title "🔗 Đã Đồng Bộ Dự Án Mới" -msg "$currentProject | Chế độ: $modeDesc" -durationSec 4
                        
                        $readyMsg = @(
                            "🎉 ĐÃ ĐỒNG BỘ THÀNH CÔNG VỚI MÁY TÍNH!",
                            "",
                            "• Dự án: $currentProject",
                            "• Chế độ máy tính: $modeDesc",
                            "• Vị trí: $currentProjectPath",
                            "",
                            "Từ bây giờ mọi lệnh và code bạn gửi từ điện thoại sẽ được thực thi trên máy tính!",
                            "",
                            "👉 BƯỚC 2: Vui lòng chọn Model AI để bắt đầu lập trình:"
                        ) -join "`n"
                        
                        Edit-TelegramKeyboard -chatId $cbChatId -messageId $cbMsgId -text $readyMsg -buttons (Get-ModelMainMenuButtons)
                        continue
                    }
                    elseif ($data -eq "proj:list") {
                        Answer-TelegramCallback -callbackId $cbId
                        if (-not (Test-Path $projectsRootDir)) {
                            New-Item -ItemType Directory -Path $projectsRootDir -Force | Out-Null
                        }
                        $subDirs = Get-ChildItem -Path $projectsRootDir -Directory -ErrorAction SilentlyContinue
                        if (-not $subDirs -or $subDirs.Count -eq 0) {
                            $emptyText = "📂 Hiện tại chưa có project con nào trong thư mục 'model/'.`n`nBạn hãy bấm nút bên dưới để tạo project mới nhé!"
                            $emptyButtons = @(
                                @( @{ text = "✨ Tạo Project Mới (Ctrl+Shift+N)"; callback_data = "proj:new" } ),
                                @( @{ text = "⬅️ Quay lại Menu Project"; callback_data = "proj:menu" } )
                            )
                            Edit-TelegramKeyboard -chatId $cbChatId -messageId $cbMsgId -text $emptyText -buttons $emptyButtons
                        } else {
                            $listText = "📂 DANH SÁCH PROJECT ĐÃ CÓ ($($subDirs.Count) project):`n`nChọn project bên dưới để tiếp tục làm việc:"
                            $projButtons = @()
                            foreach ($d in $subDirs) {
                                $mark = if ($d.Name -eq $currentProject) { " (Đang chọn) ✓" } else { "" }
                                $projButtons += ,@( @{ text = "📁 $($d.Name)$mark"; callback_data = "proj:select:$($d.Name)" } )
                            }
                            $projButtons += ,@( @{ text = "✨ Tạo Project Mới"; callback_data = "proj:new" } )
                            $projButtons += ,@( @{ text = "⬅️ Quay lại Menu Project"; callback_data = "proj:menu" } )
                            Edit-TelegramKeyboard -chatId $cbChatId -messageId $cbMsgId -text $listText -buttons $projButtons
                        }
                        continue
                    }
                    elseif ($data.StartsWith("proj:select:")) {
                        $selName = $data.Substring(12).Trim()
                        Answer-TelegramCallback -callbackId $cbId -text "Đã chọn: $selName"
                        $currentProject = $selName
                        $currentProjectPath = Join-Path $projectsRootDir $selName
                        $config.CURRENT_PROJECT = $currentProject
                        $config.CURRENT_PROJECT_PATH = $currentProjectPath
                        $config | ConvertTo-Json | Set-Content $configPath -Encoding UTF8
                        
                        Show-ScreenNotification -title "📁 Mở Project" -msg "$currentProject" -durationSec 3
                        $pMsg = "✅ ĐÃ MỞ PROJECT: $currentProject!`nĐường dẫn: $currentProjectPath`n`n👉 BƯỚC 2: Vui lòng chọn Model AI bên dưới:"
                        Edit-TelegramKeyboard -chatId $cbChatId -messageId $cbMsgId -text $pMsg -buttons (Get-ModelMainMenuButtons)
                        continue
                    }
                    elseif ($data -eq "proj:continue") {
                        Answer-TelegramCallback -callbackId $cbId -text "Tiếp tục $currentProject"
                        $pMsg = "▶️ TIẾP TỤC PROJECT: $currentProject`nĐường dẫn: $currentProjectPath`n`n👉 BƯỚC 2: Vui lòng chọn Model AI bên dưới:"
                        Edit-TelegramKeyboard -chatId $cbChatId -messageId $cbMsgId -text $pMsg -buttons (Get-ModelMainMenuButtons)
                        continue
                    }
                    elseif ($data -eq "proj:menu") {
                        Answer-TelegramCallback -callbackId $cbId
                        $pText = "📁 BƯỚC 1: QUẢN LÝ DỰ ÁN (PROJECT)`n`n• Project hiện tại: $currentProject`n• Thư mục gốc: $projectsRootDir`n`nBạn muốn tạo mới hay mở project nào để làm việc?"
                        Edit-TelegramKeyboard -chatId $cbChatId -messageId $cbMsgId -text $pText -buttons (Get-ProjectMenuButtons)
                        continue
                    }

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

                $fromId = if ($msg.from) { [int64]$msg.from.id } else { 0 }
                if ($chatId -ne $allowedChatId -and $fromId -ne $allowedChatId) {
                    Send-TelegramMessage -chatId $chatId -text "Xin lỗi, bạn không có quyền điều khiển máy tính này!"
                    continue
                }

                # --- XỬ LÝ ẢNH (VISION) & ALBUM ĐA PHƯƠNG TIỆN ---
                $isPhoto = ($null -ne $msg.photo) -and ($msg.photo.Count -gt 0)
                $isDocImage = ($null -ne $msg.document) -and (
                    ($msg.document.mime_type -like "image/*") -or 
                    ($msg.document.file_name -match "\.(png|jpg|jpeg|gif|webp|bmp)$")
                )

                if ($isPhoto -or $isDocImage) {
                    $fileId = ""
                    $ext = ".jpg"
                    if ($isPhoto) {
                        $largestPhoto = $msg.photo | Sort-Object file_size -Descending | Select-Object -First 1
                        $fileId = $largestPhoto.file_id
                        $ext = ".jpg"
                    } else {
                        $fileId = $msg.document.file_id
                        $ext = [System.IO.Path]::GetExtension($msg.document.file_name)
                        if ([string]::IsNullOrWhiteSpace($ext)) { $ext = ".jpg" }
                    }

                    $hasCaption = [bool]$msg.caption
                    $userCaption = if ($hasCaption) { $msg.caption.Trim() } else { "" }

                    # A. NẾU LÀ ALBUM NHIỀU ẢNH (MEDIA GROUP)
                    if ($msg.media_group_id) {
                        $mgId = [string]$msg.media_group_id
                        if (-not $global:pendingMediaGroups.ContainsKey($mgId)) {
                            # Gửi ACK tức thì ngay ảnh đầu tiên (< 0.5s)
                            $previewCaption = if ($hasCaption) { $userCaption } else { "Album ảnh từ điện thoại" }
                            $safeCaption = [System.Net.WebUtility]::HtmlEncode($previewCaption)
                            $statusMsgId = Send-TelegramMessage -chatId $chatId -text "📷 <b>[ĐÃ NHẬN ALBUM ẢNH (1 ảnh)...]</b>`n<blockquote><i>`"$safeCaption`"</i></blockquote>"
                            
                            $groupObj = [PSCustomObject]@{
                                chatId = $chatId
                                statusMsgId = $statusMsgId
                                caption = $userCaption
                                items = [System.Collections.ArrayList]@([PSCustomObject]@{ fileId = $fileId; ext = $ext })
                                lastUpdated = [DateTime]::Now
                                firstReceived = [DateTime]::Now
                            }
                            $global:pendingMediaGroups[$mgId] = $groupObj
                        } else {
                            $groupObj = $global:pendingMediaGroups[$mgId]
                            [void]$groupObj.items.Add([PSCustomObject]@{ fileId = $fileId; ext = $ext })
                            if ($hasCaption -and [string]::IsNullOrWhiteSpace($groupObj.caption)) {
                                $groupObj.caption = $userCaption
                            }
                            $groupObj.lastUpdated = [DateTime]::Now
                            
                            $count = $groupObj.items.Count
                            $dispCaption = if ($groupObj.caption) { $groupObj.caption } else { "Album ảnh từ điện thoại" }
                            $safeCaption = [System.Net.WebUtility]::HtmlEncode($dispCaption)
                            Edit-TelegramMessage -chatId $chatId -messageId $groupObj.statusMsgId -text "📷 <b>[ĐÃ NHẬN ALBUM ẢNH ($count ảnh)...]</b>`n<blockquote><i>`"$safeCaption`"</i></blockquote>" | Out-Null
                        }
                        continue
                    }

                    # B. NẾU LÀ 1 ẢNH ĐƠN LẺ (SINGLE PHOTO)
                    $userCaption = if ($hasCaption) { $msg.caption.Trim() } else { "Hãy quan sát bức ảnh này và phân tích, hỗ trợ tôi." }

                    # 1. GỬI NGAY THÔNG BÁO TỨC THÌ ĐẦU TIÊN (< 0.5s) CHO TELEGRAM
                    $global:promptReadingStart = [DateTime]::Now
                    $global:promptReadingPreview = if ($hasCaption) { "[Ảnh] $userCaption" } else { "[Ảnh] Phân tích hình ảnh" }
                    $global:lastReadingSec = 1
                    $safeCaption = [System.Net.WebUtility]::HtmlEncode($userCaption)
                    $global:promptReadingMsgId = Send-TelegramMessage -chatId $chatId -text "📷 <b>[ĐÃ NHẬN ẢNH - ĐANG TẢI & PHÂN TÍCH (1s)...]</b>`n<blockquote expandable><i>`"$safeCaption`"</i></blockquote>"

                    # 2. Tải ảnh từ Telegram API về máy tính trong nền
                    $uploadDir = Join-Path $currentProjectPath "uploads"
                    if (-not (Test-Path $uploadDir)) { New-Item -ItemType Directory -Path $uploadDir -Force | Out-Null }
                    $imgFileName = "photo_$(Get-Date -Format 'yyyyMMdd_HHmmss')$ext"
                    $savedImgPath = Join-Path $uploadDir $imgFileName

                    $downloadOk = $false
                    try {
                        $getFileUrl = "https://api.telegram.org/bot$botToken/getFile?file_id=$fileId"
                        $fileInfo = Invoke-RestMethod -Uri $getFileUrl -Method Get
                        if ($fileInfo.ok -and $fileInfo.result.file_path) {
                            $filePath = $fileInfo.result.file_path
                            $downloadUrl = "https://api.telegram.org/file/bot$botToken/$filePath"
                            & curl.exe -s -o $savedImgPath $downloadUrl
                            if (Test-Path $savedImgPath) { $downloadOk = $true }
                        }
                    } catch {}

                    if (-not $downloadOk) {
                        Edit-TelegramMessage -chatId $chatId -messageId $global:promptReadingMsgId -text "❌ Không thể tải ảnh từ Telegram về máy tính!"
                        continue
                    }

                    # 3. NẾU ĐANG KẾT NỐI ĐỒNG BỘ VỚI ANTIGRAVITY PC:
                    if (Check-SyncBridgeStatus) {
                        $fullPrompt = "[Điện thoại gửi ảnh]: $userCaption`nĐường dẫn file ảnh trên máy tính: $savedImgPath"
                        Append-SyncMessage -sender "phone" -text $fullPrompt
                        Send-ToAntigravityChat -text $fullPrompt
                        Show-ScreenNotification -title "📷 Telegram: Đã Nhận Ảnh" -msg "$userCaption" -durationSec 3

                        if (Test-Path $syncBridgePath) {
                            try {
                                $br = Get-Content $syncBridgePath -Raw -Encoding UTF8 | ConvertFrom-Json
                                $br | Add-Member -NotePropertyName "promptReadingMsgId" -NotePropertyValue $global:promptReadingMsgId -Force
                                $br | Add-Member -NotePropertyName "promptReadingStart" -NotePropertyValue ([DateTime]::Now.ToString("o")) -Force
                                $br | Add-Member -NotePropertyName "promptReadingPreview" -NotePropertyValue "[Ảnh] $userCaption" -Force
                                $br | ConvertTo-Json -Depth 5 | Set-Content $syncBridgePath -Encoding UTF8
                            } catch {}
                        }
                        continue
                    }

                    # 4. CHẾ ĐỘ ĐỘC LẬP (STANDALONE): GỬI SANG GEMINI MULTIMODAL VISION
                    $loadingMsgId = Send-TelegramMessage -chatId $chatId -text "🧠 <b>[ĐANG PHÂN TÍCH ẢNH QUA VISION (1s)...]</b>"
                    try {
                        $imgBytes = [System.IO.File]::ReadAllBytes($savedImgPath)
                        $base64 = [System.Convert]::ToBase64String($imgBytes)
                        $mimeType = switch ($ext.ToLower()) {
                            ".png"  { "image/png" }
                            ".webp" { "image/webp" }
                            ".gif"  { "image/gif" }
                            default { "image/jpeg" }
                        }
                        $visionAnswer = Ask-GeminiVision -userText $userCaption -base64Image $base64 -mimeType $mimeType
                        $formattedVision = Convert-MdToTgHtml -text $visionAnswer
                        if ($loadingMsgId) {
                            Edit-TelegramMessage -chatId $chatId -messageId $loadingMsgId -text $formattedVision
                        } else {
                            Send-TelegramMessage -chatId $chatId -text $formattedVision
                        }
                    } catch {
                        if ($loadingMsgId) {
                            Edit-TelegramMessage -chatId $chatId -messageId $loadingMsgId -text "Lỗi xử lý ảnh: $_"
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

                # 0. NẾU ĐANG CHỜ MẬT KHẨU SUPER ADMIN (EASTER EGG)
                if ($global:waitingForSuperAdminPassword -eq $true) {
                    $global:waitingForSuperAdminPassword = $false
                    if ($text.Trim() -eq "270927-260626-ltqlovepmt") {
                        $global:isSuperAdmin = $true
                        Show-ScreenNotification -title "🔓 ROOT UNLOCKED" -msg "Super Admin Mode Activated" -durationSec 5
                        $rootMsg = @(
                            "🔓 [ACCESS GRANTED - QUINLOVERIN SUPERUSER]",
                            "",
                            "🎉 XÁC THỰC THÀNH CÔNG! Chào mừng Lê Trung Quang.",
                            "Bạn đã được cấp TOÀN QUYỀN HỆ SINH THÁI QUINLOVERIN CODE!",
                            "",
                            "🛠️ ĐẶC QUYỀN ĐANG KÍCH HOẠT:",
                            "• Toàn quyền quản trị mã nguồn gốc (Root Repository)",
                            "• Sửa đổi, debug và nạp lại bot (Hot-Reload) từ xa",
                            "• Thực thi lệnh PowerShell ở mức quyền cao nhất",
                            "• Giám sát CPU, RAM, tiến trình máy tính 24/7",
                            "",
                            "⚡ CÁC LỆNH QUẢN TRỊ BÍ MẬT:",
                            "• /root_status - Xem trạng thái máy tính & tiến trình ngầm",
                            "• /root_reload - Khởi động lại Bot, Watchdog & Mirror Worker",
                            "• /root_pull   - Cập nhật mã nguồn mới nhất từ GitHub",
                            "• /root_exit   - Thoát chế độ Super Admin"
                        ) -join "`n"
                        Send-TelegramMessage -chatId $chatId -text $rootMsg
                    } else {
                        Send-TelegramMessage -chatId $chatId -text "❌ Mật khẩu không chính xác! Đã hủy chế độ xác thực tối cao."
                    }
                    continue
                }

                # CÁC LỆNH SUPER ADMIN ROOT
                if ($text -eq "/root_status" -and $global:isSuperAdmin) {
                    $mem = Get-CimInstance Win32_OperatingSystem
                    $freeRAM = [math]::Round($mem.FreePhysicalMemory / 1024 / 1024, 2)
                    $totalRAM = [math]::Round($mem.TotalVisibleMemorySize / 1024 / 1024, 2)
                    $procs = Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" | Where-Object { $_.CommandLine -like "*bot.ps1*" -or $_.CommandLine -like "*watchdog.ps1*" -or $_.CommandLine -like "*mirror_worker.ps1*" }
                    $procList = ($procs | ForEach-Object { "• PID $($_.ProcessId): $(if ($_.CommandLine -like '*mirror*') {'Mirror Worker'} elseif ($_.CommandLine -like '*watchdog*') {'Watchdog'} else {'Bot Main'})" }) -join "`n"
                    
                    $statMsg = "🖥️ [ROOT SYSTEM STATUS]:`n`n• RAM khả dụng: $freeRAM GB / $totalRAM GB`n• Tiến trình đang giám sát:`n$procList`n• Workspace: $currentProjectPath"
                    Send-TelegramMessage -chatId $chatId -text $statMsg
                    continue
                }
                elseif ($text -eq "/root_pull" -and $global:isSuperAdmin) {
                    Send-TelegramMessage -chatId $chatId -text "🐙 [ROOT]: Đang kéo mã nguồn mới nhất từ GitHub..."
                    $gitOut = powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Set-Location '$rootDir'; git pull origin main 2>&1" | Out-String
                    Send-TelegramMessage -chatId $chatId -text "Kết quả git pull:`n$gitOut"
                    continue
                }
                elseif ($text -eq "/root_reload" -and $global:isSuperAdmin) {
                    Send-TelegramMessage -chatId $chatId -text "🔄 [ROOT]: Đang khởi động lại Bot và Mirror Worker..."
                    Start-Process powershell.exe -ArgumentList "-NoProfile -ExecutionPolicy Bypass -Command `"Start-Sleep -Seconds 1; Get-CimInstance Win32_Process -Filter 'Name = 'powershell.exe'' | Where-Object { `$_.CommandLine -like '*bot.ps1*' } | Stop-Process -Force`"" -WindowStyle Hidden
                    continue
                }
                elseif ($text -eq "/cloud" -or $text -eq "/switch_cloud") {
                    $cloudUrl = "https://quiniumthucode.vercel.app/api/webhook"
                    try {
                        $setRes = Invoke-RestMethod -Uri "https://api.telegram.org/bot$botToken/setWebhook?url=$cloudUrl" -Method Get
                        Send-TelegramMessage -chatId $chatId -text "☁️ <b>[ĐÃ CHUYỂN SANG VERCEL CLOUD 24/7]</b>`n──────────────────────`nWebhook đã chuyển sang Vercel Serverless thành công!`nBây giờ bro có thể tắt máy tính hoặc cúp điện thoải mái mà bot vẫn trò chuyện và code bình thường 24/7!`n`n👉 Khi bật lại máy tính, gõ <code>/pc</code> để chuyển quyền lại cho máy tính."
                    } catch {
                        Send-TelegramMessage -chatId $chatId -text "Lỗi chuyển sang Cloud: $_"
                    }
                    continue
                }
                elseif ($text -match '^(?i)(/pull|/sync|đồng bộ|dong bo|kéo code|keo code)$') {
                    Send-TelegramMessage -chatId $chatId -text "🐙 <b>[GITOPS SYNC]:</b> Đang kéo mã nguồn mới nhất từ GitHub về ổ cứng máy tính..."
                    $targetDir = if ($currentProjectPath -and (Test-Path $currentProjectPath)) { $currentProjectPath } else { $rootDir }
                    $gitOut = powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Set-Location '$targetDir'; git pull 2>&1" | Out-String
                    Send-TelegramMessage -chatId $chatId -text "✅ <b>[KẾT QUẢ ĐỒNG BỘ GITHUB]:</b>`n<pre><code>$gitOut</code></pre>`n📁 <i>Thư mục: $targetDir</i>"
                    continue
                }
                # --- TÍNH NĂNG DEMO & LIVE TEST WEB (1, 2, 4) ---
                elseif ($text -match '^(?i)(/preview|/tunnel|xem trước web|xem truoc web|demo web)$') {
                    Send-TelegramMessage -chatId $chatId -text "🌐 Đang khởi tạo đường truyền Cloudflare Tunnel xem trước web trên điện thoại..."
                    Start-Process powershell.exe -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$rootDir\preview_tunnel.ps1`" -action start -chatId $chatId" -WindowStyle Hidden
                    continue
                }
                elseif ($text -match '^(?i)(/stoppreview|/stoptunnel|dừng xem trước|dung xem truoc)$') {
                    Start-Process powershell.exe -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$rootDir\preview_tunnel.ps1`" -action stop -chatId $chatId" -WindowStyle Hidden
                    continue
                }
                elseif ($text -match '^(?i)(/testvideo|/record|quay video test|quay clip test|quay video)$') {
                    Send-TelegramMessage -chatId $chatId -text "🎬 Đang mở trình duyệt kiểm thử tự động và quay video mô phỏng thao tác người dùng..."
                    Start-Process node -ArgumentList "`"$rootDir\record_test_video.js`"" -WorkingDirectory $rootDir -WindowStyle Hidden
                    continue
                }
                elseif ($text -match '^(?i)/stream(?:\s+(.+))?$') {
                    $streamArgs = $matches[1]
                    if ([string]::IsNullOrWhiteSpace($streamArgs)) {
                        Start-Process powershell.exe -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$rootDir\stream_to_telegram.ps1`" -action start -chatId $chatId" -WindowStyle Hidden
                    } else {
                        $parts = $streamArgs.Trim() -split '\s+'
                        $u = $parts[0]
                        $k = if ($parts.Count -gt 1) { $parts[1] } else { "" }
                        Start-Process powershell.exe -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$rootDir\stream_to_telegram.ps1`" -action start -rtmpUrl `"$u`" -streamKey `"$k`" -chatId $chatId" -WindowStyle Hidden
                    }
                    continue
                }
                elseif ($text -match '^(?i)(/stopstream|dừng stream|dung stream)$') {
                    Start-Process powershell.exe -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$rootDir\stream_to_telegram.ps1`" -action stop -chatId $chatId" -WindowStyle Hidden
                    continue
                }
                elseif ($text -eq "/root_exit" -and $global:isSuperAdmin) {
                    $global:isSuperAdmin = $false
                    Send-TelegramMessage -chatId $chatId -text "🔒 [ROOT]: Đã khóa và thoát khỏi chế độ Super Admin."
                    continue
                }

                # 1.0 NẾU ĐANG CHỜ NHẬP TÊN PROJECT MỚI -> HỎI CHỌN Ổ ĐĨA
                if ($global:waitingForNewProjectName -eq $true) {
                    $global:waitingForNewProjectName = $false
                    $safeName = ($text -replace '[^a-zA-Z0-9_\-]', '_').ToLower().Trim('_')
                    if ([string]::IsNullOrWhiteSpace($safeName)) { $safeName = "project_" + (Get-Date -Format "yyyyMMdd_HHmmss") }
                    $global:tempNewProjName = $safeName

                    # Quét các ổ đĩa sẵn có trên máy tính
                    $driveButtons = @()
                    try {
                        $drives = Get-PSDrive -PSProvider FileSystem | Where-Object { $_.Free -gt 0 }
                        foreach ($d in $drives) {
                            $freeGB = [math]::Round($d.Free / 1GB, 1)
                            $driveButtons += ,@( @{ text = "💾 Ổ $($d.Name): ($freeGB GB trống)"; callback_data = "proj:drive:$($d.Name)" } )
                        }
                    } catch {}
                    $driveButtons += ,@( @{ text = "📁 Thư mục model mặc định"; callback_data = "proj:drive:DEFAULT" } )

                    $askDriveMsg = @(
                        "📁 BƯỚC 1.1: CHỌN NƠI LƯU TRỮ PROJECT [$safeName]",
                        "",
                        "Vui lòng chọn ổ đĩa trên máy tính của bạn để lưu dự án này:"
                    ) -join "`n"
                    Send-TelegramKeyboard -chatId $chatId -text $askDriveMsg -buttons $driveButtons
                    continue
                }

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

                # 2. XỬ LÝ LỆNH ĐỒNG BỘ TRỰC TIẾP (Neo chính xác ^...$ để câu nói dài không kích hoạt nhầm)
                if ($text -match '^(?i)(/connect|/sync|kết nối|đồng bộ)$') {
                    Initialize-SyncBridge -chatId $chatId
                    continue
                }
                elseif ($text -match '^(?i)(/disconnect|ngắt kết nối|hủy kết nối)$') {
                    Disconnect-SyncBridge -chatId $chatId
                    continue
                }
                elseif ($text -match '(?i)^gm_(\d{3,8})_mthu$') {
                    $codeNum = $matches[1]
                    $fullCode = "GM_${codeNum}_Mthu"
                    if (Test-Path $syncBridgePath) {
                        $bridge = Get-Content $syncBridgePath -Raw -Encoding UTF8 | ConvertFrom-Json
                        $bridge.syncCode = $fullCode
                        $bridge.status = "CONNECTED"
                        $bridge.active = $true
                        $bridge.connectedAt = (Get-Date -Format "yyyy-MM-dd HH:mm:ss")
                        $bridge | ConvertTo-Json -Depth 5 | Set-Content $syncBridgePath -Encoding UTF8
                    }
                    Show-ScreenNotification -title "🔗 Đã Kết Nối Đồng Bộ PC!" -msg "Mã: $fullCode" -durationSec 5
                    Send-TelegramMessage -chatId $chatId -text "🎉 KẾT NỐI ĐỒNG BỘ THÀNH CÔNG!`n`nĐã liên kết với máy tính qua mã $fullCode.`nTừ bây giờ, mọi mã nguồn và file được sinh ra sẽ tự động chuyển thẳng sang máy tính và lưu vào đúng thư mục dự án!"
                    continue
                }

                # 2.5 TỰ ĐỘNG NHẬN TOKEN GITHUB ĐỂ PUSH LÊN REPO
                if ($text -match '(ghp_[a-zA-Z0-9]{30,}|github_pat_[a-zA-Z0-9_]{30,})') {
                    $token = $matches[1]
                    Send-TelegramMessage -chatId $chatId -text "🔑 Đã nhận GitHub Token! Đang tiến hành push toàn bộ mã nguồn lên GitHub..."
                    $gitExe = if (Get-Command git -ErrorAction SilentlyContinue) { "git" } else { "$env:USERPROFILE\.gemini\antigravity\bin\git\cmd\git.exe" }
                    $pushUrl = "https://$token@github.com/letrungquangm-alt/Quin-Iu-Mthu-Code-mobile.git"
                    
                    Set-Location $rootDir
                    $pushRes = & $gitExe push -u $pushUrl main 2>&1 | Out-String
                    
                    if ($LASTEXITCODE -eq 0 -or $pushRes -like "*Everything up-to-date*" -or $pushRes -like "*main -> main*") {
                        Send-TelegramMessage -chatId $chatId -text "🎉 PUSH THÀNH CÔNG LÊN GITHUB!`n`nRepository: https://github.com/letrungquangm-alt/Quin-Iu-Mthu-Code-mobile`n`n$pushRes"
                    } else {
                        Send-TelegramMessage -chatId $chatId -text "❌ Lỗi khi push lên GitHub:`n$pushRes"
                    }
                    continue
                }

                # 2.6 TỰ ĐỘNG NHẬN TOKEN VERCEL ĐỂ DEPLOY WEB
                if ($text -match '(vcp_[a-zA-Z0-9]{30,})') {
                    $vToken = $matches[1]
                    $cfg = Get-Content $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
                    $cfg.VERCEL_TOKEN = $vToken
                    $cfg.VERCEL_TEAM_ID = "team_ItjW6FczErxCHeZsipuwaeI7"
                    $cfg | ConvertTo-Json | Set-Content $configPath -Encoding UTF8
                    Send-TelegramMessage -chatId $chatId -text "🎉 ĐÃ KẾT NỐI VERCEL TOKEN THÀNH CÔNG!`n`nTài khoản: letrungquangm-alt`nTrang web: https://quiniumthucode.vercel.app`n`nHệ thống đã sẵn sàng tự động xuất bản (deploy) website mỗi khi bạn code xong!"
                    continue
                }
                elseif ($text -match '(?i)^(/deploy|/vercel|deploy|xuất bản|xuat ban)$') {
                    Send-TelegramMessage -chatId $chatId -text "🚀 Đang tiến hành xuất bản website lên Vercel..."
                    $cfg = Get-Content $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
                    $vToken = $cfg.VERCEL_TOKEN
                    $teamId = $cfg.VERCEL_TEAM_ID
                    $targetPath = $cfg.CURRENT_PROJECT_PATH
                    
                    if (-not $vToken) {
                        Send-TelegramMessage -chatId $chatId -text "⚠️ Chưa cấu hình Vercel Token. Hãy dán token (bắt đầu bằng vcp_...) vào đây để tiếp tục!"
                        continue
                    }

                    $indexPath = Join-Path $targetPath "index.html"
                    if (-not (Test-Path $indexPath)) {
                        Send-TelegramMessage -chatId $chatId -text "⚠️ Không tìm thấy file index.html trong thư mục dự án: $targetPath"
                        continue
                    }

                    $htmlBytes = [System.IO.File]::ReadAllBytes($indexPath)
                    $base64 = [Convert]::ToBase64String($htmlBytes)

                    $body = @{
                        name = "quiniumthucode"
                        target = "production"
                        files = @(
                            @{
                                file = "index.html"
                                data = $base64
                                encoding = "base64"
                            }
                        )
                        projectSettings = @{ framework = $null }
                    } | ConvertTo-Json -Depth 5

                    $tempReq = Join-Path $env:TEMP "vercel_prod_req.json"
                    $noBom = New-Object System.Text.UTF8Encoding($false)
                    [System.IO.File]::WriteAllText($tempReq, $body, $noBom)

                    $deployRes = curl.exe -s -X POST "https://api.vercel.com/v13/deployments?teamId=$teamId" -H "Authorization: Bearer $vToken" -H "Content-Type: application/json" -d "@$tempReq"
                    
                    try {
                        $dObj = $deployRes | ConvertFrom-Json
                        if ($dObj.url -or $dObj.readyState -eq "READY") {
                            $liveMsg = @(
                                "🎉 XUẤT BẢN THÀNH CÔNG LÊN VERCEL!",
                                "",
                                "🌐 Link website trực tiếp:",
                                "👉 https://quiniumthucode.vercel.app",
                                "",
                                "🔗 Repository GitHub:",
                                "👉 https://github.com/letrungquangm-alt/Quin-Iu-Mthu-Code-mobile",
                                "",
                                "Trang web đã sẵn sàng hoạt động 24/7 trên toàn thế giới!"
                            ) -join "`n"
                            Send-TelegramMessage -chatId $chatId -text $liveMsg
                        } else {
                            Send-TelegramMessage -chatId $chatId -text "❌ Lỗi xuất bản Vercel:`n$deployRes"
                        }
                    } catch {
                        Send-TelegramMessage -chatId $chatId -text "❌ Phản hồi Vercel không hợp lệ:`n$deployRes"
                    }
                    continue
                }
                elseif ($text -match '(?i)(cài đặt tool QuinloveRin Code|cài đặt.*tool.*QuinloveRin|cài đặt tool|cai dat tool|setup máy mới|setup may moi|cài máy mới|/install|/setup)') {
                    $cfg = Get-Content $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
                    $bToken = $cfg.BOT_TOKEN
                    $gKey = $cfg.GEMINI_API_KEY
                    $ghTok = $cfg.GITHUB_TOKEN
                    $vTok = $cfg.VERCEL_TOKEN
                    $vTeam = $cfg.VERCEL_TEAM_ID

                    $installGuide = @(
                        "⚡ BẠN ĐANG NGỒI QUÁN NET HOẶC MÁY TÍNH MỚI?",
                        "",
                        "Dưới đây là ĐOẠN PROMPT ĐỘC QUYỀN để bạn nhờ chính Antigravity trên máy tính mới cài đặt toàn bộ hệ thống trong 10 giây và TỰ ĐỘNG KẾT NỐI SẴN với điện thoại của bạn!",
                        "",
                        "👉 BƯỚC DUY NHẤT: Copy toàn bộ đoạn bên dưới và DÁN VÀO Ô CHAT ANTIGRAVITY trên máy tính mới:",
                        "──────────────────────",
                        "Hãy cài đặt và thiết lập toàn diện hệ sinh thái QuinloveRin Code trên máy tính này cho tôi theo các bước tự động sau:",
                        "",
                        "1. Tạo thư mục làm việc:",
                        "New-Item -ItemType Directory -Path '$env:USERPROFILE\.gemini\antigravity\scratch\telegram-remote-coder' -Force",
                        "New-Item -ItemType Directory -Path '$env:USERPROFILE\.gemini\antigravity\scratch\model\Quin-Iu-Mthu' -Force",
                        "",
                        "2. Tải và chạy script cài đặt tự động từ GitHub:",
                        "Set-Location '$env:USERPROFILE\.gemini\antigravity\scratch\telegram-remote-coder'",
                        "git clone https://github.com/letrungquangm-alt/Quin-Iu-Mthu-Code-mobile.git .",
                        "powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -BotToken '$bToken' -GeminiKey '$gKey' -GhToken '$ghTok' -VercelToken '$vTok' -VercelTeam '$vTeam'",
                        "",
                        "3. Sau khi chạy xong, hãy xác nhận hệ thống đã kết nối đồng bộ sẵn sàng với Telegram của tôi!",
                        "──────────────────────"
                    ) -join "`n"
                    
                    Send-TelegramMessage -chatId $chatId -text $installGuide
                    continue
                }
                elseif ($text -match '(?i)^(push|push github|đẩy code|day code|/push)$') {
                    $guide = @(
                        "🚀 HƯỚNG DẪN PUSH CODE LÊN GITHUB:",
                        "",
                        "Để đẩy mã nguồn lên https://github.com/letrungquangm-alt/Quin-Iu-Mthu-Code-mobile, GitHub yêu cầu cấp quyền:",
                        "",
                        "1. Mở: https://github.com/settings/tokens/new",
                        "2. Mục Note gõ: bot",
                        "3. Tích chọn ô: repo",
                        "4. Bấm 'Generate token' ở cuối trang",
                        "5. Copy mã (bắt đầu bằng ghp_...) và dán thẳng vào Telegram này!",
                        "",
                        "Bot sẽ tự động đẩy code lên ngay lập tức!"
                    ) -join "`n"
                    Send-TelegramMessage -chatId $chatId -text $guide
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
                                elseif ($text -match '^(?i)(/start|start|/menu|menu|hiện menu|hien menu|mở menu|mo menu|xem menu|project|dự án|du an)$') {
                    Show-ProjectMenu -chatId $chatId
                    continue
                }
                elseif ($text -match '^(?i)(/model|model|chọn model|chon model|/settings|cài đặt|cai dat)$') {
                    Show-ModelMenu -chatId $chatId
                    continue
                }
                elseif ($text -match '(?i)(tạo project mới|tao project moi|tạo project|tao project|new project)\s*[:=]?\s*([a-zA-Z0-9_\-]+)?') {
                    $pName = $matches[2]
                    if ([string]::IsNullOrWhiteSpace($pName)) {
                        $global:waitingForNewProjectName = $true
                        Send-TelegramMessage -chatId $chatId -text "✨ Bạn hãy nhập tên Project muốn tạo (ví dụ: game_caro, website_shop, discord_bot...):"
                    } else {
                        $newProjPath = Join-Path $projectsRootDir $pName
                        if (-not (Test-Path $newProjPath)) { New-Item -ItemType Directory -Path $newProjPath -Force | Out-Null }
                        $currentProject = $pName
                        $currentProjectPath = $newProjPath
                        $config.CURRENT_PROJECT = $pName
                        $config.CURRENT_PROJECT_PATH = $newProjPath
                        $config | ConvertTo-Json | Set-Content $configPath -Encoding UTF8
                        Send-TelegramMessage -chatId $chatId -text "✨ Đã tạo project: $pName thành công!`nĐường dẫn: $newProjPath"
                        Show-ModelMenu -chatId $chatId
                    }
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
        Process-PendingMediaGroups
    }
    catch {
        Write-Host "Lỗi kết nối Telegram: $_" -ForegroundColor DarkGray
        Start-Sleep -Seconds 2
    }
}
