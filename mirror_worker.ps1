# ========================================================
# Telegram Remote Coder - Live Activity Mirror Worker v2.2
# Tự động hiển thị tiến trình: Thinking, Working, Sửa/Tạo file chuẩn quy tắc (+ / -)
# và TỰ ĐỘNG XÓA tin nhắn tạm thời khi câu trả lời hoàn tất!
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
Index-ExistingFiles -dir "C:\Users\Administrator\.gemini\antigravity\scratch\model"

# Lấy ID phiên làm việc Antigravity hiện tại
$conversationId = "ecedb8d9-583d-4320-b8ee-9602abb6b87f"
if (Test-Path $syncBridgePath) {
    try {
        $bridge = Get-Content $syncBridgePath -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($bridge.conversationId) { $conversationId = $bridge.conversationId }
    } catch {}
}

$transcriptPath = "C:\Users\Administrator\.gemini\antigravity\brain\$conversationId\.system_generated\logs\transcript.jsonl"

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host " Live Mirror Worker v2.2 (Thinking & Accurate Diff Stats) đang chạy..." -ForegroundColor Cyan
Write-Host " Theo dõi transcript: $transcriptPath" -ForegroundColor DarkCyan
Write-Host "==========================================================" -ForegroundColor Cyan

# Bỏ qua các dòng cũ trước thời điểm bật
$lastLineIndex = 0
if (Test-Path $transcriptPath) {
    $existing = Get-Content $transcriptPath -Encoding UTF8
    $lastLineIndex = $existing.Count
    Write-Host "Bắt đầu theo dõi từ dòng: $lastLineIndex" -ForegroundColor Yellow
}

$lastReportedCmd = ""
# Danh sách lưu các Message ID tạm thời trong lượt Working hiện tại (sẽ xóa sạch khi xong)
$tempWorkingMsgIds = New-Object System.Collections.Generic.List[int]
$global:mirrorThinkingMsgId = $null
$global:mirrorThinkingStart = $null
$global:lastMirrorSec = 0

while ($true) {
    try {
        if (Test-Path $transcriptPath) {
            # BẮT BUỘC -Encoding UTF8 để tránh lỗi font chữ tiếng Việt (mojibake)
            $allLines = Get-Content $transcriptPath -Encoding UTF8 -ErrorAction SilentlyContinue
            $currentCount = $allLines.Count

            if ($currentCount -gt $lastLineIndex) {
                $newLines = $allLines | Select-Object -Skip $lastLineIndex
                $lastLineIndex = $currentCount

                foreach ($line in $newLines) {
                    if ([string]::IsNullOrWhiteSpace($line)) { continue }

                    try {
                        $entry = $line | ConvertFrom-Json

                        # 1. BẮT SUY NGHĨ CỦA AI (CHẠY THEO GIÂY LIÊN TỤC VÀ KẾT THÚC BẰNG THỜI GIAN/NỘI DUNG)
                        if ($entry.thinking) {
                            Set-SyncBridgeWorkingStatus -working $true
                            if (-not $global:mirrorThinkingStart) {
                                $global:mirrorThinkingStart = [DateTime]::Now
                                $global:lastMirrorSec = 1
                                $global:mirrorThinkingMsgId = Send-TgLiveStatus -text "🧠 AI đang suy nghĩ (1s)..."
                                if ($global:mirrorThinkingMsgId) { $tempWorkingMsgIds.Add($global:mirrorThinkingMsgId) }
                            } else {
                                $elapsedSec = [math]::Max(1, [int]([DateTime]::Now - $global:mirrorThinkingStart).TotalSeconds)
                                if ($elapsedSec -gt $global:lastMirrorSec) {
                                    $global:lastMirrorSec = $elapsedSec
                                    Edit-TgMessage -messageId $global:mirrorThinkingMsgId -text "🧠 AI đang suy nghĩ (${elapsedSec}s)..."
                                }
                            }
                        }

                        # 2. BẮT TRẠNG THÁI WORKING / TOOL CALLS (KẾT THÚC SUY NGHĨ NẾU CÓ)
                        if ($entry.tool_calls) {
                            Set-SyncBridgeWorkingStatus -working $true
                            if ($global:mirrorThinkingStart) {
                                $elapsedSec = [math]::Max(1, [int]([DateTime]::Now - $global:mirrorThinkingStart).TotalSeconds)
                                Edit-TgMessage -messageId $global:mirrorThinkingMsgId -text "🧠 [AI ĐÃ SUY NGHĨ XONG - ${elapsedSec}s]"
                                $global:mirrorThinkingStart = $null
                                $global:mirrorThinkingMsgId = $null
                                $global:lastMirrorSec = 0
                            }
                            foreach ($tc in $entry.tool_calls) {
                                $toolName = $tc.name
                                $summary = if ($tc.args.toolSummary) { $tc.args.toolSummary.ToString().Trim('"', ' ') } else { "" }

                                if ($toolName -eq "run_command") {
                                    $cmd = if ($tc.args.CommandLine) { $tc.args.CommandLine.ToString().Trim('"', ' ') } else { "" }

                                    # Bỏ qua các lệnh nội bộ tự kiểm tra
                                    if ($cmd -like "*transcript.jsonl*" -or $cmd -like "*mirror_worker*") {
                                        continue
                                    }

                                    $displayCmd = if ($cmd.Length -gt 250) { $cmd.Substring(0, 250) + "... [dài]" } else { $cmd }

                                    if ($cmd -ne $lastReportedCmd) {
                                        $lastReportedCmd = $cmd
                                        $msg = @(
                                            "⚡ [MÁY TÍNH ĐANG CHẠY / WORKING]",
                                            "▶️ Lệnh: $displayCmd",
                                            $(if ($summary) { "📋 Thao tác: $summary" } else { "" })
                                        ) -join "`n"

                                        Write-Host "[MIRROR] Tool call: $summary" -ForegroundColor Cyan
                                        $mid = Send-TgLiveStatus -text $msg.Trim()
                                        if ($mid) { $tempWorkingMsgIds.Add($mid) }
                                    }
                                }
                                elseif ($toolName -eq "edit_file") {
                                    $rawPath = if ($tc.args.Path) { $tc.args.Path.ToString().Trim('"', ' ') } else { "file" }
                                    $fileName = Split-Path $rawPath -Leaf

                                    # edit_file luôn là sửa file cũ và luôn có phần code bị xóa/thay thế (dấu -)
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
                                    $actionTag = "[SỬA FILE CŨ]"

                                    $msg = @(
                                        "✍️ [MÁY TÍNH ĐANG THỰC HIỆN / WORKING]",
                                        "📁 File: $fileName $actionTag $diffStat",
                                        $(if ($summary) { "📋 Thao tác: $summary" } else { "" })
                                    ) -join "`n"

                                    Write-Host "[MIRROR] File edit: $fileName $actionTag $diffStat" -ForegroundColor Green
                                    $mid = Send-TgLiveStatus -text $msg.Trim()
                                    if ($mid) { $tempWorkingMsgIds.Add($mid) }
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
                                        # File đã tồn tại -> SỬA FILE CŨ (có dấu trừ: +xxx -yyy)
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
                                    } else {
                                        # File hoàn toàn mới -> TẠO FILE MỚI (+xxx -0)
                                        $diffStat = "(+$contentLines -0)"
                                        $actionTag = "[TẠO FILE MỚI]"
                                        [void]$projectKnownFiles.Add($rawPath)
                                        [void]$projectKnownFiles.Add($fileName)
                                    }

                                    $msg = @(
                                        "✍️ [MÁY TÍNH ĐANG THỰC HIỆN / WORKING]",
                                        "📁 File: $fileName $actionTag $diffStat",
                                        $(if ($summary) { "📋 Thao tác: $summary" } else { "" })
                                    ) -join "`n"

                                    Write-Host "[MIRROR] File write: $fileName $actionTag $diffStat" -ForegroundColor Green
                                    $mid = Send-TgLiveStatus -text $msg.Trim()
                                    if ($mid) { $tempWorkingMsgIds.Add($mid) }
                                }
                                elseif ($toolName -eq "read_file") {
                                    $rawPath = if ($tc.args.Path) { $tc.args.Path.ToString().Trim('"', ' ') } else { "file" }
                                    $fileName = Split-Path $rawPath -Leaf
                                    [void]$projectKnownFiles.Add($rawPath)
                                    [void]$projectKnownFiles.Add($fileName)
                                    
                                    # Xác định đoạn dòng (range) đang được đọc
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

                                    $msg = "📖 [MÁY TÍNH ĐANG ĐỌC FILE / WORKING]`n📄 File: $fileName$rangeInfo"
                                    Write-Host "[MIRROR] Read file: $fileName$rangeInfo" -ForegroundColor DarkGray
                                    $mid = Send-TgLiveStatus -text $msg
                                    if ($mid) { $tempWorkingMsgIds.Add($mid) }
                                }
                            }
                        }
                        # 3. BẮT KẾT QUẢ OUTPUT CỦA LỆNH (GENERIC output)
                        elseif ($entry.type -eq "GENERIC" -and $entry.content) {
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
                        # 4. BẮT KẾT QUẢ TRẢ LỜI CUỐI CÙNG (RESPONSE TO USER) -> HOÀN THÀNH LƯỢT WORKING
                        elseif ($entry.type -eq "PLANNER_RESPONSE" -and $entry.content -and -not $entry.tool_calls) {
                            if ($global:mirrorThinkingStart) {
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

                            # TỰ ĐỘNG XÓA SẠCH CÁC TIN NHẮN TIẾN TRÌNH TẠM THỜI (để giữ box chat Telegram gọn gàng sạch sẽ)
                            if ($tempWorkingMsgIds.Count -gt 0) {
                                Write-Host "[MIRROR] Đang tự động dọn dẹp $($tempWorkingMsgIds.Count) tin nhắn Working tạm thời..." -ForegroundColor Yellow
                                Start-Sleep -Milliseconds 800
                                foreach ($mid in $tempWorkingMsgIds) {
                                    Delete-TgMessage -messageId $mid
                                }
                                $tempWorkingMsgIds.Clear()
                            }
                        }
                    } catch {}
                }
            }
        }
    } catch {
        Start-Sleep -Seconds 1
    }

    Start-Sleep -Milliseconds 500
}