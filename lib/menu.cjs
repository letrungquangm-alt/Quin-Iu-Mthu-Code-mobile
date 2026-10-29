// lib/menu.cjs - Hub Menu, Drive/Folder Explorer & 7-Click Easter Egg Engine

const fs = require('fs');
const path = require('path');

const MASTER_PASSWORD = '270927-260626-ltqlovepmt';

let clickCount = 0;
let lastClickTime = 0;
let clickTimer = null;
let waitingForMasterPassword = false;
let isSuperAdminUnlocked = false;

let projectWizard = {
    active: false,
    chatId: null,
    threadId: 1114,
    step: 'IDLE', // 'AWAITING_NAME' | 'AWAITING_DRIVE' | 'EXPLORING_DRIVE'
    projectName: '',
    selectedDrive: 'E',
    selectedPath: ''
};

// 1. Quét danh sách ổ cứng vật lý thực tế trên máy tính (C:, D:, E:, G:...)
function getPCDrives() {
    const candidateDrives = ['C', 'D', 'E', 'F', 'G', 'H'];
    const available = [];
    for (const d of candidateDrives) {
        try {
            const root = `${d}:\\`;
            const stats = fs.statfsSync(root);
            const freeGB = Math.round((stats.bavail * stats.bsize) / (1024 * 1024 * 1024));
            const totalGB = Math.round((stats.blocks * stats.bsize) / (1024 * 1024 * 1024));
            available.push({
                drive: d,
                path: root,
                freeGB: freeGB,
                totalGB: totalGB
            });
        } catch (e) {}
    }
    return available;
}

// 2. Lấy danh sách thư mục dự án trong 1 ổ đĩa
function getDriveFolders(driveLetter) {
    try {
        const root = `${driveLetter}:\\`;
        const entries = fs.readdirSync(root, { withFileTypes: true });
        return entries
            .filter(e => e.isDirectory() && !e.name.startsWith('$') && e.name !== 'System Volume Information' && e.name !== 'Recovery')
            .map(e => e.name)
            .slice(0, 15);
    } catch (e) {
        return [];
    }
}

// 3. Giao diện Menu chính tại Sảnh Lobby (QuinloveRin Code - Topic #1114)
function getMainMenuMarkup() {
    return {
        inline_keyboard: [
            [{ text: '🚀 Tạo Dự Án Mới (New Project)', callback_data: 'hub_create_proj' }],
            [{ text: '📂 Quản Lý Ổ Đĩa & Dự Án PC', callback_data: 'hub_explore_drives' }],
            [{ text: '🔢 Nhập Mã PIN 6585 (Kết Nối PC)', callback_data: 'hub_show_pin' }],
            [{ text: '☁️ Bàn Giao Cloud 24/7', callback_data: 'hub_cloud' }]
        ]
    };
}

// 4. Bàn phím chọn ổ đĩa thực tế trên PC
function getDriveSelectionMarkup(actionPrefix = 'wizard_drive_') {
    const drives = getPCDrives();
    const rows = [];
    for (const d of drives) {
        rows.push([{
            text: `💾 Ổ ${d.drive}: (Trống ${d.freeGB} GB / ${d.totalGB} GB)`,
            callback_data: `${actionPrefix}${d.drive}`
        }]);
    }
    rows.push([{ text: '❌ Hủy thao tác', callback_data: 'wizard_cancel' }]);
    return { inline_keyboard: rows };
}

// 5. Bàn phím duyệt folder trong ổ đĩa
function getFolderSelectionMarkup(driveLetter) {
    const folders = getDriveFolders(driveLetter);
    const rows = [];
    for (const f of folders.slice(0, 8)) {
        rows.push([{
            text: `📁 ${f}`,
            callback_data: `sel_folder:${driveLetter}:${f}`
        }]);
    }
    rows.push([
        { text: '➕ Tạo thư mục mới ở ổ này', callback_data: `new_in_drive:${driveLetter}` },
        { text: '🔙 Quay lại chọn ổ', callback_data: 'hub_explore_drives' }
    ]);
    return { inline_keyboard: rows };
}

function getMainMenuText() {
    const adminTag = isSuperAdminUnlocked ? '👑 <b>[SUPER ADMIN UNLOCKED]</b>' : '🛡️ <b>[USER MODE]</b>';
    return `🏛️ <b>[QUINLOVERIN CODE - MASTER LOBBY]</b>\n──────────────────────\n${adminTag}\n• <b>Kênh</b>: QuinloveRin Code (Topic #1114 - Sảnh Duy Nhất)\n• <b>Hệ sinh thái</b>: Remote Coder Mobile ⇄ Antigravity PC\n• <b>Quyền hạn</b>: Khởi tạo dự án & Quản lý ổ đĩa PC\n\n<i>Bro hãy bấm nút bên dưới để bắt đầu:</i>`;
}

// 6. Xử lý nhấp 7 lần liên tục (Easter Egg)
function handleCreateProjectClick(onTriggerPassword, onNormalClick) {
    const now = Date.now();
    if (now - lastClickTime > 2500) {
        clickCount = 1;
    } else {
        clickCount++;
    }
    lastClickTime = now;

    console.log(`[Easter Egg] Nhấp nút: ${clickCount}/7 lần`);

    if (clickTimer) clearTimeout(clickTimer);

    if (clickCount >= 7) {
        clickCount = 0;
        waitingForMasterPassword = true;
        if (typeof onTriggerPassword === 'function') {
            onTriggerPassword();
        }
        return { action: 'TRIGGER_PASSWORD', count: 7 };
    }

    const currentTap = clickCount;
    clickTimer = setTimeout(() => {
        if (clickCount > 0 && clickCount < 7) {
            clickCount = 0;
            if (typeof onNormalClick === 'function') {
                onNormalClick();
            }
        }
    }, 1200);

    return { action: 'PROGRESS', count: currentTap };
}

function verifyMasterPassword(input) {
    if (!waitingForMasterPassword) return false;
    const clean = (input || '').trim();
    if (clean === MASTER_PASSWORD) {
        waitingForMasterPassword = false;
        isSuperAdminUnlocked = true;
        return true;
    }
    return false;
}

module.exports = {
    MASTER_PASSWORD,
    getPCDrives,
    getDriveFolders,
    getMainMenuMarkup,
    getDriveSelectionMarkup,
    getFolderSelectionMarkup,
    getMainMenuText,
    handleCreateProjectClick,
    verifyMasterPassword,
    isWaitingForMasterPassword: () => waitingForMasterPassword,
    cancelWaitingPassword: () => { waitingForMasterPassword = false; },
    isSuperAdmin: () => isSuperAdminUnlocked,
    setSuperAdmin: (v) => { isSuperAdminUnlocked = v; },
    getProjectWizard: () => projectWizard,
    resetProjectWizard: () => {
        projectWizard = {
            active: false,
            chatId: null,
            threadId: 1114,
            step: 'IDLE',
            projectName: '',
            selectedDrive: 'E',
            selectedPath: ''
        };
    }
};
