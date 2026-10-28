param([string]$text, [string]$parseMode = "HTML")

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

$configPath = Join-Path $PSScriptRoot "config.json"
if (Test-Path $configPath) {
    $cfg = Get-Content $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $url = "https://api.telegram.org/bot$($cfg.BOT_TOKEN)/sendMessage"
    $chunks = @(Split-TelegramText -text $text -maxLen 3500)
    $total = $chunks.Count

    for ($i = 0; $i -lt $total; $i++) {
        $chunkText = $chunks[$i]
        if ($total -gt 1) {
            $chunkText = "<b>[Phần $($i + 1)/$total]</b>`n" + $chunkText
        }

        $body = @{ chat_id = $cfg.ALLOWED_CHAT_ID; text = $chunkText; disable_web_page_preview = $true }
        if ($parseMode) { $body["parse_mode"] = $parseMode }
        $jsonBody = $body | ConvertTo-Json -Compress

        try {
            Invoke-RestMethod -Uri $url -Method Post -ContentType "application/json; charset=utf-8" -Body ([System.Text.Encoding]::UTF8.GetBytes($jsonBody)) -TimeoutSec 10 | Out-Null
        } catch {
            if ($parseMode) {
                try {
                    $body.Remove("parse_mode")
                    $plain = $body | ConvertTo-Json -Compress
                    Invoke-RestMethod -Uri $url -Method Post -ContentType "application/json; charset=utf-8" -Body ([System.Text.Encoding]::UTF8.GetBytes($plain)) -TimeoutSec 10 | Out-Null
                } catch {}
            }
        }

        if ($total -gt 1 -and $i -lt ($total - 1)) {
            Start-Sleep -Milliseconds 150
        }
    }
}
