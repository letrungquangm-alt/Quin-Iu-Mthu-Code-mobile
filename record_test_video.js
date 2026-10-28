// ========================================================
// Automated Browser Test Video Recorder
// Mo phong nguoi dung luot web, quay video MP4 va gui Telegram
// ========================================================

const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');
const puppeteer = require('puppeteer-core');

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const FFMPEG_PATH = 'C:\\Users\\letru\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\\ffmpeg-9.0.2-full_build\\bin\\ffmpeg.exe';

const args = process.argv.slice(2);
let targetUrl = 'http://127.0.0.1:8080';
let mode = 'mobile'; // 'mobile' | 'desktop'
let durationSec = 6;
let caption = '🎬 Video kiểm thử giao diện tự động (Mobile View)';

for (let i = 0; i < args.length; i++) {
    if (args[i] === '--url' && args[i + 1]) targetUrl = args[++i];
    if (args[i] === '--mode' && args[i + 1]) mode = args[++i];
    if (args[i] === '--duration' && args[i + 1]) durationSec = parseInt(args[++i]) || 6;
    if (args[i] === '--caption' && args[i + 1]) caption = args[++i];
}

const rootDir = __dirname;
const configPath = path.join(rootDir, 'config.json');
let botToken = '';
let chatId = '';

if (fs.existsSync(configPath)) {
    try {
        const cfg = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        botToken = cfg.BOT_TOKEN;
        chatId = cfg.ALLOWED_CHAT_ID;
    } catch(e) {}
}

async function record() {
    console.log(`[RECORDER] Bat dau kiem thu URL: ${targetUrl} (Mode: ${mode})`);
    
    // Tao thu muc tam chua frames
    const tempDir = path.join(rootDir, 'temp_frames_' + Date.now());
    fs.mkdirSync(tempDir, { recursive: true });
    const outputMp4 = path.join(rootDir, 'test_demo_' + Date.now() + '.mp4');

    const browser = await puppeteer.launch({
        executablePath: CHROME_PATH,
        headless: 'new',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--window-size=1280,1024'
        ]
    });

    const page = await browser.newPage();

    if (mode === 'mobile') {
        await page.setViewport({
            width: 390,
            height: 844,
            deviceScaleFactor: 2,
            isMobile: true,
            hasTouch: true
        });
        await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1');
    } else {
        await page.setViewport({
            width: 1280,
            height: 720,
            deviceScaleFactor: 1
        });
    }

    try {
        await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 15000 });
    } catch(e) {
        console.log('[RECORDER] Goto timeout or error, continue capture:', e.message);
    }

    // Capture loop (10 fps)
    let frameIndex = 0;
    const totalFrames = durationSec * 10;
    const intervalMs = 100;

    console.log(`[RECORDER] Dang capture ${totalFrames} frames...`);

    for (let f = 0; f < totalFrames; f++) {
        const framePath = path.join(tempDir, `frame_${String(frameIndex++).padStart(4, '0')}.png`);
        await page.screenshot({ path: framePath, type: 'png' });

        // Mo phong hanh dong nguoi dung
        if (f === 10) {
            // Cuon xuong nhe nhang
            await page.evaluate(() => window.scrollBy({ top: 300, behavior: 'smooth' }));
        } else if (f === 25) {
            // Cuon xuong tiep
            await page.evaluate(() => window.scrollBy({ top: 400, behavior: 'smooth' }));
        } else if (f === 35) {
            // Thu click nut dau tien
            await page.evaluate(() => {
                const btn = document.querySelector('button, a.btn, [role="button"]');
                if (btn) btn.click();
            });
        } else if (f === 45) {
            // Cuon len dau trang
            await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
        }

        await new Promise(r => setTimeout(r, intervalMs));
    }

    await browser.close();
    console.log('[RECORDER] Capture xong! Dang bien dich sang Video MP4...');

    // Bien dich bang FFmpeg
    const inputPattern = path.join(tempDir, 'frame_%04d.png');
    const ffmpegCmd = `"${FFMPEG_PATH}" -y -framerate 10 -i "${inputPattern}" -c:v libx264 -pix_fmt yuv420p -movflags +faststart "${outputMp4}"`;

    try {
        execSync(ffmpegCmd, { stdio: 'ignore' });
        console.log(`[RECORDER] Video MP4 thanh cong: ${outputMp4}`);

        // Gui video qua Telegram
        if (botToken && chatId && fs.existsSync(outputMp4)) {
            console.log('[RECORDER] Dang gui video len Telegram...');
            const curlCmd = `curl.exe -s -X POST "https://api.telegram.org/bot${botToken}/sendVideo" -F chat_id="${chatId}" -F video="@${outputMp4}" -F caption="${caption}" -F supports_streaming="true"`;
            execSync(curlCmd, { stdio: 'ignore' });
            console.log('[RECORDER] Da gui video thanh cong!');
        }
    } catch(err) {
        console.error('[RECORDER] Loi xu ly video:', err.message);
    } finally {
        // Don dep file tam
        try {
            fs.rmSync(tempDir, { recursive: true, force: true });
            if (fs.existsSync(outputMp4)) fs.unlinkSync(outputMp4);
        } catch(e) {}
    }
}

record().catch(console.error);
