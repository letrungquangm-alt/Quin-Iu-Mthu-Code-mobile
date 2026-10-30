const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const recordingsDir = path.join(rootDir, 'recordings');

if (!fs.existsSync(recordingsDir)) {
    fs.mkdirSync(recordingsDir, { recursive: true });
}

/**
 * Quay video màn hình máy tính thực tế bằng Interactive Session Capture + Live Ticking Millisecond Watermark + Mouse Cursor + FFmpeg H.264
 */
async function recordScreen(durationSec = 4, fps = 4) {
    const totalFrames = Math.max(4, Math.min(30, Math.round(durationSec * fps)));
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

Add-Type @"
using System;
using System.Drawing;
using System.Runtime.InteropServices;

public class RecFrameDrawer {
    [StructLayout(LayoutKind.Sequential)]
    public struct POINT { public int x; public int y; }

    [StructLayout(LayoutKind.Sequential)]
    public struct CURSORINFO {
        public int cbSize;
        public int flags;
        public IntPtr hCursor;
        public POINT ptScreenPos;
    }

    [DllImport("user32.dll")]
    public static extern bool GetCursorInfo(out CURSORINFO pci);

    [DllImport("user32.dll")]
    public static extern bool DrawIcon(IntPtr hDC, int X, int Y, IntPtr hIcon);

    public static void Decorate(Graphics g, int w, int h) {
        try {
            CURSORINFO ci = new CURSORINFO();
            ci.cbSize = Marshal.SizeOf(typeof(CURSORINFO));
            if (GetCursorInfo(out ci) && ci.flags == 1) {
                IntPtr hdc = g.GetHdc();
                DrawIcon(hdc, ci.ptScreenPos.x, ci.ptScreenPos.y, ci.hCursor);
                g.ReleaseHdc(hdc);
            }
        } catch {}

        try {
            using (Font f = new Font("Segoe UI", 11, FontStyle.Bold))
            using (Brush textBrush = new SolidBrush(Color.White))
            using (Brush bgBrush = new SolidBrush(Color.FromArgb(180, 20, 20, 20)))
            using (Brush redDot = new SolidBrush(Color.Red)) {
                string stamp = DateTime.Now.ToString("HH:mm:ss.fff");
                g.FillRectangle(bgBrush, w - 200, 12, 188, 26);
                g.FillEllipse(redDot, w - 192, 19, 11, 11);
                g.DrawString("REC " + stamp, f, textBrush, w - 176, 15);
            }
        } catch {}
    }
}
"@ -ReferencedAssemblies System.Drawing

$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds

for ($i = 0; $i -lt ${totalFrames}; $i++) {
    $framePath = Join-Path '${tempDir.replace(/\\/g, '\\\\')}' ("frame_{0:D3}.png" -f $i)
    try {
        $bmp = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
        $g = [System.Drawing.Graphics]::FromImage($bmp)
        $g.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
        [RecFrameDrawer]::Decorate($g, $bounds.Width, $bounds.Height)
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

        execSync(`schtasks /create /tn ${taskName} /tr "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \\"${tempWorkerPs1}\\"" /sc once /st 23:59 /it /f`, { timeout: 4000 });
        execSync(`schtasks /run /tn ${taskName}`, { timeout: 4000 });

        const doneFile = path.join(tempDir, 'done.txt');
        const maxWaitMs = (durationSec + 5) * 1000;
        const startWait = Date.now();

        while (!fs.existsSync(doneFile) && (Date.now() - startWait < maxWaitMs)) {
            await new Promise(r => setTimeout(r, 250));
        }

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
