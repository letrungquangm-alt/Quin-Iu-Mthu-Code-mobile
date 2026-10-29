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

function discoverLanguageServer() {
    try {
        const psCmd = `$proc = Get-CimInstance Win32_Process -Filter "Name = 'language_server.exe'" | Select-Object -First 1; $token = if ($proc.CommandLine -match '--csrf_token\\s+([a-f0-9\\-]+)') { $matches[1] } else { '' }; $conn = Get-NetTCPConnection -OwningProcess $proc.ProcessId -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalAddress -eq '127.0.0.1' } | Select-Object -First 1; $port = if ($conn) { $conn.LocalPort } else { 53281 }; @{ token = $token; port = $port; address = "127.0.0.1:$port" } | ConvertTo-Json -Compress`;
        const res = execSync(`powershell.exe -NoProfile -Command "${psCmd}"`, { timeout: 3000 }).toString().trim();
        const info = JSON.parse(res);
        if (info.token && info.address) {
            fs.writeFileSync(lsConfigFile, JSON.stringify({
                port: info.port,
                token: info.token,
                address: info.address,
                updatedAt: new Date().toISOString()
            }, null, 2), 'utf8');
            return info;
        }
    } catch (e) {
        console.warn('[IPC Discovery Warn]:', e.message);
    }
    return null;
}

function getLsCredentials() {
    let token = process.env.ANTIGRAVITY_CSRF_TOKEN;
    let address = process.env.ANTIGRAVITY_LS_ADDRESS;

    if (token && address) {
        return { token, address };
    }

    if (fs.existsSync(lsConfigFile)) {
        try {
            const raw = fs.readFileSync(lsConfigFile, 'utf8').replace(/^\uFEFF/, '');
            const cfg = JSON.parse(raw);
            if (cfg.token && cfg.address) {
                token = cfg.token;
                address = cfg.address;
            }
        } catch (e) {}
    }

    if (!token || !address) {
        const discovered = discoverLanguageServer();
        if (discovered) {
            token = discovered.token;
            address = discovered.address;
        }
    }

    return { token, address };
}

function forwardToAntigravity(conversationId, text, retry = true) {
    if (!fs.existsSync(langServer)) {
        console.warn('[IPC Warning] Không tìm thấy language_server.exe tại:', langServer);
        return;
    }

    const { token, address } = getLsCredentials();
    const callEnv = Object.assign({}, process.env, {
        ANTIGRAVITY_CSRF_TOKEN: token || '',
        ANTIGRAVITY_LS_ADDRESS: address || '127.0.0.1:53281',
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
    discoverLanguageServer
};
