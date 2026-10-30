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
            if (profile && (browserName === 'chrome' || browserName === 'msedge' || browserName === 'edge')) {
                const exe = browserName === 'chrome' ? 'chrome.exe' : 'msedge.exe';
                exec(`start "" ${exe} --profile-directory="${profile}" "${url}"`);
                return { type: 'web', target: url, desc: `Đã mở trang web <b>${url}</b> trên <b>${browserName}</b> (${profile})!` };
            } else if (browserName && browserName !== 'default') {
                const exe = browserName === 'edge' ? 'msedge.exe' : `${browserName}.exe`;
                exec(`start "" ${exe} "${url}"`);
                return { type: 'web', target: url, desc: `Đã mở trang web <b>${url}</b> trên trình duyệt <b>${browserName}</b>!` };
            } else {
                exec(`powershell.exe -NoProfile -Command "Start-Process '${url}'"`);
                return { type: 'web', target: url, desc: `Đã mở trang web <b>${url}</b> trên trình duyệt mặc định của PC!` };
            }
        } else if (appCmd) {
            exec(`powershell.exe -NoProfile -Command "Start-Process ${appCmd}"`);
            return { type: 'app', target: appCmd, desc: `Đã khởi chạy ứng dụng <b>${target}</b> trên máy tính!` };
        } else {
            const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(target)}`;
            exec(`powershell.exe -NoProfile -Command "Start-Process '${searchUrl}'"`);
            return { type: 'search', target: searchUrl, desc: `Đã mở tìm kiếm Google cho <b>${target}</b> trên trình duyệt!` };
        }
    } catch (e) {
        return { type: 'error', error: e.message };
    }
}

function getActiveWindowsSummary() {
    try {
        const psCmd = `Get-Process | Where-Object { $_.MainWindowTitle } | Select-Object -Unique ProcessName, MainWindowTitle | Format-Table -HideTableHeaders -AutoSize`;
        const res = execSync(`powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "${psCmd}"`, { timeout: 4000 }).toString().trim();
        if (!res) return 'Không có cửa sổ ứng dụng nào có tiêu đề rõ ràng đang mở.';

        const lines = res.split('\n')
            .map(l => l.trim())
            .filter(Boolean)
            .map(l => `• <b>${l}</b>`);

        return lines.join('\n');
    } catch (e) {
        return 'Không thể trích xuất danh sách cửa sổ: ' + e.message;
    }
}

module.exports = {
    openWebOrApp,
    getActiveWindowsSummary,
    URL_SHORTCUTS,
    APP_SHORTCUTS
};
