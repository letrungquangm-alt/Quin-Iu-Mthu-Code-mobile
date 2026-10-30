// lib/lobby.cjs - Dedicated Master Lobby Service
// Phục vụ Sảnh Lobby (# QuinloveRin Code Sảnh Lobby): Quản lý phân nhánh, duyệt ổ đĩa, tạo cửa sổ Antigravity PC & TUYỆT ĐỐI KHÔNG CHẠY CODE TẠI ĐÂY

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const MASTER_PASSWORD = '270927-260626-ltqlovepmt';
const AGY_EXE = 'C:\\Users\\letru\\AppData\\Local\\Programs\\antigravity\\Antigravity.exe';

const configPath = path.join(path.resolve(__dirname, '..'), 'config.json');

function loadAdminState() {
    if (fs.existsSync(configPath)) {
        try {
            const raw = fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/, '');
            const cfg = JSON.parse(raw);
            return !!cfg.IS_SUPER_ADMIN;
        } catch (e) {}
    }
    return false;
}

function saveAdminState(unlocked) {
    isSuperAdminUnlocked = unlocked;
    if (fs.existsSync(configPath)) {
        try {
            const raw = fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/, '');
            const cfg = JSON.parse(raw);
            cfg.IS_SUPER_ADMIN = unlocked;
            cfg.SUPER_ADMIN_UNLOCKED_AT = unlocked ? new Date().toISOString() : null;
            fs.writeFileSync(configPath, JSON.stringify(cfg, null, 4), 'utf8');
        } catch (e) {}
    }
}

function loadControlBoardMessageId() {
    if (fs.existsSync(configPath)) {
        try {
            const raw = fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/, '');
            const cfg = JSON.parse(raw);
            if (cfg.CONTROL_BOARD_MESSAGE_ID) return cfg.CONTROL_BOARD_MESSAGE_ID;
        } catch (e) {}
    }
    return 2783;
}

function saveControlBoardMessageId(msgId) {
    controlBoardMessageId = msgId;
    if (fs.existsSync(configPath)) {
        try {
            const raw = fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/, '');
            const cfg = JSON.parse(raw);
            cfg.CONTROL_BOARD_MESSAGE_ID = msgId;
            fs.writeFileSync(configPath, JSON.stringify(cfg, null, 4), 'utf8');
        } catch (e) {}
    }
}

let clickCount = 0;
let lastClickTime = 0;
let clickTimer = null;
let waitingForMasterPassword = false;
let isSuperAdminUnlocked = loadAdminState();
let controlBoardMessageId = loadControlBoardMessageId();

let projectWizard = {
    active: false,
    chatId: null,
    step: 'IDLE', // 'IDLE' | 'AWAITING_NAME' | 'AWAITING_DRIVE'
    projectName: '',
    selectedDrive: 'E',
    selectedPath: ''
};

// 1. Quét danh sách ổ cứng vật lý thực tế trên PC (C:, D:, E:, G:...)
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

// 3. Giao diện Menu chính tại Sảnh Lobby
function getMainMenuMarkup() {
    return {
        inline_keyboard: [
            [{ text: '🚀 Tạo Dự Án Mới (New Project)', callback_data: 'hub_create_proj' }],
            [{ text: '📂 Quản Lý Ổ Đĩa & Dự Án PC', callback_data: 'hub_explore_drives' }],
            [{ text: '🌐 Kết Nối Net (Connect Net)', callback_data: 'hub_connect_net' }],
            [{ text: '🔢 Nhập Mã PIN Kết Nối PC', callback_data: 'hub_show_pin' }],
            [{ text: '☁️ Bàn Giao Cloud 24/7', callback_data: 'hub_cloud' }]
        ]
    };
}

// 4. Bàn phím chọn ổ đĩa khi tạo dự án
function getDriveSelectionMarkup(actionPrefix = 'wizard_drive_') {
    const drives = getPCDrives();
    const rows = [];
    for (const d of drives) {
        rows.push([{
            text: `💾 Ổ ${d.drive}: (Trống ${d.freeGB} GB / ${d.totalGB} GB)`,
            callback_data: `${actionPrefix}${d.drive}`
        }]);
    }
    rows.push([{ text: '🔙 Quay lại Menu Sảnh', callback_data: 'hub_refresh_menu' }]);
    return { inline_keyboard: rows };
}

// 5. Bàn phím duyệt thư mục trong ổ đĩa
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
        { text: '🔙 Chọn ổ đĩa khác', callback_data: 'hub_explore_drives' }
    ]);
    rows.push([
        { text: '🏛️ Quay lại Menu Sảnh', callback_data: 'hub_refresh_menu' }
    ]);
    return { inline_keyboard: rows };
}

function getMainMenuText() {
    const adminTag = isSuperAdminUnlocked
        ? '👑 <b>[SUPER ADMIN UNLOCKED - TOÀN QUYỀN VĨNH VIỄN]</b>'
        : '🛡️ <b>[USER MODE]</b>';
    const permText = isSuperAdminUnlocked
        ? '• <b>Quyền hạn</b>: TOÀN QUYỀN ĐIỀU HÀNH & PHÁT TRIỂN REPO (Đã mở khóa)\n'
        : '• <b>Quyền hạn</b>: Khởi tạo dự án & Quản lý ổ đĩa PC\n';
    return `🏛️ <b>[QUINLOVERIN CODE - BẢNG ĐIỀU KHIỂN SẢNH]</b>\n──────────────────────\n${adminTag}\n• <b>Kênh</b>: QuinloveRin Code Sảnh Lobby (Sảnh Duy Nhất)\n${permText}• <b>Nhiệm vụ</b>: Quản lý phân nhánh, tạo dự án & mở cửa sổ PC\n• <b>Lưu ý</b>: <i>Sảnh dành riêng cho bảng điều khiển. Mọi hoạt động code chỉ diễn ra trong Topic dự án.</i>\n\n<i>Bro hãy chọn một thao tác bên dưới để bắt đầu:</i>`;
}

// Hàm cốt lõi: Cập nhật duy nhất Bảng Điều Khiển Sảnh (không tạo thêm tin nhắn mới)
async function updateControlBoard(api, chatId, text, markup) {
    const targetMsgId = controlBoardMessageId || 2783;
    if (api && api.editMsg) {
        try {
            await api.editMsg(chatId, targetMsgId, text, 'HTML', markup || getMainMenuMarkup(), true);
            return true;
        } catch (e) {}
    }
    if (api && api.tgApiRaw) {
        try {
            const res = await api.tgApiRaw('editMessageText', {
                chat_id: chatId,
                message_id: targetMsgId,
                text: text,
                parse_mode: 'HTML',
                reply_markup: markup || getMainMenuMarkup()
            });
            if (res && res.ok) return true;
        } catch (e) {}
    }
    // Fallback nếu tin nhắn cũ bị xóa
    try {
        const sent = await api.tgApiRaw('sendMessage', {
            chat_id: chatId,
            text: text,
            parse_mode: 'HTML',
            reply_markup: markup || getMainMenuMarkup()
        });
        if (sent && sent.ok && sent.result?.message_id) {
            saveControlBoardMessageId(sent.result.message_id);
        }
    } catch (e) {}
    return true;
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
        saveAdminState(true);
        return true;
    }
    return false;
}

function generateRandomPin() {
    return String(Math.floor(1000 + Math.random() * 9000));
}

function registerProject(name, pPath, topicId, customPin = null) {
    const regFile = path.join(path.resolve(__dirname, '..'), 'project_registry.json');
    let reg = { projects: [] };
    if (fs.existsSync(regFile)) {
        try { reg = JSON.parse(fs.readFileSync(regFile, 'utf8')); } catch (e) {}
    }
    const existing = reg.projects.find(p => (topicId && p.topicId === topicId) || p.path.toLowerCase() === pPath.toLowerCase());
    const projectPin = customPin || (existing && existing.pin) || (Number(topicId) === 1160 ? '2726' : generateRandomPin());
    if (existing) {
        if (topicId) existing.topicId = topicId;
        if (!existing.pin) existing.pin = projectPin;
        existing.updatedAt = new Date().toISOString();
    } else {
        reg.projects.push({
            name: name,
            path: pPath,
            topicId: topicId,
            pin: projectPin,
            createdAt: new Date().toISOString()
        });
    }
    try {
        fs.writeFileSync(regFile, JSON.stringify(reg, null, 2), 'utf8');
    } catch (e) {}
    return projectPin;
}

function getProjectPin(topicId) {
    if (Number(topicId) === 1160) return '2726';
    const regFile = path.join(path.resolve(__dirname, '..'), 'project_registry.json');
    if (fs.existsSync(regFile)) {
        try {
            const reg = JSON.parse(fs.readFileSync(regFile, 'utf8'));
            const found = reg.projects.find(p => Number(p.topicId) === Number(topicId));
            if (found && found.pin) return found.pin;
        } catch (e) {}
    }
    return '2726';
}

function verifyProjectPin(inputCode, topicId) {
    const code = (inputCode || '').trim();
    if (code === '2726' || code === '6585') return true;
    const regFile = path.join(path.resolve(__dirname, '..'), 'project_registry.json');
    if (fs.existsSync(regFile)) {
        try {
            const reg = JSON.parse(fs.readFileSync(regFile, 'utf8'));
            if (topicId) {
                const found = reg.projects.find(p => Number(p.topicId) === Number(topicId));
                if (found && found.pin === code) return true;
            }
            return reg.projects.some(p => p.pin === code);
        } catch (e) {}
    }
    return false;
}

function resetProjectWizard() {
    projectWizard = {
        active: false,
        chatId: null,
        step: 'IDLE',
        projectName: '',
        selectedDrive: 'E',
        selectedPath: ''
    };
}

// 7. Xử lý toàn bộ Callback Query phát sinh trong Sảnh Lobby
async function handleLobbyCallback(cb, api) {
    const cbData = cb.data;
    const chatId = cb.message && cb.message.chat ? cb.message.chat.id : null;
    if (cb.message && cb.message.message_id) {
        saveControlBoardMessageId(cb.message.message_id);
    }

    // A. QUAY LẠI MENU SẢNH HOẶC HỦY THAO TÁC
    if (cbData === 'hub_refresh_menu' || cbData === 'wizard_cancel') {
        resetProjectWizard();
        waitingForMasterPassword = false;
        await api.tgApiRaw('answerCallbackQuery', { callback_query_id: cb.id, text: '🏛️ Trở về Menu Sảnh' });
        await updateControlBoard(api, chatId, getMainMenuText(), getMainMenuMarkup());
        return true;
    }

    // B. BẤM TẠO DỰ ÁN MỚI (KÈM GÕ 7 LẦN)
    if (cbData === 'hub_create_proj') {
        const res = handleCreateProjectClick(
            async () => {
                await api.tgApiRaw('answerCallbackQuery', {
                    callback_query_id: cb.id,
                    text: '🔒 [7/7] ĐÃ KÍCH HOẠT CHẾ ĐỘ SUPER ADMIN!',
                    show_alert: true
                });
                const secretPrompt = `🔒 <b>[PHÁT HIỆN GÕ 7 LẦN LIÊN TỤC - KÍCH HOẠT CHẾ ĐỘ SUPER ADMIN]</b>\n──────────────────────\nBro vừa mở khóa cổng bảo mật bí mật của hệ sinh thái QuinloveRin Code!\n\n<i>Vui lòng nhập mật khẩu tối cao để nắm toàn quyền sử dụng repo này:</i>`;
                await updateControlBoard(api, chatId, secretPrompt, {
                    inline_keyboard: [[{ text: '🔙 Hủy & Quay lại Menu Sảnh', callback_data: 'hub_refresh_menu' }]]
                });
            },
            async () => {
                projectWizard.active = true;
                projectWizard.chatId = chatId;
                projectWizard.step = 'AWAITING_NAME';
                projectWizard.selectedDrive = '';
                const askName = `📁 <b>[KHỞI TẠO DỰ ÁN MỚI - BƯỚC 1/2]</b>\n──────────────────────\nBro muốn đặt tên cho dự án mới là gì?\n<i>(Ví dụ: <code>App-Ban-Hang</code>, <code>Landing-Page</code>, <code>Bot-Crypto</code>...)</i>\n\n👉 Hãy gửi tên dự án vào ô chat:`;
                await updateControlBoard(api, chatId, askName, {
                    inline_keyboard: [[{ text: '❌ Hủy tạo dự án', callback_data: 'hub_refresh_menu' }]]
                });
            }
        );

        if (res.action === 'PROGRESS') {
            await api.tgApiRaw('answerCallbackQuery', {
                callback_query_id: cb.id,
                text: `👆 [${res.count}/7] Nhấp tiếp để mở khóa Admin...`
            });
        }
        return true;
    }

    // C. CHỌN Ổ ĐĨA ĐỂ LƯU DỰ ÁN MỚI (TẠO CỬA SỔ ANTIGRAVITY & TOPIC TELEGRAM MỚI)
    if (cbData.startsWith('wizard_drive_')) {
        const drive = cbData.replace('wizard_drive_', '');
        const pName = projectWizard.projectName || 'New-Project';
        const pPath = `${drive}:\\${pName}`;

        try {
            if (!fs.existsSync(pPath)) {
                fs.mkdirSync(pPath, { recursive: true });
            }
            const geminiDoc = `# Dự Án: ${pName}\n\n- Khởi tạo lúc: ${new Date().toLocaleString('vi-VN')}\n- Vị trí: ${pPath}\n- Hệ điều hành: Windows\n- Trạng thái: Sẵn sàng\n`;
            fs.writeFileSync(path.join(pPath, 'GEMINI.md'), geminiDoc, 'utf8');
        } catch (e) {}

        let newTopicId = null;
        try {
            const topicRes = await api.tgApiRaw('createForumTopic', {
                chat_id: chatId,
                name: `🚀 Dự Án: ${pName}`
            });
            if (topicRes.ok && topicRes.result?.message_thread_id) {
                newTopicId = topicRes.result.message_thread_id;
                await api.sendMsg(
                    chatId,
                    `🎉 <b>[CỬA SỔ DỰ ÁN MỚI ĐÃ KHỞI TẠO]</b>\n──────────────────────\n📁 <b>Tên dự án:</b> <code>${pName}</code>\n💾 <b>Thư mục PC:</b> <code>${pPath}</code>\n🚀 <b>Topic ID:</b> <code>#${newTopicId}</code>\n\n✨ Cửa sổ Antigravity PC và Topic Telegram đã sẵn sàng! Bro gửi yêu cầu code ngay tại Topic này nhé!`,
                    newTopicId,
                    'HTML'
                );
            }
        } catch (e) {}

        // Bật cửa sổ Antigravity PC mới cho dự án này
        try {
            if (fs.existsSync(AGY_EXE)) {
                execFile(AGY_EXE, [pPath], { detached: true, stdio: 'ignore' }).unref();
            }
        } catch (e) {}

        registerProject(pName, pPath, newTopicId);

        await api.tgApiRaw('answerCallbackQuery', { callback_query_id: cb.id, text: `✅ Đã tạo dự án tại ổ ${drive}:` });
        const topicNote = newTopicId ? `\n🚀 <b>Telegram Topic mới:</b> <code>#${newTopicId}</code>` : '';
        const createdText = `🎉 <b>[ĐÃ KHỞI TẠO DỰ ÁN MỚI THÀNH CÔNG!]</b>\n──────────────────────\n📁 <b>Tên dự án:</b> <code>${pName}</code>\n💾 <b>Vị trí lưu trữ:</b> <code>${pPath}</code>\n🖥️ <b>Cửa sổ Antigravity PC:</b> ĐÃ BẬT MỞ${topicNote}\n\n✨ Cửa sổ làm việc mới trên PC và Topic Telegram đã được đồng bộ song song 1-1!`;
        resetProjectWizard();
        await updateControlBoard(api, chatId, createdText, getMainMenuMarkup());
        api.forwardToAntigravity(api.conversationId, `[DỰ ÁN MỚI ĐÃ TẠO]: Người dùng vừa tạo dự án mới '${pName}' tại: ${pPath}${topicNote}`);
        return true;
    }

    // D. KHÁM PHÁ Ổ ĐĨA & THƯ MỤC TRÊN PC
    if (cbData === 'hub_explore_drives') {
        await api.tgApiRaw('answerCallbackQuery', { callback_query_id: cb.id, text: '🔍 Đang quét toàn bộ ổ cứng PC...' });
        const drives = getPCDrives();
        let text = `💾 <b>[QUẢN LÝ Ổ ĐĨA &amp; DỰ ÁN TRÊN MÁY TÍNH]</b>\n──────────────────────\nĐã kết nối trực tiếp với PC và phát hiện <b>${drives.length} ổ cứng vật lý</b>:\n\n`;
        for (const d of drives) {
            text += `• <b>Ổ ${d.drive}:</b> Còn trống <b>${d.freeGB} GB</b> (Tổng: ${d.totalGB} GB)\n`;
        }
        text += `\n<i>👉 Chọn một ổ đĩa bên dưới để xem danh sách dự án / thư mục:</i>`;
        await updateControlBoard(api, chatId, text, getDriveSelectionMarkup('browse_drive_'));
        return true;
    }

    // E. DUYỆT THƯ MỤC TRONG Ổ ĐĨA ĐƯỢC CHỌN
    if (cbData.startsWith('browse_drive_')) {
        const d = cbData.replace('browse_drive_', '');
        await api.tgApiRaw('answerCallbackQuery', { callback_query_id: cb.id, text: `Đang đọc ổ ${d}:...` });
        const folders = getDriveFolders(d);
        let text = `📂 <b>[DANH SÁCH THƯ MỤC / DỰ ÁN TRÊN Ổ ${d}:]</b>\n──────────────────────\n`;
        if (folders.length === 0) {
            text += `<i>Ổ đĩa chưa có thư mục nào.</i>\n`;
        } else {
            folders.forEach((f, idx) => {
                text += `${idx + 1}. 📁 <code>${d}:\\${f}</code>\n`;
            });
        }
        text += `\n<i>👉 Nhấp vào thư mục bên dưới để mở cửa sổ Antigravity PC và tạo Topic Telegram:</i>`;
        await updateControlBoard(api, chatId, text, getFolderSelectionMarkup(d));
        return true;
    }

    // F. MỞ MỘT THƯ MỤC ĐÃ CHỌN TRÊN PC -> MỞ ANTIGRAVITY & TẠO TOPIC TELEGRAM MỚI
    if (cbData.startsWith('sel_folder:')) {
        const parts = cbData.split(':');
        const drive = parts[1];
        const fName = parts.slice(2).join(':');
        const fullPath = `${drive}:\\${fName}`;

        await api.tgApiRaw('answerCallbackQuery', { callback_query_id: cb.id, text: `Đang mở dự án: ${fName}...` });

        // Mở Antigravity PC với đường dẫn này
        try {
            if (fs.existsSync(AGY_EXE)) {
                execFile(AGY_EXE, [fullPath], { detached: true, stdio: 'ignore' }).unref();
            }
        } catch (e) {}

        // Tạo Topic Telegram riêng cho dự án này
        let newTopicId = null;
        try {
            const topicRes = await api.tgApiRaw('createForumTopic', {
                chat_id: chatId,
                name: `🚀 Dự Án: ${fName}`
            });
            if (topicRes.ok && topicRes.result?.message_thread_id) {
                newTopicId = topicRes.result.message_thread_id;
                await api.sendMsg(
                    chatId,
                    `🎉 <b>[CỬA SỔ DỰ ÁN ĐÃ KÍCH HOẠT]</b>\n──────────────────────\n📁 <b>Tên dự án:</b> <code>${fName}</code>\n💾 <b>Đường dẫn:</b> <code>${fullPath}</code>\n🚀 <b>Topic ID:</b> <code>#${newTopicId}</code>\n\n✨ Bro hãy chat trực tiếp yêu cầu code vào Topic này nhé!`,
                    newTopicId,
                    'HTML'
                );
            }
        } catch (e) {}

        registerProject(fName, fullPath, newTopicId);

        const topicNote = newTopicId ? `\n🚀 <b>Topic Telegram:</b> <code>#${newTopicId}</code>` : '';
        const openedMsg = `🎉 <b>[ĐÃ MỞ CỬA SỔ DỰ ÁN TRÊN PC]</b>\n──────────────────────\n📁 <b>Dự án:</b> <code>${fName}</code>\n💾 <b>Vị trí:</b> <code>${fullPath}</code>${topicNote}\n🖥️ <b>Cửa sổ PC:</b> ĐÃ MỞ`;
        await updateControlBoard(api, chatId, openedMsg, getMainMenuMarkup());
        api.forwardToAntigravity(api.conversationId, `[MỞ DỰ ÁN TRÊN PC]: Người dùng đã mở thư mục '${fullPath}'${topicNote}`);
        return true;
    }

    // G. TẠO THƯ MỤC MỚI TRONG Ổ ĐĨA ĐANG XEM
    if (cbData.startsWith('new_in_drive:')) {
        const d = cbData.replace('new_in_drive:', '');
        projectWizard.active = true;
        projectWizard.chatId = chatId;
        projectWizard.step = 'AWAITING_NAME';
        projectWizard.selectedDrive = d;
        await api.tgApiRaw('answerCallbackQuery', { callback_query_id: cb.id, text: `Tạo dự án mới trong ổ ${d}:` });
        const askName = `📁 <b>[KHỞI TẠO DỰ ÁN TRONG Ổ ${d}:]</b>\n──────────────────────\nBro muốn đặt tên cho dự án mới là gì?\n<i>(Ví dụ: <code>WebApp</code>, <code>Landing</code>, <code>Backend</code>...)</i>\n\n👉 Hãy gửi tên dự án vào ô chat:`;
        await updateControlBoard(api, chatId, askName, {
            inline_keyboard: [[{ text: '❌ Hủy thao tác', callback_data: 'hub_refresh_menu' }]]
        });
        return true;
    }

    // H. BÀN GIAO CHO CLOUD 24/7
    if (cbData === 'hub_cloud') {
        await api.tgApiRaw('answerCallbackQuery', { callback_query_id: cb.id, text: '☁️ Khởi tạo Cửa sổ Cloud 24/7...' });
        if (typeof api.handleDisconnectCloud === 'function') {
            await api.handleDisconnectCloud();
        }
        await updateControlBoard(api, chatId, `☁️ <b>[ĐÃ BÀN GIAO CHO CLOUD 24/7 THÀNH CÔNG]</b>\n──────────────────────\nMáy tính chuyển sang chế độ Chờ!`, getMainMenuMarkup());
        return true;
    }

    // KẾT NỐI NET MÁY PHỤ
    if (cbData === 'hub_connect_net') {
        await api.tgApiRaw('answerCallbackQuery', { callback_query_id: cb.id, text: '🌐 Kết nối máy net' });
        const screen = `📟 <b>[XÁC THỰC MÁY PHỤ / NET PC]</b>\n──────────────────────\n1. Mở CMD trên máy net, gõ: <code>quinloverin</code>\n2. CMD sẽ hiện <b>Mã 3 số</b> (ví dụ: <code>839</code>)\n3. Bro hãy gửi tin nhắn <b>Mã 3 số</b> đó vào đây:`;
        await updateControlBoard(api, chatId, screen, {
            inline_keyboard: [
                [{ text: '🔙 Quay lại Menu Sảnh', callback_data: 'hub_refresh_menu' }]
            ]
        });
        return true;
    }

    // I. HIỂN THỊ BÀN PHÍM PIN
    if (cbData === 'hub_show_pin') {
        await api.tgApiRaw('answerCallbackQuery', { callback_query_id: cb.id, text: 'Bàn phím xác thực mã PIN' });
        const pinDisp = typeof api.getPinDisplay === 'function' ? api.getPinDisplay('') : '----';
        const screen = `📟 <b>[BÀN PHÍM XÁC THỰC KẾT NỐI]</b>\n──────────────────────\nMàn hình: <code>${pinDisp}</code>\n<i>(Nhập mã PIN 4 số của dự án rồi bấm ↵ Enter để cưỡng chế kết nối với PC)</i>`;
        const keypadMarkup = typeof api.getKeypadMarkup === 'function' ? api.getKeypadMarkup() : {
            inline_keyboard: [
                [{ text: '🔙 Quay lại Menu Sảnh', callback_data: 'hub_refresh_menu' }]
            ]
        };
        await updateControlBoard(api, chatId, screen, keypadMarkup);
        return true;
    }

    return false;
}

// 8. Xử lý tin nhắn văn bản tại Sảnh Lobby (TUYỆT ĐỐI KHÔNG CHẠY CODE TẠI ĐÂY - TỰ ĐỘNG XÓA TIN NHẮN ĐỂ GIỮ SẢNH SẠCH 100%)
async function handleLobbyTextMessage(msg, userText, api) {
    const chatId = msg.chat.id;

    // 1. LẬP TỨC XÓA TIN NHẮN CỦA USER KHỎI SẢNH ĐỂ KHÔNG ĐỂ LẠI CHỮ NÀO
    if (msg.message_id) {
        try {
            await api.tgApiRaw('deleteMessage', { chat_id: chatId, message_id: msg.message_id });
        } catch (e) {}
    }

    // A. Nếu đang chờ mật mã Super Admin
    if (waitingForMasterPassword) {
        if (verifyMasterPassword(userText)) {
            console.log('[Easter Egg] Mật mã chính xác: 270927-260626-ltqlovepmt! Super Admin Unlocked!');
            api.forwardToAntigravity(api.conversationId, `[XÁC THỰC SUPER ADMIN THÀNH CÔNG]: Người dùng đã nhập đúng mật mã bí mật '270927-260626-ltqlovepmt'. Toàn quyền quản trị repo đã được kích hoạt!`);
            const adminUnlockedText = `👑 <b>[XÁC THỰC THÀNH CÔNG - SUPER ADMIN ACTIVATED]</b>\n──────────────────────\n🔑 <b>Mật khẩu chính xác:</b> <code>270927-260626-ltqlovepmt</code>\n✨ <b>Quyền hạn:</b> TOÀN QUYỀN SỞ HỮU &amp; ĐIỀU HÀNH REPO\n🚀 <b>Trạng thái:</b> Master Control Board đã mở khóa 100%!\n\nBro đã nắm giữ toàn quyền sử dụng repo và kiểm soát toàn bộ hệ sinh thái QuinloveRin Code!`;
            await updateControlBoard(api, chatId, adminUnlockedText, getMainMenuMarkup());
            return true;
        } else {
            waitingForMasterPassword = false;
            await updateControlBoard(api, chatId, `❌ <b>[MẬT KHẨU KHÔNG CHÍNH XÁC]</b>\nĐã hủy chế độ xác thực bí mật. Trở về trạng thái bình thường.`, getMainMenuMarkup());
            return true;
        }
    }

    // XỬ LÝ MÃ 3 SỐ KẾT NỐI NET (TỪ SẢNH LOBBY)
    if (/^\d{3}$/.test(userText.trim())) {
        const cmdCode = userText.trim();
        const teleCode = Math.floor(100 + Math.random() * 900).toString();
        const extraBotToken = '9071172098:AAGv73GInLFd5eIdI6rzw5gmWEfKCcouLJc'; // Bot 2
        const fallbackBotToken = '9295576468:AAEDkx2sZBzfxGSnOMFprvhwHIOQ4pD_xmQ';
        const userId = 2029333412;

        let dmSent = false;
        try {
            const r = await fetch(`https://api.telegram.org/bot${extraBotToken}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: userId,
                    text: `🔐 <b>[XÁC NHẬN KẾT NỐI THẬT TỪ QUINLOVERIN]</b>\n──────────────────────\nBạn hãy nhập mã <b>3 số</b> này vào CMD máy net để tiến hành kết nối nhé:\n\n👉 <code>${teleCode}</code>`,
                    parse_mode: 'HTML'
                })
            }).then(res => res.json());
            if (r.ok) dmSent = true;
        } catch (e) {}

        if (!dmSent) {
            try {
                await fetch(`https://api.telegram.org/bot${fallbackBotToken}/sendMessage`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        chat_id: userId,
                        text: `🔐 <b>[XÁC NHẬN KẾT NỐI THẬT TỪ QUINLOVERIN]</b>\n──────────────────────\nBạn hãy nhập mã <b>3 số</b> này vào CMD máy net để tiến hành kết nối nhé:\n\n👉 <code>${teleCode}</code>`,
                        parse_mode: 'HTML'
                    })
                });
            } catch (e) {}
        }

        const lobbyAck = `✅ <b>[ĐÃ GỬI MÃ XÁC THỰC QUA TIN NHẮN RIÊNG]</b>\n──────────────────────\n🔢 <b>Mã CMD:</b> <code>${cmdCode}</code>\n📱 <b>Bot phụ:</b> Đã gửi mã 3 số vào tin nhắn riêng (DM) của bro!\n\n👉 Bro kiểm tra tin nhắn riêng và nhập mã 3 số đó vào CMD máy net nhé!\n(Mã phiên: <code>gm_${cmdCode}-${teleCode}_mthu</code>)`;
        await updateControlBoard(api, chatId, lobbyAck, {
            inline_keyboard: [[{ text: '🔙 Quay lại Menu Sảnh', callback_data: 'hub_refresh_menu' }]]
        });
        return true;
    }

    // DUAL-AUTH: NẾU NHẬP PIN 2726 TẠI SẢNH
    if (userText.trim() === '2726') {
        waitingForMasterPassword = true;
        await updateControlBoard(api, chatId, `👑 <b>[XÁC THỰC QUẢN TRỊ VIÊN]</b>\n──────────────────────\n✅ Đã nhận diện mã PIN dự án: <code>2726</code>!\n🔑 Vui lòng nhập <b>Mật mã Quản trị Tối cao</b> để kích hoạt toàn quyền:`, {
            inline_keyboard: [[{ text: '❌ Hủy', callback_data: 'hub_refresh_menu' }]]
        });
        return true;
    }

    // B. Nếu đang trong Wizard tạo dự án mới: Bước nhập tên
    if (projectWizard.active && projectWizard.step === 'AWAITING_NAME') {
        const cleanName = userText.replace(/[^a-zA-Z0-9_\-\.]/g, '_').trim();
        if (!cleanName) {
            await updateControlBoard(api, chatId, `⚠️ Tên dự án không hợp lệ! Vui lòng chỉ dùng chữ cái, số, gạch ngang (ví dụ: <code>MyProject</code>):`, {
                inline_keyboard: [[{ text: '❌ Hủy tạo dự án', callback_data: 'hub_refresh_menu' }]]
            });
            return true;
        }

        projectWizard.projectName = cleanName;

        // Nếu đã định sẵn ổ đĩa (từ nút new_in_drive)
        if (projectWizard.selectedDrive) {
            const drive = projectWizard.selectedDrive;
            const pPath = `${drive}:\\${cleanName}`;
            try {
                if (!fs.existsSync(pPath)) fs.mkdirSync(pPath, { recursive: true });
                fs.writeFileSync(path.join(pPath, 'GEMINI.md'), `# Dự Án: ${cleanName}\n`, 'utf8');
            } catch (e) {}

            let newTopicId = null;
            try {
                const topicRes = await api.tgApiRaw('createForumTopic', { chat_id: chatId, name: `🚀 Dự Án: ${cleanName}` });
                if (topicRes.ok && topicRes.result?.message_thread_id) {
                    newTopicId = topicRes.result.message_thread_id;
                    await api.sendMsg(chatId, `🎉 <b>[CỬA SỔ DỰ ÁN MỚI ĐÃ KHỞI TẠO]</b>\n──────────────────────\n📁 <b>Tên dự án:</b> <code>${cleanName}</code>\n💾 <b>Thư mục PC:</b> <code>${pPath}</code>\n🚀 <b>Topic ID:</b> <code>#${newTopicId}</code>\n\n✨ Cửa sổ Antigravity PC và Topic Telegram đã sẵn sàng! Bro gửi yêu cầu code ngay tại Topic này nhé!`, newTopicId, 'HTML');
                }
            } catch (e) {}

            try {
                if (fs.existsSync(AGY_EXE)) {
                    execFile(AGY_EXE, [pPath], { detached: true, stdio: 'ignore' }).unref();
                }
            } catch (e) {}

            const topicNote = newTopicId ? `\n🚀 <b>Telegram Topic mới:</b> <code>#${newTopicId}</code>` : '';
            registerProject(cleanName, pPath, newTopicId);
            await updateControlBoard(api, chatId, `🎉 <b>[ĐÃ KHỞI TẠO DỰ ÁN MỚI THÀNH CÔNG!]</b>\n──────────────────────\n📁 <b>Tên:</b> <code>${cleanName}</code>\n💾 <b>Vị trí:</b> <code>${pPath}</code>\n🖥️ <b>Cửa sổ PC:</b> ĐÃ MỞ${topicNote}`, getMainMenuMarkup());
            resetProjectWizard();
            return true;
        }

        // Nếu chưa chọn ổ đĩa: chuyển sang Bước 2 (chọn ổ đĩa)
        projectWizard.step = 'AWAITING_DRIVE';
        const askDrive = `📁 <b>[KHỞI TẠO DỰ ÁN MỚI - BƯỚC 2/2]</b>\n──────────────────────\nTên dự án: <code>${cleanName}</code>\n\n👉 Bro muốn lưu dự án này vào ổ đĩa nào trên máy tính?`;
        await updateControlBoard(api, chatId, askDrive, getDriveSelectionMarkup('wizard_drive_'));
        return true;
    }

    // C. LỆNH MENU (/menu, /start, /hub)
    if (/^(?:\/menu|\/start|\/hub|menu)$/i.test(userText.trim())) {
        await updateControlBoard(api, chatId, getMainMenuText(), getMainMenuMarkup());
        return true;
    }

    // D. QUY TẮC BẮT BUỘC: TUYỆT ĐỐI KHÔNG CHẠY CODE TẠI SẢNH LOBBY!
    // Gửi thông báo hướng dẫn bằng cách cập nhật chính Bảng Điều Khiển
    const lobbyNotice = `🏛️ <b>[QUINLOVERIN CODE - BẢNG ĐIỀU KHIỂN SẢNH]</b>\n──────────────────────\n⚠️ <i>Bro ơi, Sảnh Lobby chỉ dùng để phân nhánh dự án, quản lý ổ cứng và kết nối PC. <b>Tuyệt đối không thực thi code hoặc prompt tại đây!</b></i>\n\n👉 Để viết code hoặc gửi yêu cầu, bro hãy chọn hoặc tạo một dự án bên dưới để vào <b>Topic làm việc riêng</b> nhé:`;
    await updateControlBoard(api, chatId, lobbyNotice, getMainMenuMarkup());
    return true;
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
    resetProjectWizard,
    getProjectWizard: () => projectWizard,
    isWaitingForMasterPassword: () => waitingForMasterPassword,
    isSuperAdmin: () => isSuperAdminUnlocked,
    handleLobbyCallback,
    handleLobbyTextMessage,
    getProjectPin,
    verifyProjectPin,
    updateControlBoard
};
