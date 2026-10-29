const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

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

function forwardToAntigravity(conversationId, text) {
    if (!fs.existsSync(langServer)) {
        console.warn('[IPC Warning] Không tìm thấy language_server.exe tại:', langServer);
        return;
    }
    execFile(langServer, ['agentapi', 'send-message', conversationId, text], (err, stdout) => {
        if (err) {
            console.error('[IPC Error] Gửi lệnh tới Antigravity thất bại:', err.message);
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
    recordSyncMessage
};
