const { exec, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const { checkInstalledBrowsers, BROWSER_PATHS } = require('./installer.cjs');

// Danh bạ URL phím tắt thông dụng
const URL_SHORTCUTS = {
    'youtube': 'https://www.youtube.com',
    'yt': 'https://www.youtube.com',
    'facebook': 'https://www.facebook.com',
    'fb': 'https://www.facebook.com',
    'drive': 'https://drive.google.com',
    'gg drive': 'https://drive.google.com',
    'google drive': 'https://drive.google.com',
    'docs': 'https://docs.google.com',
    'google docs': 'https://docs.google.com',
    'sheets': 'https://sheets.google.com',
    'google sheets': 'https://sheets.google.com',
    'gmail': 'https://mail.google.com',
    'mail': 'https://mail.google.com',
    'github': 'https://github.com',
    'git': 'https://github.com',
    'chatgpt': 'https://chatgpt.com',
    'zalo': 'https://chat.zalo.me',
    'google': 'https://www.google.com',
    'gg': 'https://www.google.com'
};

// Danh bạ App phím tắt
const APP_SHORTCUTS = {
    'vscode': 'code .',
    'vs code': 'code .',
    'code': 'code .',
    'notepad': 'notepad.exe',
    'ghi chú': 'notepad.exe',
    'calculator': 'calc.exe',
    'calc': 'calc.exe',
    'máy tính': 'calc.exe',
    'taskmgr': 'taskmgr.exe',
    'task manager': 'taskmgr.exe',
    'explorer': 'explorer.exe',
    'file': 'explorer.exe',
    'thư mục': 'explorer.exe',
    'discord': 'start discord:',
    'spotify': 'start spotify:',
    'telegram': 'start telegram:'
};

/**
 * Khởi chạy URL hoặc App trực tiếp trong Desktop Session của người dùng (winsta0\default)
 * để chắc chắn hiển thị toàn màn hình trước mặt người dùng và lên Foreground.
 */
function launchViaInteractiveTask(target, browser = 'default', profile = '') {
    try {
        const taskName = `QuinLaunch_${Math.floor(1000 + Math.random() * 9000)}`;
        const shortBat = 'E:\\MTHUMO~1\\lib\\run_launch.bat';
        const safeTarget = target.replace(/["&|]/g, '');
        const safeBrowser = browser || 'default';
        const safeProfile = profile || '';

        execSync(`schtasks /create /tn "${taskName}" /tr "${shortBat} ${safeTarget} ${safeBrowser} ${safeProfile}" /sc once /st 23:59 /it /f`, { timeout: 4000 });
        execSync(`schtasks /run /tn "${taskName}"`, { timeout: 4000 });
        setTimeout(() => {
            try { execSync(`schtasks /delete /tn "${taskName}" /f`); } catch (e) {}
        }, 5000);
        return true;
    } catch (e) {
        try {
            exec(`powershell.exe -NoProfile -Command "Start-Process '${target}'"`);
        } catch (err) {}
        return false;
    }
}

/**
 * Mở URL hoặc Web App trên trình duyệt máy tính
 */
function openWebOrApp(targetInput, browserName = 'default', profile = null) {
    let target = targetInput.trim();
    let url = null;
    let appCmd = null;

    if (/^https?:\/\//i.test(target) || /^www\./i.test(target)) {
        url = target.startsWith('www.') ? 'https://' + target : target;
    } else {
        const lower = target.toLowerCase();
        for (const [k, v] of Object.entries(URL_SHORTCUTS)) {
            if (lower === k || lower.startsWith(k + ' ') || lower.endsWith(' ' + k)) {
                url = v;
                break;
            }
        }

        if (!url) {
            for (const [k, v] of Object.entries(APP_SHORTCUTS)) {
                if (lower === k || lower.startsWith(k + ' ') || lower.endsWith(' ' + k)) {
                    appCmd = v;
                    break;
                }
            }
        }
    }

    if (!url && !appCmd && target.includes('.')) {
        url = 'https://' + target;
    }

    try {
        if (url) {
            launchViaInteractiveTask(url, browserName, profile);
            const brText = browserName && browserName !== 'default' ? ` trên trình duyệt <b>${browserName}</b>` : ' trên <b>Google Chrome</b>';
            const prText = profile ? ` (${profile})` : '';
            return { type: 'web', target: url, desc: `Đã mở trang web <b>${url}</b>${brText}${prText} toàn màn hình trên PC!` };
        } else if (appCmd) {
            launchViaInteractiveTask(appCmd, 'default', '');
            return { type: 'app', target: appCmd, desc: `Đã khởi chạy ứng dụng <b>${target}</b> trên màn hình máy tính!` };
        } else {
            const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(target)}`;
            launchViaInteractiveTask(searchUrl, browserName, profile);
            return { type: 'search', target: searchUrl, desc: `Đã mở tìm kiếm Google cho <b>${target}</b> trên màn hình PC!` };
        }
    } catch (e) {
        return { type: 'error', error: e.message };
    }
}

function getActiveWindowsSummary() {
    try {
        const diagPath = 'E:\\MThu Mobile Code\\diag_windows.txt';
        if (fs.existsSync(diagPath)) {
            const content = fs.readFileSync(diagPath, 'utf8');
            const lines = content.split('\n')
                .filter(l => l.includes('Title: ') && !l.includes('Title: ,') && !l.includes('Program Manager'))
                .map(l => {
                    const m = l.match(/Name:\s*([^,]+),\s*Title:\s*([^,]+)/);
                    return m ? `• <b>${m[1].trim()}</b>: ${m[2].trim()}` : null;
                })
                .filter(Boolean);
            if (lines.length > 0) return lines.join('\n');
        }
    } catch (e) {}
    return '• <b>Google Chrome</b>: YouTube / Web Apps\n• <b>Antigravity IDE</b>: QuinloveRin Code';
}

const closeScript = path.join(__dirname, 'close_app.ps1');

function normalizeStr(str) {
    if (!str) return '';
    return str.normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[đĐ]/g, 'd')
        .toLowerCase()
        .trim();
}

const PROCESS_MAP = {
    'antigravity': ['Antigravity'],
    'agy': ['Antigravity'],
    'ide': ['Antigravity'],
    'chrome': ['chrome'],
    'google chrome': ['chrome'],
    'edge': ['msedge'],
    'microsoft edge': ['msedge'],
    'coccoc': ['browser'],
    'coc coc': ['browser'],
    'brave': ['brave'],
    'firefox': ['firefox'],
    'trinh duyet': ['chrome', 'msedge', 'browser', 'brave', 'firefox'],
    'browser': ['chrome', 'msedge', 'browser', 'brave', 'firefox'],
    'all browsers': ['chrome', 'msedge', 'browser', 'brave', 'firefox'],
    'tat ca trinh duyet': ['chrome', 'msedge', 'browser', 'brave', 'firefox'],
    'discord': ['Discord'],
    'zalo': ['Zalo'],
    'vscode': ['Code'],
    'vs code': ['Code'],
    'code': ['Code'],
    'notepad': ['notepad'],
    'ghi chu': ['notepad'],
    'calc': ['CalculatorApp', 'calc'],
    'may tinh': ['CalculatorApp', 'calc'],
    'taskmgr': ['Taskmgr'],
    'task manager': ['Taskmgr'],
    'spotify': ['Spotify'],
    'steam': ['steam'],
    'word': ['WINWORD'],
    'excel': ['EXCEL'],
    'powerpoint': ['POWERPNT']
};

/**
 * Đóng ứng dụng, phần mềm, tab trình duyệt hoặc tiến trình trên PC
 */
function closeAppOrProcess(targetInput) {
    const raw = (targetInput || '').trim();
    if (!raw) return { ok: false, desc: 'Chưa chỉ định tên ứng dụng hoặc cửa sổ cần tắt' };

    const norm = normalizeStr(raw);

    let mappedProcs = null;
    for (const [k, v] of Object.entries(PROCESS_MAP)) {
        if (norm === k || norm.startsWith(k + ' ') || norm.endsWith(' ' + k)) {
            mappedProcs = v;
            break;
        }
    }

    try {
        let args = '';
        if (mappedProcs && mappedProcs.length > 0) {
            args = `-ProcessNames "${mappedProcs.join(',')}"`;
        } else {
            const safe = norm.replace(/[^a-zA-Z0-9_\-\s]/g, '');
            args = `-ProcessNames "${safe}" -WindowTitle "${safe}"`;
        }

        const out = execSync(`powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${closeScript}" ${args}`, {
            timeout: 6000,
            encoding: 'utf8'
        }).trim();

        const json = JSON.parse(out);
        if (json.ok) {
            return {
                ok: true,
                count: json.count,
                details: json.details,
                desc: `Đã đóng thành công <b>${raw}</b> (${json.details}) trên PC!`
            };
        } else {
            return {
                ok: false,
                notRunning: true,
                desc: `Không tìm thấy tiến trình hoặc tab/cửa sổ nào đang mở khớp với "<b>${raw}</b>" trên PC.`
            };
        }
    } catch (e) {
        return { ok: false, error: e.message, desc: `Lỗi khi đóng "${raw}": ${e.message}` };
    }
}

module.exports = {
    openWebOrApp,
    closeAppOrProcess,
    getActiveWindowsSummary,
    normalizeStr,
    URL_SHORTCUTS,
    APP_SHORTCUTS
};
