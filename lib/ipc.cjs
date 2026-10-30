const fs = require('fs');
const path = require('path');
const { execFile, execSync } = require('child_process');

let langServer = path.join(
    process.env.LOCALAPPDATA || 'C:\\Users\\letru\\AppData\\Local',
    'Programs',
    'antigravity',
    'resources',
    'bin',
    'language_server.exe'
);

if (!fs.existsSync(langServer)) {
    langServer = 'C:\\Users\\letru\\AppData\\Local\\Programs\\antigravity\\resources\\bin\\language_server.exe';
}

const rootDir = path.resolve(__dirname, '..');
const notifScript = path.join(rootDir, 'show_notification.ps1');
const lsConfigFile = path.join(rootDir, 'antigravity_ls.json');
const discoverScript = path.join(__dirname, 'discover_ls.ps1');
const openAppScript = path.join(__dirname, 'open_antigravity.ps1');

function isPidAlive(pid) {
    if (!pid) return false;
    try {
        process.kill(pid, 0);
        return true;
    } catch (e) {
        return false;
    }
}

function launchOrFocusAntigravity() {
    try {
        if (fs.existsSync(openAppScript)) {
            const res = execSync(`powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${openAppScript}"`, { timeout: 6000 }).toString().trim();
            console.log('[IPC App Launch]:', res);
            // Dò lại credentials sau khi mở app
            setTimeout(() => { discoverLanguageServer(); }, 1500);
            return res;
        }
    } catch (e) {
        console.error('[IPC App Launch Error]:', e.message);
    }
    return null;
}

function discoverLanguageServer() {
    try {
        if (fs.existsSync(discoverScript)) {
            const res = execSync(`powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${discoverScript}"`, { timeout: 4000 }).toString().trim();
            if (res) {
                const info = JSON.parse(res);
                if (info.token && info.port) {
                    fs.writeFileSync(lsConfigFile, JSON.stringify({
                        pid: info.pid,
                        port: info.port,
                        token: info.token,
                        address: info.address,
                        updatedAt: new Date().toISOString()
                    }, null, 2), 'utf8');
                    return info;
                }
            }
        }
    } catch (e) {
        console.warn('[IPC Discovery Warn]:', e.message);
    }
    return null;
}

function getLsCredentials(forceRefresh = false) {
    let token = process.env.ANTIGRAVITY_CSRF_TOKEN;
    let address = process.env.ANTIGRAVITY_LS_ADDRESS;

    if (!forceRefresh && token && address) {
        return { token, address };
    }

    if (!forceRefresh && fs.existsSync(lsConfigFile)) {
        try {
            const raw = fs.readFileSync(lsConfigFile, 'utf8').replace(/^\uFEFF/, '');
            const cfg = JSON.parse(raw);
            if (cfg.token && cfg.address && isPidAlive(cfg.pid)) {
                return { token: cfg.token, address: cfg.address };
            }
        } catch (e) {}
    }

    const discovered = discoverLanguageServer();
    if (discovered) {
        return { token: discovered.token, address: discovered.address };
    }

    return { token: '', address: '127.0.0.1:53473' };
}

function forwardToAntigravity(conversationId, text, retry = true) {
    if (!fs.existsSync(langServer)) {
        console.warn('[IPC Warning] Không tìm thấy language_server.exe tại:', langServer);
        return;
    }

    const { token, address } = getLsCredentials(!retry);
    const callEnv = Object.assign({}, process.env, {
        ANTIGRAVITY_CSRF_TOKEN: token || '',
        ANTIGRAVITY_LS_ADDRESS: address || '127.0.0.1:53473',
        ANTIGRAVITY_APP_DATA_DIR: process.env.ANTIGRAVITY_APP_DATA_DIR || 'C:/Users/letru/.gemini/antigravity'
    });

    execFile(langServer, ['agentapi', 'send-message', conversationId, text], { env: callEnv }, (err, stdout, stderr) => {
        if (err) {
            console.error('[IPC Error] Gửi lệnh tới Antigravity thất bại:', err.message);
            if (retry) {
                console.log('[IPC Retry] Đang tự động dò lại port/token language_server...');
                const rediscovered = discoverLanguageServer();
                if (rediscovered) {
                    forwardToAntigravity(conversationId, text, false);
                }
            }
        } else {
            console.log('[IPC OK] Đã nạp tin nhắn vào Box Chat Antigravity PC:', text.substring(0, 60));
        }
    });
}

function showScreenToast(title, msg) {
    if (fs.existsSync(notifScript)) {
        try {
            execFile('powershell.exe', [
                '-NoProfile',
                '-ExecutionPolicy',
                'Bypass',
                '-File',
                notifScript,
                '-Title',
                title,
                '-Message',
                msg,
                '-DurationSec',
                '3'
            ], { windowsHide: true }, () => {});
        } catch (e) {}
    }
}

function recordSyncMessage(syncBridgePath, conversationId, sender, text) {
    if (!syncBridgePath || !fs.existsSync(syncBridgePath)) return;
    try {
        const raw = fs.readFileSync(syncBridgePath, 'utf8').replace(/^\uFEFF/, '');
        const br = JSON.parse(raw);
        if (!Array.isArray(br.messages)) br.messages = [];
        br.messages.push({
            sender: sender || 'phone',
            timestamp: new Date().toISOString(),
            text: text
        });
        if (br.messages.length > 25) br.messages = br.messages.slice(-25);
        br.active = true;
        br.status = 'CONNECTED';
        br.conversationId = conversationId;
        fs.writeFileSync(syncBridgePath, JSON.stringify(br, null, 4), 'utf8');
    } catch (e) {}
}

module.exports = {
    langServer,
    forwardToAntigravity,
    showScreenToast,
    recordSyncMessage,
    getLsCredentials,
    discoverLanguageServer,
    launchOrFocusAntigravity
};
