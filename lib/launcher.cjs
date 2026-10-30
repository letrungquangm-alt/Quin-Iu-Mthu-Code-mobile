const { exec, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const rootDir = path.resolve(__dirname, '..');
const openAntigravityScript = path.join(__dirname, 'open_antigravity.ps1');

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
 * @param {string} targetUrlOrKeyword 
 * @param {string} browserName (chrome, msedge, brave, firefox, hoặc default)
 * @param {string} profile (Profile 1, Profile 2, Default...)
 */
function openWebOrApp(targetInput, browserName = 'default', profile = null) {
    let target = targetInput.trim();
    let url = null;
    let appCmd = null;

    // 1. Kiểm tra nếu là URL hợp lệ
    if (/^https?:\/\//i.test(target) || /^www\./i.test(target)) {
        url = target.startsWith('www.') ? 'https://' + target : target;
    } else {
        const lower = target.toLowerCase();
        // Kiểm tra danh bạ URL
        for (const [k, v] of Object.entries(URL_SHORTCUTS)) {
            if (lower === k || lower.startsWith(k + ' ') || lower.endsWith(' ' + k)) {
                url = v;
                break;
            }
        }

        // Kiểm tra danh bạ App
        if (!url) {
            for (const [k, v] of Object.entries(APP_SHORTCUTS)) {
                if (lower === k || lower.startsWith(k + ' ') || lower.endsWith(' ' + k)) {
                    appCmd = v;
                    break;
                }
            }
        }
    }

    // Nếu không khớp danh bạ URL mà có vẻ là tên trang web (vd: vnexpress.net, shopee.vn)
    if (!url && !appCmd && target.includes('.')) {
        url = 'https://' + target;
    }

    // 2. Thực thi mở
    try {
        if (url) {
            // Mở theo profile cụ thể nếu được yêu cầu
            if (profile && (browserName === 'chrome' || browserName === 'msedge')) {
                const exe = browserName === 'chrome' ? 'chrome.exe' : 'msedge.exe';
                exec(`start "" ${exe} --profile-directory="${profile}" "${url}"`);
                return { type: 'web', target: url, desc: `Đã mở trang web <b>${url}</b> trên <b>${browserName}</b> (${profile})!` };
            } else if (browserName && browserName !== 'default') {
                exec(`start "" ${browserName} "${url}"`);
                return { type: 'web', target: url, desc: `Đã mở trang web <b>${url}</b> trên trình duyệt <b>${browserName}</b>!` };
            } else {
                // Mở trên trình duyệt mặc định với tài khoản / cookie sẵn có của người dùng
                exec(`powershell.exe -NoProfile -Command "Start-Process '${url}'"`);
                return { type: 'web', target: url, desc: `Đã mở trang web <b>${url}</b> trên trình duyệt mặc định của PC!` };
            }
        } else if (appCmd) {
            exec(`powershell.exe -NoProfile -Command "Start-Process ${appCmd}"`);
            return { type: 'app', target: appCmd, desc: `Đã khởi chạy ứng dụng <b>${target}</b> trên máy tính!` };
        } else {
            // Fallback: Thử Start-Process hoặc mở tìm kiếm Google
            const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(target)}`;
            exec(`powershell.exe -NoProfile -Command "Start-Process '${searchUrl}'"`);
            return { type: 'search', target: searchUrl, desc: `Đã mở tìm kiếm Google cho <b>${target}</b> trên trình duyệt!` };
        }
    } catch (e) {
        return { type: 'error', error: e.message };
    }
}

/**
 * Đọc danh sách các cửa sổ và ứng dụng đang hiển thị trên màn hình máy tính
 */
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
