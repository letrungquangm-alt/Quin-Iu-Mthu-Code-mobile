# ========================================================
# Telegram Remote Coder - Background Task Worker
# Chạy song song độc lập để main thread liên tục nhận getUpdates
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
$projectsRootDir = if ($config.PROJECTS_ROOT_DIR) { $config.PROJECTS_ROOT_DIR.ToString().Trim() } else { "C:\Users\Administrator\.gemini\antigravity\scratch\model" }
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

# Đọc lịch sử ngữ cảnh
$contentsList = [System.Collections.Generic.List[PSObject]]::new()
if (Test-Path $historyPath) {
    try {
        $rawHist = Get-Content $historyPath -Raw -Encoding UTF8
        if (-not [string]::IsNullOrWhiteSpace($rawHist)) {
            $hist = $rawHist | ConvertFrom-Json
            $expectedRole = "user"
            foreach ($turn in $hist) {
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
        }
    } catch {}
}

$contentsList.Add(@{
    role = "user"
    parts = @(@{ text = $userText })
})

$sysPrompt = "Bạn là trợ lý lập trình AI thông minh cao cấp, có toàn quyền điều khiển hệ thống và terminal máy tính từ xa qua Telegram của người dùng.`nModel đang dùng: $selectedModel (Thinking Level: $($thinkingLevel.ToUpper())).`nProject đang làm việc: $currentProject. Thư mục hiện tại của project: $currentProjectPath.`nThư mục gốc của mọi project: $projectsRootDir.`n`nQUY TẮC BẮT BUỘC:`n1. GHI NHỚ TOÀN DIỆN NGỮ CẢNH: Khi người dùng nói tiếp hoặc yêu cầu lập trình, bạn PHẢI hiểu ngữ cảnh trước đó và HÀNH ĐỘNG NGAY!`n2. TẤT CẢ CODE PHẢI ĐƯỢC LƯU VÀO MÁY TÍNH: Bất cứ khi nào bạn tạo file, sửa code hay chạy terminal, bạn BẮT BUỘC phải xuất khối lệnh ```run để ghi trực tiếp vào máy tính:`nVí dụ tạo hoặc ghi đè file:`n````run`nSet-Content -Path `"$currentProjectPath\index.html`" -Value @'`n<!DOCTYPE html>`n... nội dung code ...`n'@ -Encoding UTF8`n````n3. Mọi file tạo ra PHẢI nằm trong thư mục của project hiện tại: `"$currentProjectPath`".`n4. Ngôn ngữ: Tiếng Việt có dấu chuẩn 100%, tự nhiên, súc tích, chuyên nghiệp."

$payload = @{
    systemInstruction = @{ parts = @(@{ text = $sysPrompt }) }
    contents = $contentsList
} | ConvertTo-Json -Depth 6

$reqFile = Join-Path $env:TEMP "gemini_worker_$([System.Guid]::NewGuid().ToString('N')).json"
[System.IO.File]::WriteAllText($reqFile, $payload, [System.Text.Encoding]::UTF8)

$aiResponse = ""
$modelsToTry = @("gemini-flash-lite-latest", "gemini-flash-latest", "gemini-2.5-flash")
foreach ($m in $modelsToTry) {
    $url = "https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=$geminiApiKey"
    try {
        $curlCmd = "curl.exe -s -m 25 -X POST ""$url"" -H ""Content-Type: application/json; charset=utf-8"" -d @""$reqFile"""
        $rawRes = cmd.exe /c $curlCmd
        if ($rawRes) {
            $jsonRes = $rawRes | ConvertFrom-Json
            if ($jsonRes.candidates -and $jsonRes.candidates[0].content.parts[0].text) {
                $aiResponse = $jsonRes.candidates[0].content.parts[0].text.Trim()
                break
            }
        }
    } catch {}
}

Remove-Item $reqFile -Force -ErrorAction SilentlyContinue

if ([string]::IsNullOrWhiteSpace($aiResponse)) {
    $aiResponse = "Các model AI đang tạm thời quá tải, bạn vui lòng thử lại sau vài giây nhé!"
}

# Lưu lịch sử chat
try {
    $memory = [System.Collections.Generic.List[PSObject]]::new()
    if (Test-Path $historyPath) {
        $existingHist = Get-Content $historyPath -Raw -Encoding UTF8 | ConvertFrom-Json
        foreach ($t in $existingHist) { $memory.Add($t) }
    }
    $memory.Add(@{ role = "user"; parts = @(@{ text = $userText }); timestamp = (Get-Date -Format "yyyy-MM-dd HH:mm:ss") })
    $memory.Add(@{ role = "model"; parts = @(@{ text = $aiResponse }); timestamp = (Get-Date -Format "yyyy-MM-dd HH:mm:ss") })
    if ($memory.Count -gt 24) { $memory = $memory | Select-Object -Skip ($memory.Count - 24) }
    $memory | ConvertTo-Json -Depth 5 | Set-Content $historyPath -Encoding UTF8
} catch {}

# Kiểm tra xem AI có yêu cầu chạy lệnh terminal không (```run / ```powershell)
$cmdToRun = ""
$cleanReply = $aiResponse
$autoOutput = ""
$savedFiles = [System.Collections.Generic.List[string]]::new()

# 1. Phát hiện khối lệnh run hoặc powershell
if ($aiResponse -match '```(?:run|powershell|ps1|cmd|sh)\s*([\s\S]*?)```') {
    $cmdToRun = $matches[1].Trim()
    $cleanReply = $aiResponse -replace '```(?:run|powershell|ps1|cmd|sh)[\s\S]*?```', ''
}
elseif ($aiResponse -match '(?:^|\n)un\s*(\$projectDir[\s\S]*?)(?:\n\n|$)') {
    $cmdToRun = $matches[1].Trim()
    $cleanReply = $aiResponse -replace '(?:^|\n)un\s*\$projectDir[\s\S]*?(?:\n\n|$)', ''
}

# 2. Tự động trích xuất code block nếu AI xuất code thuần
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

# 3. Thực thi câu lệnh PowerShell nếu có
if (-not [string]::IsNullOrWhiteSpace($cmdToRun)) {
    if ($executionMode -eq "auto") {
        Set-Location $currentProjectPath
        $execRes = powershell.exe -NoProfile -ExecutionPolicy Bypass -Command $cmdToRun 2>&1 | Out-String
        if ([string]::IsNullOrWhiteSpace($execRes)) { $execRes = "(Lệnh đã chạy xong, không có lỗi)" }
        $autoOutput += "`n" + $execRes.Trim()

        # Kiểm tra các file vừa được tạo/sửa đổi
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
    tokensUsed = ($userText.Length + $aiResponse.Length)
} | ConvertTo-Json -Depth 5
