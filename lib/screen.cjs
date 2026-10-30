const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const screenScript = path.join(__dirname, 'capture_screen.ps1');
const screenshotsDir = path.join(rootDir, 'screenshots');

if (!fs.existsSync(screenshotsDir)) {
    fs.mkdirSync(screenshotsDir, { recursive: true });
}

function takeScreenshot() {
    try {
        const filename = `screen_${Date.now()}.png`;
        const outPath = path.join(screenshotsDir, filename);
        const res = execSync(`powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${screenScript}" -OutputPath "${outPath}"`, { timeout: 8000 }).toString().trim();
        if (res.includes('OK') && fs.existsSync(outPath) && fs.statSync(outPath).size > 1000) {
            return outPath;
        }
    } catch (e) {
        console.error('[Screenshot Error]:', e.message);
    }
    return null;
}

async function sendScreenshot(botToken, chatId, threadId, caption = '📸 Ảnh chụp màn hình máy tính', photoPath = null) {
    let filePath = photoPath || takeScreenshot();
    if (!filePath || !fs.existsSync(filePath)) {
        return { ok: false, error: 'Không thể chụp màn hình máy tính lúc này' };
    }

    try {
        const fileBuf = fs.readFileSync(filePath);
        const blob = new Blob([fileBuf], { type: 'image/png' });
        const formData = new FormData();
        formData.append('chat_id', chatId.toString());
        if (threadId) formData.append('message_thread_id', threadId.toString());
        formData.append('caption', caption);
        formData.append('parse_mode', 'HTML');
        formData.append('photo', blob, path.basename(filePath));

        const res = await fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, {
            method: 'POST',
            body: formData
        });
        const json = await res.json();

        // Dọn dẹp ảnh cũ (giữ lại tối đa 5 ảnh mới nhất)
        cleanupOldScreenshots();

        return json;
    } catch (e) {
        console.error('[SendScreenshot Error]:', e.message);
        return { ok: false, error: e.message };
    }
}

function cleanupOldScreenshots() {
    try {
        const files = fs.readdirSync(screenshotsDir)
            .filter(f => f.startsWith('screen_') && f.endsWith('.png'))
            .map(f => ({ name: f, time: fs.statSync(path.join(screenshotsDir, f)).mtimeMs }))
            .sort((a, b) => b.time - a.time);

        if (files.length > 5) {
            for (let i = 5; i < files.length; i++) {
                try { fs.unlinkSync(path.join(screenshotsDir, files[i].name)); } catch (e) {}
            }
        }
    } catch (e) {}
}

module.exports = {
    takeScreenshot,
    sendScreenshot
};
