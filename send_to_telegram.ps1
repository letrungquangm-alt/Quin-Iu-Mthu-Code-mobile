param([string]$text, [string]$parseMode = "HTML")
$configPath = Join-Path $PSScriptRoot "config.json"
if (Test-Path $configPath) {
    $cfg = Get-Content $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $url = "https://api.telegram.org/bot$($cfg.BOT_TOKEN)/sendMessage"
    $body = @{ chat_id = $cfg.ALLOWED_CHAT_ID; text = $text }
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
}