// lib/menu.cjs - Hub Menu, Project Spawner Wizard & 7-Click Easter Egg Engine

const fs = require('fs');
const path = require('path');

const MASTER_PASSWORD = '270927-260626-ltqlovepmt';

// State Machine
let clickCount = 0;
let lastClickTime = 0;
let clickTimer = null;
let waitingForMasterPassword = false;
let isSuperAdminUnlocked = false;

let projectWizard = {
    active: false,
    chatId: null,
    threadId: 315,
    step: 'IDLE', // 'AWAITING_NAME' | 'AWAITING_DRIVE'
    projectName: '',
    selectedDrive: 'E'
};

function getMainMenuMarkup() {
    return {
        inline_keyboard: [
            [{ text: '🚀 Tạo Dự Án Mới (New Project)', callback_data: 'hub_create_proj' }],
            [{ text: '📂 Danh Sách Dự Án Hiện Có', callback_data: 'hub_list_proj' }],
            [{ text: '☁️ Bàn Giao Cloud 24/7', callback_data: 'hub_cloud' }]
        ]
    };
}

function getDriveSelectionMarkup() {
    return {
        inline_keyboard: [
            [{ text: '💾 Ổ Đĩa E: (Khuyên dùng - Dung lượng lớn)', callback_data: 'wizard_drive_E' }],
            [{ text: '💾 Ổ Đĩa C: (Hệ thống Antigravity Scratch)', callback_data: 'wizard_drive_C' }],
            [{ text: '❌ Hủy tạo dự án', callback_data: 'wizard_cancel' }]
        ]
    };
}

function getMainMenuText() {
    const adminTag = isSuperAdminUnlocked ? '👑 <b>[SUPER ADMIN UNLOCKED]</b>' : '🛡️ <b>[USER MODE]</b>';
    return `🏛️ <b>[QUINLOVERIN CODE - SẢNH CHỜ LOBBY]</b>\n──────────────────────\n${adminTag}\n• <b>Kênh</b>: Sảnh Chờ Trung Tâm (Master Lobby)\n• <b>Hệ sinh thái</b>: Remote Coder Mobile ⇄ Antigravity PC\n• <b>Chức năng</b>: Khởi tạo dự án & Quản trị hệ thống\n\n<i>Bro hãy bấm nút bên dưới để bắt đầu:</i>`;
}

// Xử lý nhấp chuột 7 lần vào nút Tạo Dự Án
function handleCreateProjectClick(chatId, threadId, onTriggerPassword, onNormalClick) {
    const now = Date.now();

    if (now - lastClickTime < 3500) {
        clickCount++;
    } else {
        clickCount = 1;
    }
    lastClickTime = now;

    console.log(`[Easter Egg] Nhấp nút Tạo Dự Án: ${clickCount}/7 lần`);

    if (clickTimer) clearTimeout(clickTimer);

    if (clickCount >= 7) {
        clickCount = 0;
        waitingForMasterPassword = true;
        if (typeof onTriggerPassword === 'function') {
            onTriggerPassword();
        }
        return 'TRIGGER_PASSWORD';
    }

    // Nếu người dùng không bấm đủ 7 lần trong 800ms, coi như 1 lần bấm bình thường
    clickTimer = setTimeout(() => {
        if (clickCount > 0 && clickCount < 7) {
            clickCount = 0;
            if (typeof onNormalClick === 'function') {
                onNormalClick();
            }
        }
    }, 800);

    return 'WAITING_CLICKS';
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
    getMainMenuMarkup,
    getDriveSelectionMarkup,
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
            threadId: 315,
            step: 'IDLE',
            projectName: '',
            selectedDrive: 'E'
        };
    }
};
