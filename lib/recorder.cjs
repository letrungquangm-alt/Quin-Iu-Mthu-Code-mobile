const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const screenScript = path.join(__dirname, 'capture_screen.ps1');
const recordingsDir = path.join(rootDir, 'recordings');

if (!fs.existsSync(recordingsDir)) {
    fs.mkdirSync(recordingsDir, { recursive: true });
}

/**
 * Quay video màn hình máy tính trong số giây chỉ định (mặc định 4s, 2 fps = 8 frames)
 * Sử dụng FFmpeg ghép thành video MP4 chuẩn H.264 gửi trực tiếp lên Telegram
 */
async function recordScreen(durationSec = 4, fps = 2) {
    const totalFrames = Math.max(3, Math.min(20, Math.round(durationSec * fps)));
    const frameIntervalMs = Math.round(1000 / fps);
    const tempDir = path.join(recordingsDir, `temp_${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });

    const outMp4 = path.join(recordingsDir, `record_${Date.now()}.mp4`);

    try {
        console.log(`[Screen Recorder] Bắt đầu chụp ${totalFrames} khung hình (${durationSec}s @ ${fps}fps)...`);

        for (let i = 0; i < totalFrames; i++) {
            const framePath = path.join(tempDir, `frame_${String(i).padStart(3, '0')}.png`);
            execSync(`powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${screenScript}" -OutputPath "${framePath}"`, { timeout: 4000 });
            if (i < totalFrames - 1) {
                await new Promise(r => setTimeout(r, frameIntervalMs));
            }
        }

        // Ghép bằng FFmpeg
        const ffmpegCmd = `ffmpeg -y -framerate ${fps} -i "${tempDir}/frame_%03d.png" -vf "scale=trunc(iw/2)*2:trunc(ih/2)*2" -c:v libx264 -pix_fmt yuv420p -movflags +faststart "${outMp4}"`;
        execSync(ffmpegCmd, { timeout: 15000 });

        if (fs.existsSync(outMp4) && fs.statSync(outMp4).size > 500) {
            console.log(`[Screen Recorder] Quay video thành công! Size: ${fs.statSync(outMp4).size} bytes`);
            return outMp4;
        }
    } catch (e) {
        console.error('[Screen Recorder Error]:', e.message);
    } finally {
        // Dọn dẹp thư mục frame tạm
        try {
            fs.rmSync(tempDir, { recursive: true, force: true });
        } catch (e) {}
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
