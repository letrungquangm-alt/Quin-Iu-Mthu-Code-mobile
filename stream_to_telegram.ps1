# ========================================================
# Telegram RTMP Live Stream Engine
# Phat song truc tiep man hinh may tinh len Telegram Video Chat
# ========================================================

param(
    [string]$action = "start", # "start" | "stop"
    [string]$rtmpUrl = "",
    [string]$streamKey = "",
    [int64]$chatId = 0
)

$rootDir = $PSScriptRoot
$configPath = Join-Path $rootDir "config.json"
$streamStatePath = Join-Path $rootDir "stream_state.json"
$ffmpegPath = "C:\Users\letru\AppData\Local\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-9.0.2-full_build\bin\ffmpeg.exe"

if (Test-Path $configPath) {
    $config = Get-Content $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $botToken = $config.BOT_TOKEN
    if ($chatId -eq 0) { $chatId = [int64]$config.ALLOWED_CHAT_ID }
}

function Send-TgMsg {
    param([int64]$cId, [string]$text)
    $url = "https://api.telegram.org/bot$botToken/sendMessage"
    $bodyObj = @{ chat_id = $cId; text = $text; parse_mode = "HTML" } | ConvertTo-Json -Compress
    try {
        Invoke-RestMethod -Uri $url -Method Post -ContentType "application/json; charset=utf-8" -Body ([System.Text.Encoding]::UTF8.GetBytes($bodyObj)) -TimeoutSec 10 | Out-Null
    } catch {}
}

if ($action -eq "stop") {
    if (Test-Path $streamStatePath) {
        try {
            $st = Get-Content $streamStatePath -Raw | ConvertFrom-Json
            if ($st.pid) { Stop-Process -Id $st.pid -Force -ErrorAction SilentlyContinue }
        } catch {}
        Remove-Item -Path $streamStatePath -Force -ErrorAction SilentlyContinue
    }
    if ($chatId) {
        Send-TgMsg -cId $chatId -text "🛑 <b>[ĐÃ DỪNG LIVE STREAM TELEGRAM]</b>`nLuồng phát sóng trực tiếp màn hình đã kết thúc."
    }
    Write-Host "Stream stopped." -ForegroundColor Yellow
    exit 0
}

# --- BẮT ĐẦU LIVE STREAM (ACTION = START) ---

if ([string]::IsNullOrWhiteSpace($rtmpUrl)) {
    if ($chatId) {
        $guideText = @(
            "🔴 <b>HƯỚNG DẪN BẬT LIVE STREAM TRÊN TELEGRAM:</b>",
            "──────────────────────",
            "1. Trên Telegram, vào <b>Kênh (Channel)</b> hoặc <b>Nhóm (Group)</b> của bro.",
            "2. Bấm vào tiêu đề nhóm ➔ Chọn <b>Live Stream (hoặc Video Chat)</b>.",
            "3. Bấm vào nút <b>'Stream With...' (Phát bằng công cụ ngoài)</b>.",
            "4. Telegram sẽ hiện 2 dòng:",
            "   • <b>Server URL</b> (ví dụ: <code>rtmps://dc4-1.rtmp.t.me/s/</code>)",
            "   • <b>Stream Key</b> (dãy mã ký tự dài)",
            "",
            "👉 Bro chỉ cần copy và gửi vào đây theo cú pháp:",
            "<code>/stream &lt;Server_URL&gt; &lt;Stream_Key&gt;</code>",
            "<i>(Ví dụ: /stream rtmps://dc4-1.rtmp.t.me/s/ 123456:abcdef...)</i>"
        ) -join "`n"
        Send-TgMsg -cId $chatId -text $guideText
    }
    exit 0
}

# Nối full RTMP endpoint
$fullRtmp = if ([string]::IsNullOrWhiteSpace($streamKey)) { $rtmpUrl } else { "$($rtmpUrl.TrimEnd('/'))/$streamKey" }

# Dừng stream cũ nếu có
if (Test-Path $streamStatePath) {
    try {
        $st = Get-Content $streamStatePath -Raw | ConvertFrom-Json
        if ($st.pid) { Stop-Process -Id $st.pid -Force -ErrorAction SilentlyContinue }
    } catch {}
}

Write-Host "Dang ket noi Live Stream RTMP: $rtmpUrl..." -ForegroundColor Green

# Chạy ffmpeg phát desktop ngầm
$ffmpegArgs = @(
    "-f", "gdigrab",
    "-framerate", "30",
    "-i", "desktop",
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-b:v", "2500k",
    "-maxrate", "2500k",
    "-bufsize", "5000k",
    "-pix_fmt", "yuv420p",
    "-g", "60",
    "-f", "flv",
    $fullRtmp
)

$streamProc = Start-Process -FilePath $ffmpegPath -ArgumentList $ffmpegArgs -PassThru -WindowStyle Hidden

@{
    pid = $streamProc.Id
    rtmpUrl = $rtmpUrl
    startedAt = (Get-Date).ToString("o")
} | ConvertTo-Json | Set-Content $streamStatePath -Encoding UTF8

if ($chatId) {
    $liveMsg = @(
        "🔴 <b>[ĐANG LIVE STREAM TRỰC TIẾP LÊN TELEGRAM (30fps)!]</b>",
        "──────────────────────",
        "• <b>Nguồn phát</b>: Màn hình máy tính chính",
        "• <b>Tốc độ khung hình</b>: 30 FPS Full HD",
        "• <b>Trạng thái</b>: Đang truyền tín hiệu mượt mà",
        "",
        "<i>👉 Bro hãy mở Live Stream trong Nhóm/Kênh Telegram ra để xem trực tiếp quá trình làm việc và kiểm thử!</i>",
        "",
        "👉 Gõ <code>/stopstream</code> khi muốn dừng phát sóng."
    ) -join "`n"

    Send-TgMsg -cId $chatId -text $liveMsg
}
