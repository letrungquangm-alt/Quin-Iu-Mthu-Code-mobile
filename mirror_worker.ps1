# ========================================================
# Telegram Remote Coder - Live Activity Mirror Worker v2.3
# Tự động hiển thị tiến trình: Thinking, Working, Sửa/Tạo file chuẩn quy tắc (+ / -)
# Hiển thị trực tiếp toolSummary ngay lập tức, không có khoảng lặng Working!
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

function Send-TgLiveStatus {
    param([string]$text)
    if ([string]::IsNullOrWhiteSpace($text)) { return $null }
    if ($text.Length -gt 3800) { $text = $text.Substring(0, 3800) + "`n`n...[Output đã được rút gọn]" }

    $url = "https://api.telegram.org/bot$botToken/sendMessage"
    $bodyObj = @{
        chat_id = $chatId
        text = $text
        disable_web_page_preview = $true
    }
    $jsonBody = $bodyObj | ConvertTo-Json -Compress
    try {
        $res = Invoke-RestMethod -Uri $url -Method Post -ContentType "application/json; charset=utf-8" -Body ([System.Text.Encoding]::UTF8.GetBytes($jsonBody)) -TimeoutSec 10
        if ($res.ok -and $res.result) {
            return [int]$res.result.message_id
        }
    } catch {}
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
    param([int]$messageId, [string]$text)
    if (-not $messageId -or [string]::IsNullOrWhiteSpace($text)) { return }
    $url = "https://api.telegram.org/bot$botToken/editMessageText"
    $bodyObj = @{
        chat_id = $chatId
        message_id = $messageId
        text = $text
        disable_web_page_preview = $true
    }
    $jsonBody = $bodyObj | ConvertTo-Json -Compress
    try {
        Invoke-RestMethod -Uri $url -Method Post -ContentType "application/json; charset=utf-8" -Body ([System.Text.Encoding]::UTF8.GetBytes($jsonBody)) -TimeoutSec 5 | Out-Null
    } catch {}
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

# Quản lý danh sách file đã biết trong project để phân biệt chính xác Tạo mới (+N -0) vs Sửa cũ (+N -M)
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
Write-Host " Live Mirror Worker v2.3 (Zero-Silence & Live Summaries) đang chạy..." -ForegroundColor Cyan
Write-Host " Theo dõi transcript: $transcriptPath" -ForegroundColor DarkCyan
Write-Host "==========================================================" -ForegroundColor Cyan

# Bắt đầu theo dõi từ cuối file hiện tại (không đọc lặp lại lệnh cũ)
$lastByteOffset = 0
if (Test-Path $transcriptPath) {
    try {
        $fileInfo = Get-Item $transcriptPath -ErrorAction SilentlyContinue
        if ($fileInfo) {
            $lastByteOffset = $fileInfo.Length
            Write-Host "Bắt đầu theo dõi từ byte offset hiện tại: $lastByteOffset" -ForegroundColor Yellow
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

function Start-WorkingTracker {
    param([string]$title)
    if ($global:activeWorkingStart -and $global:activeWorkingMsgId) {
        $prevSec = [math]::Max(1, [int]([DateTime]::Now - $global:activeWorkingStart).TotalSeconds)
        Edit-TgMessage -messageId $global:activeWorkingMsgId -text "✅ [MÁY TÍNH ĐÃ HOÀN TẤT - ${prevSec}s]`n$($global:activeWorkingTitle)"
    }
    $global:activeWorkingStart = [DateTime]::Now
    $global:lastWorkingSec = 1
    $global:activeWorkingTitle = $title
    $global:activeWorkingMsgId = Send-TgLiveStatus -text "⚡ [MÁY TÍNH ĐANG THỰC HIỆN (1s)...]`n$title"
    if ($global:activeWorkingMsgId) { $tempWorkingMsgIds.Add($global:activeWorkingMsgId) }
}

function Stop-WorkingTracker {
    if ($global:activeWorkingStart -and $global:activeWorkingMsgId) {
        $doneSec = [math]::Max(1, [int]([DateTime]::Now - $global:activeWorkingStart).TotalSeconds)
        Edit-TgMessage -messageId $global:activeWorkingMsgId -text "✅ [MÁY TÍNH ĐÃ HOÀN TẤT - ${doneSec}s]`n$($global:activeWorkingTitle)"
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
                Edit-TgMessage -messageId $global:mirrorThinkingMsgId -text "🧠 [AI ĐANG SUY NGHĨ (${currThinkSec}s)]:$global:lastThinkingSnippet"
            }
        }

        # 2. Đếm giây liên tục cho tác vụ Working đang chạy ngầm trên máy tính (Cập nhật 2s/lần)
        if ($global:activeWorkingStart -and $global:activeWorkingMsgId) {
            $currSec = [math]::Max(1, [int]([DateTime]::Now - $global:activeWorkingStart).TotalSeconds)
            if ($currSec -ge ($global:lastWorkingSec + 2)) {
                $global:lastWorkingSec = $currSec
                Edit-TgMessage -messageId $global:activeWorkingMsgId -text "⚡ [MÁY TÍNH ĐANG THỰC HIỆN (${currSec}s)...]`n$($global:activeWorkingTitle)"
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
                            
                            $cleanThinking = ""
                            $rawThink = $entry.thinking.ToString().Trim()
                            $thinkLines = $rawThink -split "\r?\n" | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
                            if ($thinkLines.Count -gt 0) {
                                $cleanThinking = ($thinkLines | Select-Object -First 2) -join " "
                                if ($cleanThinking.Length -gt 150) { $cleanThinking = $cleanThinking.Substring(0, 150) + "..." }
                            }
                            $global:lastThinkingSnippet = if ($cleanThinking) { "`n💭 `"$cleanThinking`"" } else { "" }

                            if (-not $global:mirrorThinkingStart) {
                                $global:mirrorThinkingStart = [DateTime]::Now
                                $global:lastMirrorSec = 1
                                $global:mirrorThinkingMsgId = Send-TgLiveStatus -text "🧠 [AI ĐANG SUY NGHĨ (1s)]:$global:lastThinkingSnippet"
                                if ($global:mirrorThinkingMsgId) { $tempWorkingMsgIds.Add($global:mirrorThinkingMsgId) }
                            }
                        }

                        # B. BẮT TRẠNG THÁI WORKING / TOOL CALLS (HIỂN THỊ NGAY TOOL SUMMARY ĐẦU DÒNG, KHÔNG KHOẢNG LẶNG)
                        if ($entry.tool_calls) {
                            Set-SyncBridgeWorkingStatus -working $true
                            if ($global:mirrorThinkingStart -and $global:mirrorThinkingMsgId) {
                                $elapsedSec = [math]::Max(1, [int]([DateTime]::Now - $global:mirrorThinkingStart).TotalSeconds)
                                Edit-TgMessage -messageId $global:mirrorThinkingMsgId -text "🧠 [AI ĐÃ SUY NGHĨ XONG - ${elapsedSec}s]"
                                $global:mirrorThinkingStart = $null
                                $global:mirrorThinkingMsgId = $null
                                $global:lastMirrorSec = 0
                            }

                            foreach ($tc in $entry.tool_calls) {
                                $toolName = $tc.name
                                $rawSummary = if ($tc.args.toolSummary) { $tc.args.toolSummary.ToString().Trim('"', ' ') } else { "" }
                                $actionSummary = ""
                                $actionDetail = ""

                                if ($toolName -eq "run_command") {
                                    $cmd = if ($tc.args.CommandLine) { $tc.args.CommandLine.ToString().Trim('"', ' ') } else { "" }
                                    $displayCmd = if ($cmd.Length -gt 200) { $cmd.Substring(0, 200) + "... [dài]" } else { $cmd }
                                    $actionSummary = if ($rawSummary) { $rawSummary } else { "Chạy lệnh hệ thống" }
                                    $actionDetail = "▶️ Lệnh: $displayCmd"
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

                                    $diffStat = "(+$linesAdded -$linesRemoved)"
                                    $actionSummary = if ($rawSummary) { $rawSummary } else { "Chỉnh sửa code $fileName" }
                                    $actionDetail = "📁 File: $fileName [SỬA FILE CŨ] $diffStat"
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
                                        $diffStat = "(+$linesAdded -$linesRemoved)"
                                        $actionTag = "[SỬA FILE CŨ]"
                                        $defaultSum = "Cập nhật file $fileName"
                                    } else {
                                        $diffStat = "(+$contentLines -0)"
                                        $actionTag = "[TẠO FILE MỚI]"
                                        $defaultSum = "Tạo mới file $fileName"
                                        [void]$projectKnownFiles.Add($rawPath)
                                        [void]$projectKnownFiles.Add($fileName)
                                    }

                                    $actionSummary = if ($rawSummary) { $rawSummary } else { $defaultSum }
                                    $actionDetail = "📁 File: $fileName $actionTag $diffStat"
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
                                    $actionDetail = "📄 File: $fileName$rangeInfo"
                                }
                                elseif ($toolName -eq "manage_task") {
                                    $action = if ($tc.args.Action) { $tc.args.Action.ToString().Trim('"', ' ') } else { "" }
                                    $taskId = if ($tc.args.TaskId) { $tc.args.TaskId.ToString().Trim('"', ' ') } else { "" }
                                    $actionSummary = if ($rawSummary) { $rawSummary } else { "Quản lý tác vụ ngầm ($action)" }
                                    $actionDetail = "⚙️ Task: $action $(if ($taskId) { $taskId } else { '' })".Trim()
                                }
                                else {
                                    $actionSummary = if ($rawSummary) { $rawSummary } else { "Thực thi $toolName" }
                                    $actionDetail = "🔧 Công cụ: $toolName"
                                }

                                $title = "📋 Thao tác: $actionSummary`n$actionDetail"
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

                                    $outMsg = "📤 [KẾT QUẢ OUTPUT]:`n$shortOut"
                                    Write-Host "[MIRROR] Output captured" -ForegroundColor DarkGreen
                                    $mid = Send-TgLiveStatus -text $outMsg
                                    if ($mid) { $tempWorkingMsgIds.Add($mid) }
                                }
                            }
                        }
                        # D. BẮT KẾT QUẢ TRẢ LỜI CUỐI CÙNG (RESPONSE TO USER) -> HOÀN THÀNH LƯỢT WORKING
                        elseif ($entry.type -eq "PLANNER_RESPONSE" -and $entry.content -and -not $entry.tool_calls) {
                            Stop-WorkingTracker
                            if ($global:mirrorThinkingStart -and $global:mirrorThinkingMsgId) {
                                $elapsedSec = [math]::Max(1, [int]([DateTime]::Now - $global:mirrorThinkingStart).TotalSeconds)
                                Edit-TgMessage -messageId $global:mirrorThinkingMsgId -text "🧠 [AI ĐÃ SUY NGHĨ XONG - ${elapsedSec}s]"
                                $global:mirrorThinkingStart = $null
                                $global:mirrorThinkingMsgId = $null
                                $global:lastMirrorSec = 0
                            }
                            $replyText = $entry.content.ToString().Trim()
                            if ($replyText.Length -gt 3500) {
                                $replyText = $replyText.Substring(0, 3500) + "`n`n... [Xem tiếp trên màn hình máy tính]"
                            }
                            $doneMsg = "🤖 [MÁY TÍNH PHẢN HỒI XONG]:`n`n$replyText"
                            Write-Host "[MIRROR] Model final response mirrored" -ForegroundColor Magenta
                            
                            # Gửi tin nhắn phản hồi chính thức
                            Send-TgLiveStatus -text $doneMsg
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