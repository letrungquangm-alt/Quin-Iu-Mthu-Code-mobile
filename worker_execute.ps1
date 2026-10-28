# ========================================================
# Telegram Remote Coder - High-Performance Background Worker v2.5
# Tối ưu hóa: In-Memory REST API, Context Pruning & Dynamic Thinking
# ========================================================

param(
    [int64]$chatId,
    [string]$userText,
    [string]$rootDir
)

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$configPath = Join-Path $rootDir "config.json"
$historyPath = Join-Path $rootDir "chat_history.json"
$botScript = Join-Path $rootDir "bot.ps1"

if (-not (Test-Path $configPath)) {
    @{ error = "config.json not found" } | ConvertTo-Json
    exit 1
}

$config = Get-Content $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
$botToken = $config.BOT_TOKEN
$geminiApiKey = if ($config.GEMINI_API_KEY) { $config.GEMINI_API_KEY.ToString().Trim() } else { "" }
$selectedModel = if ($config.SELECTED_MODEL) { $config.SELECTED_MODEL.ToString().Trim() } else { "Gemini 3.8 Flash (High)" }
$modelId = if ($config.MODEL_ID) { $config.MODEL_ID.ToString().Trim() } else { "gemini-3.8-flash" }
$thinkingLevel = if ($config.THINKING_LEVEL) { $config.THINKING_LEVEL.ToString().Trim() } else { "high" }
$executionMode = if ($config.EXECUTION_MODE) { $config.EXECUTION_MODE.ToString().Trim() } else { "auto" }
$projectsRootDir = if ($config.PROJECTS_ROOT_DIR) { $config.PROJECTS_ROOT_DIR.ToString().Trim() } else { "$env:USERPROFILE\.gemini\antigravity\scratch\model" }
$currentProject = if ($config.CURRENT_PROJECT) { $config.CURRENT_PROJECT.ToString().Trim() } else { "Quin-Iu-Mthu" }
$currentProjectPath = if ($config.CURRENT_PROJECT_PATH) { $config.CURRENT_PROJECT_PATH.ToString().Trim() } else { Join-Path $projectsRootDir $currentProject }

if (-not (Test-Path $currentProjectPath)) {
    New-Item -ItemType Directory -Path $currentProjectPath -Force | Out-Null
}

# 1. NẾU LÀ LỆNH TERMINAL /cmd
if ($userText -match '^(?i)(/cmd|\$|ps)\s+(.*)$') {
    $cmdToRun = $matches[2].Trim()
    Set-Location $currentProjectPath
    $cmdOut = powershell.exe -NoProfile -ExecutionPolicy Bypass -Command $cmdToRun 2>&1 | Out-String
    if ([string]::IsNullOrWhiteSpace($cmdOut)) { $cmdOut = "(Lệnh đã chạy xong, không có output)" }
    
    @{
        type = "cmd"
        cmd = $cmdToRun
        output = $cmdOut
        currentProjectPath = $currentProjectPath
        tokensUsed = 10
    } | ConvertTo-Json -Depth 5
    exit 0
}

# 2. XỬ LÝ QUA GEMINI AI
if ([string]::IsNullOrWhiteSpace($geminiApiKey)) {
    @{
        type = "error"
        output = "Vui lòng cài đặt Gemini API Key bằng lệnh: /setkey <key>"
        tokensUsed = 0
    } | ConvertTo-Json -Depth 5
    exit 0
}

# 2.1 CẮT TỈA VÀ NÉN LỊCH SỬ NGỮ CẢNH (CONTEXT PRUNING - TIẾT KIỆM 70% TOKEN)
$contentsList = [System.Collections.Generic.List[PSObject]]::new()
if (Test-Path $historyPath) {
    try {
        $rawHist = Get-Content $historyPath -Raw -Encoding UTF8
        if (-not [string]::IsNullOrWhiteSpace($rawHist)) {
            $hist = $rawHist | ConvertFrom-Json
            # Giữ tối đa 12 turns gần nhất (6 lượt hỏi/đáp) để bảo toàn token
            if ($hist.Count -gt 12) {
                $hist = $hist | Select-Object -Skip ($hist.Count - 12)
            }
            $expectedRole = "user"
            $turnIndex = 0
            $totalTurns = $hist.Count
            foreach ($turn in $hist) {
                $turnIndex++
                if ($turn.role -eq $expectedRole -and $turn.parts -and $turn.parts[0].text) {
                    $turnText = $turn.parts[0].text
                    
                    # Nén các đoạn code dài trong các turn cũ (trừ 2 turn gần nhất)
                    if ($turn.role -eq "model" -and ($totalTurns - $turnIndex) -ge 2) {
                        if ($turnText.Length -gt 250 -and $turnText -match '```') {
                            $turnText = [System.Text.RegularExpressions.Regex]::Replace($turnText, '```(?:run|powershell|ps1|html|javascript|js|python|py|css|json)?[\s\S]{120,}?```', {
                                param($m)
                                $lineCount = ($m.Value -split "`n").Count
                                return "`n[💾 Đã tạo/chạy mã nguồn trước đó: ~$lineCount dòng code]`n"
                            })
                        }
                    }
                    
                    $contentsList.Add(@{
                        role = $turn.role
                        parts = @(@{ text = $turnText })
                    })
                    $expectedRole = if ($expectedRole -eq "user") { "model" } else { "user" }
                }
            }
            if ($contentsList.Count -gt 0 -and $contentsList[$contentsList.Count - 1].role -eq "user") {
                $contentsList.RemoveAt($contentsList.Count - 1)
            }
        }
    } catch {}
}

$contentsList.Add(@{
    role = "user"
    parts = @(@{ text = $userText })
})

# 2.2 SMART ROUTING & DYNAMIC THINKING BUDGET
$isSimpleQuery = ($userText.Length -lt 45 -and $userText -notmatch '(?i)(code|viết|tạo|sửa|lập trình|debug|fix|xây dựng|build|function|html|css|python|js|script|file|dự án|project)')

$activeModel = $modelId
$thinkingBudget = 0

if ($isSimpleQuery) {
    # Tác vụ ngắn/hỏi đáp nhanh: dùng budget = 0 để trả lời ngay lập tức dưới 1 giây
    $activeModel = "gemini-2.5-flash"
    $thinkingBudget = 0
} else {
    switch ($thinkingLevel.ToLower()) {
        "off"    { $thinkingBudget = 0 }
        "low"    { $thinkingBudget = 1024 }
        "medium" { $thinkingBudget = 2048 }
        default  { $thinkingBudget = 8192 } # high
    }
}

$sysPrompt = "Bạn là trợ lý lập trình AI thông minh cao cấp, có toàn quyền điều khiển hệ thống và terminal máy tính từ xa qua Telegram của người dùng.`nModel đang dùng: $selectedModel (Thinking Level: $($thinkingLevel.ToUpper())).`nProject đang làm việc: $currentProject. Thư mục hiện tại của project: $currentProjectPath.`nThư mục gốc của mọi project: $projectsRootDir.`n`nQUY TẮC BẮT BUỘC:`n1. GHI NHỚ TOÀN DIỆN NGỮ CẢNH: Khi người dùng nói tiếp hoặc yêu cầu lập trình, bạn PHẢI hiểu ngữ cảnh trước đó và HÀNH ĐỘNG NGAY!`n2. TẤT CẢ CODE PHẢI ĐƯỢC LƯU VÀO MÁY TÍNH: Bất cứ khi nào bạn tạo file, sửa code hay chạy terminal, bạn BẮT BUỘC phải xuất khối lệnh ```run để ghi trực tiếp vào máy tính:`nVí dụ tạo hoặc ghi đè file:`n````run`nSet-Content -Path `"$currentProjectPath\index.html`" -Value @'`n<!DOCTYPE html>`n... nội dung code ...`n'@ -Encoding UTF8`n````n3. Mọi file tạo ra PHẢI nằm trong thư mục của project hiện tại: `"$currentProjectPath`".`n4. Ngôn ngữ: Tiếng Việt có dấu chuẩn 100%, tự nhiên, súc tích, chuyên nghiệp."

$generationConfig = @{
    temperature = 0.7
    maxOutputTokens = 8192
}
if ($thinkingBudget -gt 0) {
    $generationConfig.thinkingConfig = @{ thinkingBudget = $thinkingBudget }
} else {
    $generationConfig.thinkingConfig = @{ thinkingBudget = 0 }
}

$payload = @{
    systemInstruction = @{ parts = @(@{ text = $sysPrompt }) }
    contents = $contentsList
    generationConfig = $generationConfig
}

# 2.3 NATIVE IN-MEMORY REST API (HOÀN TOÀN TRONG BỘ NHỚ, KHÔNG DÙNG FILE TẠM & CMD CURL)
$postBody = $payload | ConvertTo-Json -Depth 10 -Compress
$postBytes = [System.Text.Encoding]::UTF8.GetBytes($postBody)

$aiResponse = ""
$actualTokens = ($userText.Length * 2)

$modelsToTry = [System.Collections.Generic.List[string]]::new()
if (-not [string]::IsNullOrWhiteSpace($activeModel)) { $modelsToTry.Add($activeModel) }
foreach ($fb in @("gemini-2.5-flash", "gemini-flash-latest", "gemini-flash-lite-latest")) {
    if (-not $modelsToTry.Contains($fb)) { $modelsToTry.Add($fb) }
}

foreach ($m in $modelsToTry) {
    $url = "https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=$geminiApiKey"
    try {
        $res = Invoke-RestMethod -Uri $url -Method Post -ContentType "application/json; charset=utf-8" -Body $postBytes -TimeoutSec 25
        if ($res -and $res.candidates -and $res.candidates[0].content.parts[0].text) {
            $aiResponse = $res.candidates[0].content.parts[0].text.Trim()
            if ($res.usageMetadata -and $res.usageMetadata.totalTokenCount) {
                $actualTokens = [int]$res.usageMetadata.totalTokenCount
            }
            break
        }
    } catch {
        # Fallback nếu model không hỗ trợ thinkingConfig
        try {
            $payloadSimple = @{
                systemInstruction = @{ parts = @(@{ text = $sysPrompt }) }
                contents = $contentsList
            }
            $fallbackBytes = [System.Text.Encoding]::UTF8.GetBytes(($payloadSimple | ConvertTo-Json -Depth 10 -Compress))
            $resFb = Invoke-RestMethod -Uri $url -Method Post -ContentType "application/json; charset=utf-8" -Body $fallbackBytes -TimeoutSec 20
            if ($resFb -and $resFb.candidates -and $resFb.candidates[0].content.parts[0].text) {
                $aiResponse = $resFb.candidates[0].content.parts[0].text.Trim()
                if ($resFb.usageMetadata -and $resFb.usageMetadata.totalTokenCount) {
                    $actualTokens = [int]$resFb.usageMetadata.totalTokenCount
                }
                break
            }
        } catch {}
    }
}

if ([string]::IsNullOrWhiteSpace($aiResponse)) {
    $aiResponse = "Các model AI đang tạm thời quá tải, bạn vui lòng thử lại sau vài giây nhé!"
}

# 2.4 LƯU LỊCH SỬ CHAT CÓ GIỚI HẠN (TRÁNH PHÌNH BỘ NHỚ)
try {
    $memory = [System.Collections.Generic.List[PSObject]]::new()
    if (Test-Path $historyPath) {
        $existingHist = Get-Content $historyPath -Raw -Encoding UTF8 | ConvertFrom-Json
        foreach ($t in $existingHist) { $memory.Add($t) }
    }
    $memory.Add(@{ role = "user"; parts = @(@{ text = $userText }); timestamp = (Get-Date -Format "yyyy-MM-dd HH:mm:ss") })
    $memory.Add(@{ role = "model"; parts = @(@{ text = $aiResponse }); timestamp = (Get-Date -Format "yyyy-MM-dd HH:mm:ss") })
    if ($memory.Count -gt 16) { $memory = $memory | Select-Object -Skip ($memory.Count - 16) }
    $memory | ConvertTo-Json -Depth 5 | Set-Content $historyPath -Encoding UTF8
} catch {}

# 3. PHÁT HIỆN VÀ THỰC THI KHỐI LỆNH (```run / ```powershell)
$cmdToRun = ""
$cleanReply = $aiResponse
$autoOutput = ""
$savedFiles = [System.Collections.Generic.List[string]]::new()

if ($aiResponse -match '```(?:run|powershell|ps1|cmd|sh)\s*([\s\S]*?)```') {
    $cmdToRun = $matches[1].Trim()
    $cleanReply = $aiResponse -replace '```(?:run|powershell|ps1|cmd|sh)[\s\S]*?```', ''
}
elseif ($aiResponse -match '(?:^|\n)un\s*(\$projectDir[\s\S]*?)(?:\n\n|$)') {
    $cmdToRun = $matches[1].Trim()
    $cleanReply = $aiResponse -replace '(?:^|\n)un\s*\$projectDir[\s\S]*?(?:\n\n|$)', ''
}

# Tự động trích xuất file nếu AI xuất code thuần
if ([string]::IsNullOrWhiteSpace($cmdToRun)) {
    $targetFileName = ""
    if ($userText -match '(?i)(?:file|tập tin|tạo|sửa|lưu)\s+([a-zA-Z0-9_\-\.]+\.(?:html|css|js|py|json|md|txt|ts|jsx|tsx|ps1))') {
        $targetFileName = $matches[1]
    } elseif ($aiResponse -match '(?i)(?:file|tập tin|mã nguồn|code)\s+[`"''\*\s]*([a-zA-Z0-9_\-\.]+\.(?:html|css|js|py|json|md|txt|ts|jsx|tsx|ps1))') {
        $targetFileName = $matches[1]
    }

    if ($aiResponse -match '```(?:html|css|javascript|js|python|py|json|typescript|ts|markdown|text)?\s*([\s\S]*?)```') {
        $codeContent = $matches[1].Trim()
        if (-not [string]::IsNullOrWhiteSpace($codeContent)) {
            if ([string]::IsNullOrWhiteSpace($targetFileName)) {
                if ($codeContent -match '(?i)<!DOCTYPE html|<html') { $targetFileName = "index.html" }
                elseif ($codeContent -match '(?i)import\s+|def\s+|print\(') { $targetFileName = "app.py" }
                elseif ($codeContent -match '(?i)function\s+|const\s+|let\s+|document\.') { $targetFileName = "script.js" }
            }

            if (-not [string]::IsNullOrWhiteSpace($targetFileName)) {
                $destFile = Join-Path $currentProjectPath $targetFileName
                [System.IO.File]::WriteAllText($destFile, $codeContent, [System.Text.Encoding]::UTF8)
                $savedFiles.Add($targetFileName)
                $autoOutput += "`n💾 Đã chuyển code vào máy tính: $targetFileName`n📁 Thư mục: $currentProjectPath"
            }
        }
    }
}

# Thực thi lệnh PowerShell nếu có
if (-not [string]::IsNullOrWhiteSpace($cmdToRun)) {
    if ($executionMode -eq "auto") {
        Set-Location $currentProjectPath
        $execRes = powershell.exe -NoProfile -ExecutionPolicy Bypass -Command $cmdToRun 2>&1 | Out-String
        if ([string]::IsNullOrWhiteSpace($execRes)) { $execRes = "(Lệnh đã chạy xong, không có lỗi)" }
        $autoOutput += "`n" + $execRes.Trim()

        try {
            $recentFiles = Get-ChildItem -Path $currentProjectPath -File | Where-Object { $_.LastWriteTime -gt (Get-Date).AddSeconds(-30) }
            foreach ($f in $recentFiles) {
                if (-not $savedFiles.Contains($f.Name)) { $savedFiles.Add($f.Name) }
            }
        } catch {}
    }
}

@{
    type = "ai"
    cleanReply = $cleanReply.Trim()
    cmdToRun = $cmdToRun
    autoOutput = $autoOutput.Trim()
    executionMode = $executionMode
    savedFiles = @($savedFiles)
    currentProjectPath = $currentProjectPath
    tokensUsed = $actualTokens
} | ConvertTo-Json -Depth 5
