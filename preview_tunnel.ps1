# ========================================================
# Cloudflare Quick Tunnel - Web Preview Engine
# Mở trang web máy tính trực tiếp trên điện thoại qua HTTPS
# ========================================================

param(
    [string]$action = "start", # "start" | "stop"
    [string]$dir = "",
    [int]$port = 8080,
    [int64]$chatId = 0
)

$rootDir = $PSScriptRoot
$configPath = Join-Path $rootDir "config.json"
$cloudflaredPath = "C:\Program Files (x86)\cloudflared\cloudflared.exe"
$tunnelStatePath = Join-Path $rootDir "tunnel_state.json"
$logPath = Join-Path $rootDir "tunnel.log"

if (Test-Path $configPath) {
    $config = Get-Content $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $botToken = $config.BOT_TOKEN
    if ($chatId -eq 0) { $chatId = [int64]$config.ALLOWED_CHAT_ID }
    if ([string]::IsNullOrWhiteSpace($dir)) {
        $dir = if ($config.CURRENT_PROJECT_PATH) { $config.CURRENT_PROJECT_PATH } else { $rootDir }
    }
}

function Send-TgMessageWithButton {
    param([int64]$cId, [string]$text, [string]$buttonText, [string]$buttonUrl)
    $url = "https://api.telegram.org/bot$botToken/sendMessage"
    $bodyObj = @{
        chat_id = $cId
        text = $text
        parse_mode = "HTML"
        disable_web_page_preview = $false
        reply_markup = @{
            inline_keyboard = @(
                @(
                    @{ text = $buttonText; url = $buttonUrl },
                    @{ text = "🛑 Đóng Xem Trước"; callback_data = "tunnel:stop" }
                )
            )
        }
    }
    $json = $bodyObj | ConvertTo-Json -Depth 5 -Compress
    try {
        Invoke-RestMethod -Uri $url -Method Post -ContentType "application/json; charset=utf-8" -Body ([System.Text.Encoding]::UTF8.GetBytes($json)) -TimeoutSec 10 | Out-Null
    } catch {}
}

if ($action -eq "stop") {
    if (Test-Path $tunnelStatePath) {
        try {
            $st = Get-Content $tunnelStatePath -Raw | ConvertFrom-Json
            if ($st.cfPid) { Stop-Process -Id $st.cfPid -Force -ErrorAction SilentlyContinue }
            if ($st.serverPid) { Stop-Process -Id $st.serverPid -Force -ErrorAction SilentlyContinue }
        } catch {}
        Remove-Item -Path $tunnelStatePath -Force -ErrorAction SilentlyContinue
    }
    # Dừng các tiến trình cloudflared cũ nếu có
    Get-Process cloudflared -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    if ($chatId) {
        $stopUrl = "https://api.telegram.org/bot$botToken/sendMessage"
        $body = @{ chat_id = $chatId; text = "🛑 <b>[ĐÃ ĐÓNG XEM TRƯỚC WEB]</b>`nĐường truyền Cloudflare Tunnel đã được ngắt kết nối an toàn."; parse_mode = "HTML" } | ConvertTo-Json -Compress
        try { Invoke-RestMethod -Uri $stopUrl -Method Post -ContentType "application/json; charset=utf-8" -Body ([System.Text.Encoding]::UTF8.GetBytes($body)) -TimeoutSec 5 | Out-Null } catch {}
    }
    Write-Host "Tunnel stopped." -ForegroundColor Yellow
    exit 0
}

# --- KHỞI ĐỘNG TUNNEL (ACTION = START) ---

# 1. Dọn dẹp tunnel cũ
Get-Process cloudflared -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
if (Test-Path $logPath) { Remove-Item -Path $logPath -Force -ErrorAction SilentlyContinue }

# 2. Khởi chạy HTTP Server nếu chưa có server nào nghe ở port này
$isListening = $false
try {
    $tcp = New-Object System.Net.Sockets.TcpClient
    $tcp.Connect("127.0.0.1", $port)
    $isListening = $true
    $tcp.Close()
} catch {
    $isListening = $false
}

$serverPid = $null
if (-not $isListening) {
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    Write-Host "Khoi chay Web Server tai: $dir (Port: $port)..." -ForegroundColor Cyan
    # Sử dụng Node.js http server siêu nhẹ
    $serverCode = "
    const http = require('http');
    const fs = require('fs');
    const path = require('path');
    const dir = process.argv[2];
    const port = parseInt(process.argv[3]) || 8080;
    const mime = { '.html':'text/html', '.css':'text/css', '.js':'application/javascript', '.json':'application/json', '.png':'image/png', '.jpg':'image/jpeg', '.svg':'image/svg+xml' };
    http.createServer((req, res) => {
        let p = path.join(dir, req.url === '/' ? 'index.html' : req.url);
        if (!fs.existsSync(p)) { res.writeHead(404); return res.end('404 Not Found'); }
        let ext = path.extname(p).toLowerCase();
        res.writeHead(200, { 'Content-Type': mime[ext] || 'application/octet-stream', 'Access-Control-Allow-Origin': '*' });
        fs.createReadStream(p).pipe(res);
    }).listen(port, () => console.log('Listening'));
    "
    $serverScriptPath = Join-Path $rootDir "temp_server.js"
    [System.IO.File]::WriteAllText($serverScriptPath, $serverCode, [System.Text.Encoding]::UTF8)
    $srvProc = Start-Process node -ArgumentList "`"$serverScriptPath`"", "`"$dir`"", "$port" -PassThru -WindowStyle Hidden
    $serverPid = $srvProc.Id
    Start-Sleep -Milliseconds 800
}

# 3. Khởi chạy Cloudflare Quick Tunnel
Write-Host "Dang khoi tao Cloudflare Tunnel toi 127.0.0.1:$port..." -ForegroundColor Green
$cfProc = Start-Process -FilePath $cloudflaredPath -ArgumentList "tunnel", "--url", "http://127.0.0.1:$port", "--logfile", "`"$logPath`"" -PassThru -WindowStyle Hidden
$cfPid = $cfProc.Id

# 4. Quét log tìm URL công khai (https://*.trycloudflare.com)
$publicUrl = ""
for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Milliseconds 500
    if (Test-Path $logPath) {
        $content = Get-Content $logPath -Raw -ErrorAction SilentlyContinue
        if ($content -match '(https://[a-zA-Z0-9\-]+\.trycloudflare\.com)') {
            $publicUrl = $matches[1]
            break
        }
    }
}

if (-not $publicUrl) {
    Write-Host "[ERROR] Khong lay duoc Cloudflare URL!" -ForegroundColor Red
    exit 1
}

Write-Host "TUNNEL READY: $publicUrl" -ForegroundColor Green

# 5. Lưu trạng thái
@{
    cfPid = $cfPid
    serverPid = $serverPid
    url = $publicUrl
    port = $port
    dir = $dir
    startedAt = (Get-Date).ToString("o")
} | ConvertTo-Json -Depth 5 | Set-Content $tunnelStatePath -Encoding UTF8

# 6. Gửi tin nhắn Telegram kèm nút bấm mở web
if ($chatId) {
    $msgText = @(
        "🌐 <b>[WEB DEMO SẴN SÀNG TRÊN ĐIỆN THOẠI!]</b>",
        "──────────────────────",
        "• <b>Thư mục</b>: <code>$dir</code>",
        "• <b>Port</b>: <code>$port</code>",
        "• <b>Link trực tiếp</b>: <a href=`"$publicUrl`">$publicUrl</a>",
        "",
        "<i>👉 Bro hãy chạm vào nút bấm bên dưới để tự tay vuốt chạm và lướt web trên điện thoại nhé!</i>"
    ) -join "`n"

    Send-TgMessageWithButton -cId $chatId -text $msgText -buttonText "🚀 MỞ WEB TRÊN ĐIỆN THOẠI" -buttonUrl $publicUrl
}
