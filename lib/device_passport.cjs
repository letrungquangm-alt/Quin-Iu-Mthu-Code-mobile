// lib/device_passport.cjs - Hộ Chiếu Thiết Bị (Device Passport & Hardware Fingerprint)
// Định danh chính xác máy tính (Hostname, IP, Model CPU, Machine GUID, RAM, OS) cho đa máy & đa thiết bị

const os = require('os');
const { execSync } = require('child_process');
const crypto = require('crypto');

let cachedPassport = null;

function getLocalIp() {
    try {
        const interfaces = os.networkInterfaces();
        for (const name of Object.keys(interfaces)) {
            for (const iface of interfaces[name]) {
                if (iface.family === 'IPv4' && !iface.internal) {
                    return iface.address;
                }
            }
        }
    } catch (e) {}
    return '127.0.0.1';
}

function getMachineGuid() {
    try {
        const out = execSync('powershell.exe -NoProfile -Command "(Get-ItemProperty HKLM:\\SOFTWARE\\Microsoft\\Cryptography).MachineGuid"', { timeout: 3000 }).toString().trim();
        if (out && out.length > 8) return out;
    } catch (e) {}
    return crypto.createHash('md5').update(os.hostname() + os.homedir()).digest('hex');
}

function getReadableOS() {
    const rel = os.release();
    const type = os.type();
    if (type === 'Windows_NT') {
        const build = parseInt(rel.split('.')[2] || '0', 10);
        if (build >= 22000) return `Windows 11 (Build ${build})`;
        return `Windows 10 (Build ${build})`;
    }
    return `${type} ${rel}`;
}

function getDevicePassport(workingDrive = 'G') {
    if (cachedPassport) return cachedPassport;

    const hostname = os.hostname();
    const localIp = getLocalIp();
    const osReadable = getReadableOS();
    const cpu = (os.cpus()[0]?.model || 'Intel/AMD Processor').trim();
    const guid = getMachineGuid();
    const ram = Math.round(os.totalmem() / (1024 * 1024 * 1024));

    cachedPassport = {
        hostname: hostname,
        localIp: localIp,
        osInfo: osReadable,
        cpuModel: cpu,
        machineGuid: guid,
        ramGB: ram,
        workingDrive: workingDrive,
        passportId: `${hostname.substring(0, 10)}-${guid.substring(0, 8)}`.toUpperCase()
    };
    return cachedPassport;
}

function formatPassportCard(passport = null) {
    const p = passport || getDevicePassport();
    return `🛂 <b>[HỘ CHIẾU THIẾT BỊ - DEVICE PASSPORT]</b>\n──────────────────────\n💻 <b>Tên máy:</b> <code>${p.hostname}</code>\n🌐 <b>Địa chỉ IP:</b> <code>${p.localIp}</code>\n⚙️ <b>Model CPU:</b> <code>${p.cpuModel}</code>\n🪟 <b>Hệ điều hành:</b> <code>${p.osInfo}</code> (${p.ramGB} GB RAM)\n🪪 <b>Mã định danh (GUID):</b> <code>${p.machineGuid}</code>\n💾 <b>Ổ đĩa làm việc:</b> Ổ <code>${p.workingDrive}:\\</code>`;
}

module.exports = {
    getDevicePassport,
    formatPassportCard,
    getLocalIp,
    getMachineGuid
};
