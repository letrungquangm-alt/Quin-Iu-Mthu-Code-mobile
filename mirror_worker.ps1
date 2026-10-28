# ========================================================
# Telegram Remote Coder - Live Activity Mirror Worker v2.6
# Chữ có màu thật (Diff Syntax: + Xanh lá, ! Cam, - Đỏ)
# Đồng hồ bấm giây live cho mọi khoảng lặng & Nhận diện ĐÃ ĐỌC PROMPT
# ========================================================

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$rootDir = $PSScriptRoot
$configPath = Join-Path $rootDir "config.json"
$syncBridgePath = Join-Path $rootDir "sync_bridge.json"

if (-not (Test-Path $configPath)) {
    exit 1
}

$config = Get-Content $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
$botToken = $config.BOT_TOKEN
$chatId = [int64]$config.ALLOWED_CHAT_ID

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

function Send-TgLiveStatus {
    param([string]$text, [string]$parseMode = "HTML")
    if ([string]::IsNullOrWhiteSpace($text)) { return $null }
    # Không cắt bớt tin nhắn - tự động chia phần

    $url = "https://api.telegram.org/bot$botToken/sendMessage"
    $bodyObj = @{
        chat_id = $chatId
        text = $text
        disable_web_page_preview = $true
    }
    if ($parseMode) { $bodyObj["parse_mode"] = $parseMode }
    $jsonBody = $bodyObj | ConvertTo-Json -Compress
    try {
        $res = Invoke-RestMethod -Uri $url -Method Post -ContentType "application/json; charset=utf-8" -Body ([System.Text.Encoding]::UTF8.GetBytes($jsonBody)) -TimeoutSec 10
        if ($res.ok -and $res.result) {
            return [int]$res.result.message_id
        }
    } catch {
        if ($parseMode) {
            try {
                $bodyObj.Remove("parse_mode")
                $plainBody = $bodyObj | ConvertTo-Json -Compress
                $res = Invoke-RestMethod -Uri $url -Method Post -ContentType "application/json; charset=utf-8" -Body ([System.Text.Encoding]::UTF8.GetBytes($plainBody)) -TimeoutSec 10
                if ($res.ok -and $res.result) { return [int]$res.result.message_id }
            } catch {}
        }
    }
    return $null
}

function Delete-TgMessage {
    param([int]$messageId)
    if (-not $messageId) { return }
    $url = "https://api.telegram.org/bot$botToken/deleteMessage"
    $bodyObj = @{ chat_id = $chatId; message_id = $messageId }
    $jsonBody = $bodyObj | ConvertTo-Json -Compress
    try {
        Invoke-RestMethod -Uri $url -Method Post -ContentType "application/json; charset=utf-8" -Body ([System.Text.Encoding]::UTF8.GetBytes($jsonBody)) -TimeoutSec 5 | Out-Null
    } catch {}
}

function Edit-TgMessage {
    param([int]$messageId, [string]$text, [string]$parseMode = "HTML")
    if (-not $messageId -or [string]::IsNullOrWhiteSpace($text)) { return }
    $url = "https://api.telegram.org/bot$botToken/editMessageText"
    $bodyObj = @{
        chat_id = $chatId
        message_id = $messageId
        text = $text
        disable_web_page_preview = $true
    }
    if ($parseMode) { $bodyObj["parse_mode"] = $parseMode }
    $jsonBody = $bodyObj | ConvertTo-Json -Compress
    try {
        Invoke-RestMethod -Uri $url -Method Post -ContentType "application/json; charset=utf-8" -Body ([System.Text.Encoding]::UTF8.GetBytes($jsonBody)) -TimeoutSec 5 | Out-Null
    } catch {
        if ($parseMode) {
            try {
                $bodyObj.Remove("parse_mode")
                $plainBody = $bodyObj | ConvertTo-Json -Compress
                Invoke-RestMethod -Uri $url -Method Post -ContentType "application/json; charset=utf-8" -Body ([System.Text.Encoding]::UTF8.GetBytes($plainBody)) -TimeoutSec 5 | Out-Null
            } catch {}
        }
    }
}

function Set-SyncBridgeWorkingStatus {
    param([bool]$working)
    if (Test-Path $syncBridgePath) {
        try {
            $br = Get-Content $syncBridgePath -Raw -Encoding UTF8 | ConvertFrom-Json
            $br | Add-Member -NotePropertyName "isWorking" -NotePropertyValue $working -Force
            $br | ConvertTo-Json -Depth 5 | Set-Content $syncBridgePath -Encoding UTF8
        } catch {}
    }
}

function Finish-PromptReadingStatus {
    if (Test-Path $syncBridgePath) {
        try {
            $br = Get-Content $syncBridgePath -Raw -Encoding UTF8 | ConvertFrom-Json
            if ($br.promptReadingMsgId -and $br.promptReadingStart) {
                $pStart = [DateTime]::Parse($br.promptReadingStart)
                $readSec = [math]::Max(1, [int]([DateTime]::Now - $pStart).TotalSeconds)
                $pPrev = if ($br.promptReadingPreview) { [System.Net.WebUtility]::HtmlEncode($br.promptReadingPreview) } else { "" }
                Edit-TgMessage -messageId ([int]$br.promptReadingMsgId) -text "✅ <b>[ĐÃ ĐỌC XONG PROMPT - ${readSec}s]</b>`n<blockquote expandable><i>`"$pPrev`"</i></blockquote>"
                
                $br.promptReadingMsgId = $null
                $br.promptReadingStart = $null
                $br.promptReadingPreview = $null
                $br | ConvertTo-Json -Depth 5 | Set-Content $syncBridgePath -Encoding UTF8
            }
        } catch {}
    }
}

# Quản lý danh sách file đã biết trong project để phân biệt chính xác Tạo mới vs Sửa cũ
$projectKnownFiles = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)

function Index-ExistingFiles {
    param([string]$dir)
    if (Test-Path $dir) {
        try {
            Get-ChildItem -Path $dir -Recurse -File -ErrorAction SilentlyContinue | ForEach-Object {
                [void]$projectKnownFiles.Add($_.FullName)
                [void]$projectKnownFiles.Add($_.Name)
            }
        } catch {}
    }
}

# Nạp các file đã có trong workspace & scratch
Index-ExistingFiles -dir $rootDir
$modelDir = if ($config.PROJECTS_ROOT_DIR) { $config.PROJECTS_ROOT_DIR } else { "$env:USERPROFILE\.gemini\antigravity\scratch\model" } 
Index-ExistingFiles -dir $modelDir

# Lấy ID phiên làm việc Antigravity hiện tại
$conversationId = "7f7131ce-dc72-490f-97bd-4a675f9dd0c7"
if (Test-Path $syncBridgePath) {
    try {
        $bridge = Get-Content $syncBridgePath -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($bridge.conversationId) { $conversationId = $bridge.conversationId }
    } catch {}
}

$transcriptPath = "$env:USERPROFILE\.gemini\antigravity\brain\$conversationId\.system_generated\logs\transcript.jsonl"

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host " Live Mirror Worker v2.6 (Diff Colors & Live Timers) đang chạy..." -ForegroundColor Cyan
Write-Host " Theo dõi transcript: $transcriptPath" -ForegroundColor DarkCyan
Write-Host "==========================================================" -ForegroundColor Cyan

# Bắt đầu theo dõi từ cuối file hiện tại (không đọc lặp lại lệnh cũ)
$lastByteOffset = 0
if (Test-Path $transcriptPath) {
    try {
        $fileInfo = Get-Item $transcriptPath -ErrorAction SilentlyContinue
        if ($fileInfo) {
            $lastByteOffset = $fileInfo.Length
            Write-Host "Bắt đầu theo dõi từ byte offset: $lastByteOffset" -ForegroundColor Yellow
        }
    } catch {}
}

# Danh sách lưu các Message ID tạm thời trong lượt Working hiện tại (sẽ xóa sạch khi xong)
$tempWorkingMsgIds = New-Object System.Collections.Generic.List[int]
$global:mirrorThinkingMsgId = $null
$global:mirrorThinkingStart = $null
$global:lastMirrorSec = 0
$global:lastThinkingSnippet = ""

$global:activeWorkingStart = $null
$global:activeWorkingMsgId = $null
$global:activeWorkingTitle = ""
$global:lastWorkingSec = 0

$global:planningTrackerStart = $null
$global:planningTrackerMsgId = $null
$global:lastPlanningSec = 0

function Start-WorkingTracker {
    param([string]$title)
    if ($global:planningTrackerStart -and $global:planningTrackerMsgId) {
        $pSec = [math]::Max(1, [int]([DateTime]::Now - $global:planningTrackerStart).TotalSeconds)
        Edit-TgMessage -messageId $global:planningTrackerMsgId -text "🧠 <b>[AI ĐÃ XỬ LÝ XONG - ${pSec}s]</b>"
        $global:planningTrackerStart = $null
        $global:planningTrackerMsgId = $null
        $global:lastPlanningSec = 0
    }
    if ($global:activeWorkingStart -and $global:activeWorkingMsgId) {
        $prevSec = [math]::Max(1, [int]([DateTime]::Now - $global:activeWorkingStart).TotalSeconds)
        Edit-TgMessage -messageId $global:activeWorkingMsgId -text "✅ <b>[MÁY TÍNH ĐÃ HOÀN TẤT - ${prevSec}s]</b>`n$($global:activeWorkingTitle)"
    }
    $global:activeWorkingStart = [DateTime]::Now
    $global:lastWorkingSec = 1
    $global:activeWorkingTitle = $title
    $global:activeWorkingMsgId = Send-TgLiveStatus -text "⚡ <b>[MÁY TÍNH ĐANG THỰC HIỆN (1s)...]</b>`n$title"
    if ($global:activeWorkingMsgId) { $tempWorkingMsgIds.Add($global:activeWorkingMsgId) }
}

function Stop-WorkingTracker {
    if ($global:activeWorkingStart -and $global:activeWorkingMsgId) {
        $doneSec = [math]::Max(1, [int]([DateTime]::Now - $global:activeWorkingStart).TotalSeconds)
        Edit-TgMessage -messageId $global:activeWorkingMsgId -text "✅ <b>[MÁY TÍNH ĐÃ HOÀN TẤT - ${doneSec}s]</b>`n$($global:activeWorkingTitle)"
        $global:activeWorkingStart = $null
        $global:activeWorkingMsgId = $null
        $global:lastWorkingSec = 0
    }
}

while ($true) {
    try {
        # 1. Đếm giây liên tục cho Thinking nếu AI đang suy nghĩ
        if ($global:mirrorThinkingStart -and $global:mirrorThinkingMsgId) {
            $currThinkSec = [math]::Max(1, [int]([DateTime]::Now - $global:mirrorThinkingStart).TotalSeconds)
            if ($currThinkSec -ge ($global:lastMirrorSec + 2)) {
                $global:lastMirrorSec = $currThinkSec
                Edit-TgMessage -messageId $global:mirrorThinkingMsgId -text "🧠 <b>[AI ĐANG SUY NGHĨ (${currThinkSec}s)...]</b>$global:lastThinkingSnippet"
            }
        }

        # 2. Đếm giây liên tục cho tác vụ Working đang chạy ngầm trên máy tính (Cập nhật 2s/lần)
        if ($global:activeWorkingStart -and $global:activeWorkingMsgId) {
            $currSec = [math]::Max(1, [int]([DateTime]::Now - $global:activeWorkingStart).TotalSeconds)
            if ($currSec -ge ($global:lastWorkingSec + 2)) {
                $global:lastWorkingSec = $currSec
                Edit-TgMessage -messageId $global:activeWorkingMsgId -text "⚡ <b>[MÁY TÍNH ĐANG THỰC HIỆN (${currSec}s)...]</b>`n$($global:activeWorkingTitle)"
            }
        }

        # 3. Đếm giây liên tục cho khoảng lặng giữa các bước (Planning / Processing)
        if ($global:planningTrackerStart -and $global:planningTrackerMsgId) {
            $currPlanSec = [math]::Max(1, [int]([DateTime]::Now - $global:planningTrackerStart).TotalSeconds)
            if ($currPlanSec -ge ($global:lastPlanningSec + 2)) {
                $global:lastPlanningSec = $currPlanSec
                Edit-TgMessage -messageId $global:planningTrackerMsgId -text "🧠 <b>[AI ĐANG XỬ LÝ BƯỚC TIẾP THEO (${currPlanSec}s)...]</b>"
            }
        }

        if (Test-Path $transcriptPath) {
            $fileInfo = Get-Item $transcriptPath -ErrorAction SilentlyContinue
            if ($fileInfo -and $fileInfo.Length -gt $lastByteOffset) {
                $stream = [System.IO.File]::Open($transcriptPath, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
                [void]$stream.Seek($lastByteOffset, [System.IO.SeekOrigin]::Begin)
                $reader = [System.IO.StreamReader]::new($stream, [System.Text.Encoding]::UTF8)

                while (($line = $reader.ReadLine()) -ne $null) {
                    if ([string]::IsNullOrWhiteSpace($line)) { continue }

                    try {
                        $entry = $line | ConvertFrom-Json

                        # A. BẮT SUY NGHĨ CỦA AI (CHỈ KHI ĐANG SUY NGHĨ THUẦN TÚY, CHƯA CÓ TOOL CALL)
                        if ($entry.thinking -and -not $entry.tool_calls) {
                            Set-SyncBridgeWorkingStatus -working $true
                            Finish-PromptReadingStatus

                            if ($global:planningTrackerStart -and $global:planningTrackerMsgId) {
                                $pSec = [math]::Max(1, [int]([DateTime]::Now - $global:planningTrackerStart).TotalSeconds)
                                Edit-TgMessage -messageId $global:planningTrackerMsgId -text "🧠 <b>[AI ĐÃ XỬ LÝ XONG - ${pSec}s]</b>"
                                $global:planningTrackerStart = $null
                                $global:planningTrackerMsgId = $null
                                $global:lastPlanningSec = 0
                            }

                            $cleanThinking = ""
                            $rawThink = $entry.thinking.ToString().Trim()
                            $thinkLines = $rawThink -split "\r?\n" | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
                            if ($thinkLines.Count -gt 0) {
                                $cleanThinking = ($thinkLines | Select-Object -First 2) -join " "
                                if ($cleanThinking.Length -gt 150) { $cleanThinking = $cleanThinking.Substring(0, 150) + "..." }
                            }
                            $safeThinking = [System.Net.WebUtility]::HtmlEncode($cleanThinking)
                            $global:lastThinkingSnippet = if ($safeThinking) { "`n<blockquote expandable>💭 `"$safeThinking`"</blockquote>" } else { "" }

                            if (-not $global:mirrorThinkingStart) {
                                $global:mirrorThinkingStart = [DateTime]::Now
                                $global:lastMirrorSec = 1
                                $global:mirrorThinkingMsgId = Send-TgLiveStatus -text "🧠 <b>[AI ĐANG SUY NGHĨ (1s)...]</b>$global:lastThinkingSnippet"
                                if ($global:mirrorThinkingMsgId) { $tempWorkingMsgIds.Add($global:mirrorThinkingMsgId) }
                            }
                        }

                        # B. BẮT TRẠNG THÁI WORKING / TOOL CALLS (CHỮ CÓ MÀU: + XANH LÁ, ! CAM, - ĐỎ)
                        if ($entry.tool_calls) {
                            Set-SyncBridgeWorkingStatus -working $true
                            Finish-PromptReadingStatus

                            if ($global:mirrorThinkingStart -and $global:mirrorThinkingMsgId) {
                                $elapsedSec = [math]::Max(1, [int]([DateTime]::Now - $global:mirrorThinkingStart).TotalSeconds)
                                Edit-TgMessage -messageId $global:mirrorThinkingMsgId -text "🧠 <b>[AI ĐÃ SUY NGHĨ XONG - ${elapsedSec}s]</b>"
                                $global:mirrorThinkingStart = $null
                                $global:mirrorThinkingMsgId = $null
                                $global:lastMirrorSec = 0
                            }

                            if ($global:planningTrackerStart -and $global:planningTrackerMsgId) {
                                $pSec = [math]::Max(1, [int]([DateTime]::Now - $global:planningTrackerStart).TotalSeconds)
                                Edit-TgMessage -messageId $global:planningTrackerMsgId -text "🧠 <b>[AI ĐÃ XỬ LÝ XONG - ${pSec}s]</b>"
                                $global:planningTrackerStart = $null
                                $global:planningTrackerMsgId = $null
                                $global:lastPlanningSec = 0
                            }

                            foreach ($tc in $entry.tool_calls) {
                                $toolName = $tc.name
                                $rawSummary = if ($tc.args.toolSummary) { $tc.args.toolSummary.ToString().Trim('"', ' ') } else { "" }
                                $actionSummary = ""
                                $actionDetailHtml = ""

                                if ($toolName -eq "run_command") {
                                    $cmd = if ($tc.args.CommandLine) { $tc.args.CommandLine.ToString().Trim('"', ' ') } else { "" }
                                    $displayCmd = if ($cmd.Length -gt 250) { $cmd.Substring(0, 250) + "... [dài]" } else { $cmd }
                                    $safeCmd = [System.Net.WebUtility]::HtmlEncode($displayCmd)

                                    # Nếu là thao tác XÓA FILE -> Chữ màu ĐỎ rực rỡ (-)
                                    if ($cmd -match "(?i)(Remove-Item|rm\s+|del\s+|rmdir|unlink)") {
                                        $actionSummary = if ($rawSummary) { $rawSummary } else { "Xóa file / thư mục" }
                                        $actionDetailHtml = "<pre><code class=""language-diff"">- [XÓA FILE / THƯ MỤC] $safeCmd</code></pre>"
                                    } else {
                                        $actionSummary = if ($rawSummary) { $rawSummary } else { "Chạy lệnh hệ thống" }
                                        $actionDetailHtml = "▶️ <b>Lệnh:</b> <pre><code class=""language-powershell"">$safeCmd</code></pre>"
                                    }
                                }
                                elseif ($toolName -eq "edit_file") {
                                    $rawPath = if ($tc.args.Path) { $tc.args.Path.ToString().Trim('"', ' ') } else { "file" }
                                    $fileName = Split-Path $rawPath -Leaf

                                    $linesRemoved = 0
                                    $linesAdded = 0
                                    if ($tc.args.Target) {
                                        $linesRemoved = ($tc.args.Target.ToString() -split "\r?\n").Count
                                    }
                                    if ($tc.args.Replacement) {
                                        $linesAdded = ($tc.args.Replacement.ToString() -split "\r?\n").Count
                                    }
                                    if ($linesRemoved -eq 0) { $linesRemoved = 1 }

                                    [void]$projectKnownFiles.Add($rawPath)
                                    [void]$projectKnownFiles.Add($fileName)

                                    # SỬA FILE CŨ -> Chữ màu CAM / VÀNG (!)
                                    $actionSummary = if ($rawSummary) { $rawSummary } else { "Chỉnh sửa code $fileName" }
                                    $actionDetailHtml = "<pre><code class=""language-diff"">! [SỬA FILE CŨ] $fileName (+$linesAdded dòng thêm / -$linesRemoved dòng sửa)</code></pre>"
                                }
                                elseif ($toolName -eq "write_file") {
                                    $rawPath = if ($tc.args.Path) { $tc.args.Path.ToString().Trim('"', ' ') } else { "file" }
                                    $fileName = Split-Path $rawPath -Leaf
                                    $isOverwrite = ($tc.args.Overwrite -eq $true -or $tc.args.Overwrite -eq "true")
                                    $isAppend = ($tc.args.Append -eq $true -or $tc.args.Append -eq "true")

                                    $contentLines = 0
                                    if ($tc.args.Content) {
                                        $contentLines = ($tc.args.Content.ToString() -split "\r?\n").Count
                                    }

                                    $isExisted = $isOverwrite -or $isAppend -or ($projectKnownFiles.Contains($rawPath)) -or ($projectKnownFiles.Contains($fileName)) -or (Test-Path $rawPath)

                                    if ($isExisted) {
                                        $oldLineCount = 0
                                        if (Test-Path $rawPath) {
                                            try {
                                                $oldLineCount = (Get-Content $rawPath -Encoding UTF8 -ErrorAction SilentlyContinue).Count
                                            } catch {}
                                        }
                                        if ($oldLineCount -eq 0) {
                                            $oldLineCount = if ($contentLines -gt 0) { $contentLines } else { 1 }
                                        }
                                        $linesRemoved = if ($isAppend) { 0 } else { $oldLineCount }
                                        if ($linesRemoved -eq 0 -and -not $isAppend) { $linesRemoved = 1 }

                                        $linesAdded = $contentLines
                                        $actionSummary = if ($rawSummary) { $rawSummary } else { "Cập nhật file $fileName" }
                                        # SỬA FILE CŨ -> Chữ màu CAM / VÀNG (!)
                                        $actionDetailHtml = "<pre><code class=""language-diff"">! [SỬA FILE CŨ] $fileName (+$linesAdded dòng thêm / -$linesRemoved dòng sửa)</code></pre>"
                                    } else {
                                        [void]$projectKnownFiles.Add($rawPath)
                                        [void]$projectKnownFiles.Add($fileName)
                                        $actionSummary = if ($rawSummary) { $rawSummary } else { "Tạo mới file $fileName" }
                                        # TẠO FILE MỚI -> Chữ màu XANH LÁ CÂY (+)
                                        $actionDetailHtml = "<pre><code class=""language-diff"">+ [TẠO FILE MỚI] $fileName (+$contentLines dòng mới)</code></pre>"
                                    }
                                }
                                elseif ($toolName -eq "read_file") {
                                    $rawPath = if ($tc.args.Path) { $tc.args.Path.ToString().Trim('"', ' ') } else { "file" }
                                    $fileName = Split-Path $rawPath -Leaf
                                    [void]$projectKnownFiles.Add($rawPath)
                                    [void]$projectKnownFiles.Add($fileName)
                                    
                                    $rangeInfo = ""
                                    $sLine = if ($tc.args.StartLine) { $tc.args.StartLine.ToString().Trim('"', ' ') } else { "" }
                                    $eLine = if ($tc.args.EndLine) { $tc.args.EndLine.ToString().Trim('"', ' ') } else { "" }
                                    
                                    if ($sLine -and $eLine) {
                                        $rangeInfo = " (Dòng $sLine - $eLine)"
                                    } elseif ($sLine) {
                                        $rangeInfo = " (Từ dòng $sLine)"
                                    } elseif ($eLine) {
                                        $rangeInfo = " (Đến dòng $eLine)"
                                    } else {
                                        $rangeInfo = " (Đọc toàn bộ file)"
                                    }

                                    $actionSummary = if ($rawSummary) { $rawSummary } else { "Đọc nội dung $fileName" }
                                    $actionDetailHtml = "📄 <b>File:</b> <code>$fileName</code> <i>$rangeInfo</i>"
                                }
                                elseif ($toolName -eq "manage_task") {
                                    $action = if ($tc.args.Action) { $tc.args.Action.ToString().Trim('"', ' ') } else { "" }
                                    $taskId = if ($tc.args.TaskId) { $tc.args.TaskId.ToString().Trim('"', ' ') } else { "" }
                                    $actionSummary = if ($rawSummary) { $rawSummary } else { "Quản lý tác vụ ngầm ($action)" }
                                    $actionDetailHtml = "⚙️ <b>Task:</b> <code>$action $(if ($taskId) { $taskId } else { '' })</code>".Trim()
                                }
                                else {
                                    $actionSummary = if ($rawSummary) { $rawSummary } else { "Thực thi $toolName" }
                                    $actionDetailHtml = "🔧 <b>Công cụ:</b> <code>$toolName</code>"
                                }

                                $safeSummary = [System.Net.WebUtility]::HtmlEncode($actionSummary)
                                $title = "📋 <b>Thao tác:</b> <code>$safeSummary</code>`n$actionDetailHtml"
                                Write-Host "[MIRROR] Tool call: $actionSummary" -ForegroundColor Cyan
                                Start-WorkingTracker -title $title
                            }
                        }
                        # C. BẮT KẾT QUẢ OUTPUT CỦA LỆNH (GENERIC output)
                        elseif ($entry.type -eq "GENERIC" -and $entry.content) {
                            Stop-WorkingTracker
                            $content = $entry.content.ToString()
                            if ($content -match "Command output:\s*([\s\S]*)") {
                                $rawOut = $matches[1].Trim()
                                if ($rawOut -and $rawOut.Length -gt 5) {
                                    $linesOut = $rawOut -split "\r?\n"
                                    $previewLines = $linesOut | Select-Object -First 5
                                    $shortOut = ($previewLines -join "`n").Trim()
                                    if ($linesOut.Count -gt 5) { $shortOut += "`n... [còn $($linesOut.Count - 5) dòng]" }

                                    $safeOut = [System.Net.WebUtility]::HtmlEncode($shortOut)
                                    $outMsg = "📤 <b>[KẾT QUẢ OUTPUT]:</b>`n<pre><code class=""language-powershell"">$safeOut</code></pre>"
                                    Write-Host "[MIRROR] Output captured" -ForegroundColor DarkGreen
                                    $mid = Send-TgLiveStatus -text $outMsg
                                    if ($mid) { $tempWorkingMsgIds.Add($mid) }

                                    # BẮT ĐẦU ĐẾM GIÂY CHO KHOẢNG LẶNG TIẾP THEO (KHÔNG ĐỂ TRỐNG GIÂY NÀO)
                                    $global:planningTrackerStart = [DateTime]::Now
                                    $global:lastPlanningSec = 1
                                    $global:planningTrackerMsgId = Send-TgLiveStatus -text "🧠 <b>[AI ĐANG XỬ LÝ BƯỚC TIẾP THEO (1s)...]</b>"
                                    if ($global:planningTrackerMsgId) { $tempWorkingMsgIds.Add($global:planningTrackerMsgId) }
                                }
                            }
                        }
                        # D. BẮT KẾT QUẢ TRẢ LỜI CUỐI CÙNG (RESPONSE TO USER) -> HOÀN THÀNH LƯỢT WORKING
                        elseif ($entry.type -eq "PLANNER_RESPONSE" -and $entry.content -and -not $entry.tool_calls) {
                            Stop-WorkingTracker
                            Finish-PromptReadingStatus

                            if ($global:planningTrackerStart -and $global:planningTrackerMsgId) {
                                $pSec = [math]::Max(1, [int]([DateTime]::Now - $global:planningTrackerStart).TotalSeconds)
                                Edit-TgMessage -messageId $global:planningTrackerMsgId -text "🧠 <b>[AI ĐÃ XỬ LÝ XONG - ${pSec}s]</b>"
                                $global:planningTrackerStart = $null
                                $global:planningTrackerMsgId = $null
                                $global:lastPlanningSec = 0
                            }

                            if ($global:mirrorThinkingStart -and $global:mirrorThinkingMsgId) {
                                $elapsedSec = [math]::Max(1, [int]([DateTime]::Now - $global:mirrorThinkingStart).TotalSeconds)
                                Edit-TgMessage -messageId $global:mirrorThinkingMsgId -text "🧠 <b>[AI ĐÃ SUY NGHĨ XONG - ${elapsedSec}s]</b>"
                                $global:mirrorThinkingStart = $null
                                $global:mirrorThinkingMsgId = $null
                                $global:lastMirrorSec = 0
                            }
                            $replyText = $entry.content.ToString().Trim()
                            $formattedReply = Convert-MdToTgHtml -text $replyText
                            $chunks = @(Split-TelegramText -text $formattedReply -maxLen 3500)
                            $totalParts = $chunks.Count

                            Write-Host "[MIRROR] Model final response mirrored ($totalParts phần)" -ForegroundColor Magenta
                            for ($pIdx = 0; $pIdx -lt $totalParts; $pIdx++) {
                                $partHeader = if ($totalParts -gt 1) { "<b>[Phần $($pIdx + 1)/$totalParts]</b>`n" } else { "" }
                                $prefix = if ($pIdx -eq 0) { "🤖 <b>[MÁY TÍNH PHẢN HỒI XONG]:</b>`n`n" } else { "" }
                                $partMsg = "$prefix$partHeader$($chunks[$pIdx])"
                                Send-TgLiveStatus -text $partMsg
                                if ($totalParts -gt 1 -and $pIdx -lt ($totalParts - 1)) {
                                    Start-Sleep -Milliseconds 150
                                }
                            }
                            Set-SyncBridgeWorkingStatus -working $false

                            # TỰ ĐỘNG XÓA SẠCH CÁC TIN NHẮN TIẾN TRÌNH TẠM THỜI SAU 3 GIÂY
                            if ($tempWorkingMsgIds.Count -gt 0) {
                                Write-Host "[MIRROR] Đang tự động dọn dẹp $($tempWorkingMsgIds.Count) tin nhắn Working tạm thời sau 3 giây..." -ForegroundColor Yellow
                                Start-Sleep -Seconds 3
                                foreach ($mid in $tempWorkingMsgIds) {
                                    Delete-TgMessage -messageId $mid
                                }
                                $tempWorkingMsgIds.Clear()
                            }
                        }
                    } catch {}
                }
                $lastByteOffset = $stream.Position
                $reader.Dispose()
                $stream.Dispose()
            }
        }
    } catch {
        Start-Sleep -Seconds 1
    }

    Start-Sleep -Milliseconds 400
}