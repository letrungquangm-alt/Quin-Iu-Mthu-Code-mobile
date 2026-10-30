const { execSync, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const lsConfigFile = path.join(process.env.USERPROFILE || 'C:\\Users\\letru', '.gemini', 'antigravity', 'ls.json');
const langServer = path.join(process.env.LOCALAPPDATA || 'C:\\Users\\letru\\AppData\\Local', 'Programs', 'antigravity', 'resources', 'app', 'extensions', 'antigravity', 'bin', 'language_server.exe');
const notifScript = path.join(__dirname, 'show_notif.ps1');
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
            const taskName = `QuinAGY_${Math.floor(1000 + Math.random() * 9000)}`;
            const shortBat = 'E:\\MTHUMO~1\\lib\\run_antigravity.bat';
            if (!fs.existsSync(shortBat)) {
                fs.writeFileSync(shortBat, `@echo off\r\npowershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0open_antigravity.ps1"\r\n`, 'utf8');
            }
            try {
                execSync(`schtasks /create /tn "${taskName}" /tr "${shortBat}" /sc once /st 23:59 /it /f`, { timeout: 3000 });
                execSync(`schtasks /run /tn "${taskName}"`, { timeout: 3000 });
                setTimeout(() => {
                    try { execSync(`schtasks /delete /tn "${taskName}" /f`); } catch (e) {}
                }, 5000);
            } catch (e) {
                execSync(`powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${openAppScript}"`, { timeout: 6000 });
            }
            setTimeout(() => { discoverLanguageServer(); }, 1500);
            return 'FOCUSED';
        }
    } catch (e) {
        console.error('[IPC App Launch Error]:', e.message);
    }
    return null;
}

function discoverLanguageServer() {
    try {
        const psCmd = `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like "*language_server*agentapi*" } | Select-Object -First 1 -ExpandProperty CommandLine`;
        const cmdLine = execSync(`powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "${psCmd}"`, { timeout: 5000 }).toString().trim();
        
        if (cmdLine) {
            const tokenMatch = cmdLine.match(/--csrf_token\s+([^\s]+)/) || cmdLine.match(/--csrf_token=([^\s]+)/);
            const addrMatch = cmdLine.match(/--address\s+([^\s]+)/) || cmdLine.match(/--address=([^\s]+)/);
            
            if (tokenMatch && addrMatch) {
                const token = tokenMatch[1].replace(/["']/g, '');
                const address = addrMatch[1].replace(/["']/g, '');
                console.log(`[IPC Auto-Discover] Tìm thấy Language Server active: ${address}`);
                
                try {
                    const dir = path.dirname(lsConfigFile);
                    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
                    fs.writeFileSync(lsConfigFile, JSON.stringify({ token, address, pid: process.pid, updated: new Date().toISOString() }, null, 2), 'utf8');
                } catch (e) {}
                
                return { token, address };
            }
        }
    } catch (e) {}
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
                return { token, address };
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
