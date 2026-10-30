const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const recordingsDir = path.join(rootDir, 'recordings');

if (!fs.existsSync(recordingsDir)) {
    fs.mkdirSync(recordingsDir, { recursive: true });
}

/**
 * Quay video màn hình máy tính thực tế bằng Interactive Session Capture + FFmpeg H.264
 * Khắc phục triệt để lỗi màn hình đen khi tiến trình chạy ngầm
 */
async function recordScreen(durationSec = 4, fps = 2) {
    const totalFrames = Math.max(3, Math.min(20, Math.round(durationSec * fps)));
    const frameIntervalMs = Math.round(1000 / fps);
    const tempDir = path.join(recordingsDir, `temp_${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });

    const outMp4 = path.join(recordingsDir, `record_${Date.now()}.mp4`);
    const tempWorkerPs1 = path.join(rootDir, `rec_worker_${Date.now()}.ps1`);
    const taskName = `QuinRec_${Math.floor(Math.random() * 9000 + 1000)}`;

    try {
        console.log(`[Screen Recorder] Khởi tạo Interactive Worker: ${totalFrames} frames (${durationSec}s @ ${fps}fps)...`);

        const psCode = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds

for ($i = 0; $i -lt ${totalFrames}; $i++) {
    $framePath = Join-Path '${tempDir.replace(/\\/g, '\\\\')}' ("frame_{0:D3}.png" -f $i)
    try {
        $bmp = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
        $g = [System.Drawing.Graphics]::FromImage($bmp)
        $g.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
        $bmp.Save($framePath, [System.Drawing.Imaging.ImageFormat]::Png)
        $g.Dispose()
        $bmp.Dispose()
    } catch {}
    if ($i -lt (${totalFrames} - 1)) {
        Start-Sleep -Milliseconds ${frameIntervalMs}
    }
}
Set-Content (Join-Path '${tempDir.replace(/\\/g, '\\\\')}' "done.txt") -Value "DONE"
`;
        fs.writeFileSync(tempWorkerPs1, psCode, 'utf8');

        // Kích hoạt qua Task Scheduler với cờ /it để chạy trực tiếp trên Interactive Desktop
        execSync(`schtasks /create /tn ${taskName} /tr "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \\"${tempWorkerPs1}\\"" /sc once /st 23:59 /it /f`, { timeout: 4000 });
        execSync(`schtasks /run /tn ${taskName}`, { timeout: 4000 });

        // Chờ worker hoàn thành
        const doneFile = path.join(tempDir, 'done.txt');
        const maxWaitMs = (durationSec + 4) * 1000;
        const startWait = Date.now();

        while (!fs.existsSync(doneFile) && (Date.now() - startWait < maxWaitMs)) {
            await new Promise(r => setTimeout(r, 300));
        }

        // Ghép video qua FFmpeg
        const ffmpegCmd = `ffmpeg -y -framerate ${fps} -i "${tempDir}/frame_%03d.png" -c:v libx264 -pix_fmt yuv420p -movflags +faststart "${outMp4}"`;
        execSync(ffmpegCmd, { timeout: 15000 });

        if (fs.existsSync(outMp4) && fs.statSync(outMp4).size > 10000) {
            console.log(`[Screen Recorder] Quay video thành công! Size: ${fs.statSync(outMp4).size} bytes`);
            return outMp4;
        }
    } catch (e) {
        console.error('[Screen Recorder Error]:', e.message);
    } finally {
        try { execSync(`schtasks /delete /tn ${taskName} /f`, { timeout: 2000 }); } catch (e) {}
        try { if (fs.existsSync(tempWorkerPs1)) fs.unlinkSync(tempWorkerPs1); } catch (e) {}
        try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (e) {}
    }

    return null;
}

/**
 * Gửi video quay màn hình tới Telegram
 */
async function sendScreenVideo(botToken, chatId, threadId, caption = '🎥 Video quay màn hình máy tính', durationSec = 4) {
    const videoPath = await recordScreen(durationSec);
    if (!videoPath || !fs.existsSync(videoPath)) {
        return { ok: false, error: 'Không thể quay video màn hình lúc này' };
    }

    try {
        const fileBuf = fs.readFileSync(videoPath);
        const blob = new Blob([fileBuf], { type: 'video/mp4' });
        const formData = new FormData();
        formData.append('chat_id', chatId.toString());
        if (threadId) formData.append('message_thread_id', threadId.toString());
        formData.append('caption', caption);
        formData.append('parse_mode', 'HTML');
        formData.append('supports_streaming', 'true');
        formData.append('video', blob, path.basename(videoPath));

        const res = await fetch(`https://api.telegram.org/bot${botToken}/sendVideo`, {
            method: 'POST',
            body: formData
        });
        const json = await res.json();

        // Dọn dẹp video cũ (giữ lại 3 video mới nhất)
        cleanupOldVideos();

        return json;
    } catch (e) {
        console.error('[SendScreenVideo Error]:', e.message);
        return { ok: false, error: e.message };
    }
}

function cleanupOldVideos() {
    try {
        const files = fs.readdirSync(recordingsDir)
            .filter(f => f.startsWith('record_') && f.endsWith('.mp4'))
            .map(f => ({ name: f, time: fs.statSync(path.join(recordingsDir, f)).mtimeMs }))
            .sort((a, b) => b.time - a.time);

        if (files.length > 3) {
            for (let i = 3; i < files.length; i++) {
                try { fs.unlinkSync(path.join(recordingsDir, files[i].name)); } catch (e) {}
            }
        }
    } catch (e) {}
}

module.exports = {
    recordScreen,
    sendScreenVideo
};
