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
$currentProject = if ($config.CURRENT_PROJECT) { $config.CURRENT_PROJECT.ToString().Trim() } else { "default" }
$currentProjectPath = if ($config.CURRENT_PROJECT_PATH) { $config.CURRENT_PROJECT_PATH.ToString().Trim() } else { $projectsRootDir }

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

$sysPrompt = @"
Bạn là trợ lý lập trình AI thông minh cao cấp, có toàn quyền điều khiển hệ thống và terminal máy tính từ xa qua Telegram của người dùng.
Model đang dùng: $selectedModel (Thinking Level: $($thinkingLevel.ToUpper())).
Project đang làm việc: $currentProject. Thư mục hiện tại của project: $currentProjectPath.
Thư mục gốc của mọi project: $projectsRootDir.

QUY TẮC BẮT BUỘC:
1. GHI NHỚ TOÀN DIỆN NGỮ CẢNH: Khi người dùng nói tiếp hoặc bảo 'cứ làm đi', 'sao chưa làm', bạn PHẢI hiểu ngay ngữ cảnh trước đó và HÀNH ĐỘNG NGAY!
2. HÀNH ĐỘNG THỰC TẾ: Bất kỳ khi nào cần thao tác (tạo file, sửa code, chạy lệnh terminal...), bạn PHẢI xuất khối lệnh:
```run
<câu lệnh powershell cụ thể>
```
3. Mọi file tạo ra PHẢI nằm trong thư mục của project hiện tại: "$currentProjectPath".
4. Ngôn ngữ: Tiếng Việt có dấu chuẩn 100%, tự nhiên, súc tích, chuyên nghiệp.
"@

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

# Kiểm tra xem AI có yêu cầu chạy lệnh terminal không (```run)
$cmdToRun = ""
$cleanReply = $aiResponse
$autoOutput = ""

if ($aiResponse -match '```run\s*([\s\S]*?)```') {
    $cmdToRun = $matches[1].Trim()
    $cleanReply = $aiResponse -replace '```run[\s\S]*?```', ''
    
    if ($executionMode -eq "auto") {
        Set-Location $currentProjectPath
        $autoOutput = powershell.exe -NoProfile -ExecutionPolicy Bypass -Command $cmdToRun 2>&1 | Out-String
        if ([string]::IsNullOrWhiteSpace($autoOutput)) { $autoOutput = "(Lệnh đã chạy xong, không có lỗi)" }
    }
}

@{
    type = "ai"
    cleanReply = $cleanReply
    cmdToRun = $cmdToRun
    autoOutput = $autoOutput
    executionMode = $executionMode
    tokensUsed = ($userText.Length + $aiResponse.Length)
} | ConvertTo-Json -Depth 5