param([string]$text)
$configPath = Join-Path $PSScriptRoot "config.json"
if (Test-Path $configPath) {
    $cfg = Get-Content $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $url = "https://api.telegram.org/bot$($cfg.BOT_TOKEN)/sendMessage"
    $body = @{ chat_id = $cfg.ALLOWED_CHAT_ID; text = $text } | ConvertTo-Json -Compress
    Invoke-RestMethod -Uri $url -Method Post -ContentType "application/json; charset=utf-8" -Body ([System.Text.Encoding]::UTF8.GetBytes($body)) | Out-Null
}
