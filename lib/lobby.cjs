// lib/lobby.cjs - Dedicated Master Lobby Service
// Phục vụ Sảnh Lobby (# QuinloveRin Code Sảnh Lobby): Quản lý phân nhánh, duyệt ổ đĩa, tạo cửa sổ Antigravity PC & TUYỆT ĐỐI KHÔNG CHẠY CODE TẠI ĐÂY

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const MASTER_PASSWORD = '270927-260626-ltqlovepmt';
const AGY_EXE = 'C:\\Users\\letru\\AppData\\Local\\Programs\\antigravity\\Antigravity.exe';

let clickCount = 0;
let lastClickTime = 0;
let clickTimer = null;
let waitingForMasterPassword = false;
let isSuperAdminUnlocked = false;

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
            [{ text: '🔢 Nhập Mã PIN 6585 (Kết Nối PC)', callback_data: 'hub_show_pin' }],
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
    rows.push([{ text: '❌ Hủy thao tác', callback_data: 'wizard_cancel' }]);
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
        { text: '🔙 Quay lại chọn ổ', callback_data: 'hub_explore_drives' }
    ]);
    return { inline_keyboard: rows };
}

function getMainMenuText() {
    const adminTag = isSuperAdminUnlocked ? '👑 <b>[SUPER ADMIN UNLOCKED]</b>' : '🛡️ <b>[USER MODE]</b>';
    return `🏛️ <b>[QUINLOVERIN CODE SẢNH LOBBY]</b>\n──────────────────────\n${adminTag}\n• <b>Kênh</b>: QuinloveRin Code Sảnh Lobby (Sảnh Duy Nhất)\n• <b>Nhiệm vụ</b>: Quản lý phân nhánh, tạo dự án & mở cửa sổ PC\n• <b>Lưu ý</b>: <i>Tuyệt đối không chạy lệnh code tại Sảnh này! Mọi hoạt động code chỉ diễn ra trong Topic của từng dự án riêng.</i>\n\n<i>Bro hãy chọn một thao tác bên dưới để bắt đầu:</i>`;
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
        isSuperAdminUnlocked = true;
        return true;
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

    // A. BẤM TẠO DỰ ÁN MỚI (KÈM GÕ 7 LẦN)
    if (cbData === 'hub_create_proj') {
        const res = handleCreateProjectClick(
            async () => {
                await api.tgApiRaw('answerCallbackQuery', {
                    callback_query_id: cb.id,
                    text: '🔒 [7/7] ĐÃ KÍCH HOẠT CHẾ ĐỘ SUPER ADMIN!',
                    show_alert: true
                });
                const secretPrompt = `🔒 <b>[PHÁT HIỆN GÕ 7 LẦN LIÊN TỤC - KÍCH HOẠT CHẾ ĐỘ SUPER ADMIN]</b>\n──────────────────────\nBro vừa mở khóa cổng bảo mật bí mật của hệ sinh thái QuinloveRin Code!\n\n<i>Vui lòng nhập mật khẩu tối cao để nắm toàn quyền sử dụng repo này:</i>`;
                await api.sendMsg(chatId, secretPrompt, null, 'HTML');
            },
            async () => {
                projectWizard.active = true;
                projectWizard.chatId = chatId;
                projectWizard.step = 'AWAITING_NAME';
                projectWizard.selectedDrive = '';
                const askName = `📁 <b>[KHỞI TẠO DỰ ÁN MỚI - BƯỚC 1/2]</b>\n──────────────────────\nBro muốn đặt tên cho dự án mới là gì?\n<i>(Ví dụ: <code>App-Ban-Hang</code>, <code>Landing-Page</code>, <code>Bot-Crypto</code>...)</i>\n\n👉 Hãy gửi tên dự án vào ô chat:`;
                await api.sendMsg(chatId, askName, null, 'HTML');
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

    // B. CHỌN Ổ ĐĨA ĐỂ LƯU DỰ ÁN MỚI (TẠO CỬA SỔ ANTIGRAVITY & TOPIC TELEGRAM MỚI)
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

        await api.tgApiRaw('answerCallbackQuery', { callback_query_id: cb.id, text: `✅ Đã tạo dự án tại ổ ${drive}:` });
        const topicNote = newTopicId ? `\n🚀 <b>Telegram Topic mới:</b> <code>#${newTopicId}</code>` : '';
        const createdText = `🎉 <b>[ĐÃ KHỞI TẠO DỰ ÁN MỚI THÀNH CÔNG!]</b>\n──────────────────────\n📁 <b>Tên dự án:</b> <code>${pName}</code>\n💾 <b>Vị trí lưu trữ:</b> <code>${pPath}</code>\n🖥️ <b>Cửa sổ Antigravity PC:</b> ĐÃ BẬT MỞ${topicNote}\n\n✨ Cửa sổ làm việc mới trên PC và Topic Telegram đã được đồng bộ song song 1-1!`;
        resetProjectWizard();
        await api.sendMsg(chatId, createdText, null, 'HTML', getMainMenuMarkup());
        api.forwardToAntigravity(api.conversationId, `[DỰ ÁN MỚI ĐÃ TẠO]: Người dùng vừa tạo dự án mới '${pName}' tại: ${pPath}${topicNote}`);
        return true;
    }

    // C. HỦY WIZARD TẠO DỰ ÁN
    if (cbData === 'wizard_cancel') {
        resetProjectWizard();
        await api.tgApiRaw('answerCallbackQuery', { callback_query_id: cb.id, text: 'Đã hủy thao tác' });
        await api.sendMsg(chatId, `❌ <b>[ĐÃ HỦY THAO TÁC TẠO DỰ ÁN]</b>`, null, 'HTML', getMainMenuMarkup());
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
        await api.sendMsg(chatId, text, null, 'HTML', getDriveSelectionMarkup('browse_drive_'));
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
        await api.sendMsg(chatId, text, null, 'HTML', getFolderSelectionMarkup(d));
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
                    `🎉 <b>[CỬA SỔ DỰ ÁN ĐÃ BẬT MỞ TRÊN PC]</b>\n──────────────────────\n📁 <b>Dự án:</b> <code>${fName}</code>\n💾 <b>Thư mục:</b> <code>${fullPath}</code>\n🚀 <b>Topic ID:</b> <code>#${newTopicId}</code>\n\n✨ Mọi prompt và yêu cầu code cho dự án này bro gửi trực tiếp tại Topic này nhé!`,
                    newTopicId,
                    'HTML'
                );
            }
        } catch (e) {}

        const topicNote = newTopicId ? `\n🚀 <b>Telegram Topic mới:</b> <code>#${newTopicId}</code>` : '';
        await api.sendMsg(chatId, `🎉 <b>[ĐÃ MỞ CỬA SỔ DỰ ÁN TRÊN PC]</b>\n──────────────────────\n📁 <b>Dự án:</b> <code>${fName}</code>\n💾 <b>Vị trí:</b> <code>${fullPath}</code>${topicNote}`, null, 'HTML', getMainMenuMarkup());
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
        await api.sendMsg(chatId, askName, null, 'HTML');
        return true;
    }

    // H. BÀN GIAO CHO CLOUD 24/7
    if (cbData === 'hub_cloud') {
        await api.tgApiRaw('answerCallbackQuery', { callback_query_id: cb.id, text: '☁️ Khởi tạo Cửa sổ Cloud 24/7...' });
        await api.handleDisconnectCloud();
        await api.sendMsg(chatId, `☁️ <b>[ĐÃ BÀN GIAO CHO CLOUD 24/7 THÀNH CÔNG]</b>\n──────────────────────\nMáy tính chuyển sang chế độ Chờ!`, null, 'HTML', getMainMenuMarkup());
        return true;
    }

    // I. HIỂN THỊ BÀN PHÍM PIN 6585
    if (cbData === 'hub_show_pin') {
        await api.tgApiRaw('answerCallbackQuery', { callback_query_id: cb.id, text: 'Bàn phím xác thực mã PIN 6585' });
        const screen = `📟 <b>[BÀN PHÍM XÁC THỰC KẾT NỐI]</b>\n──────────────────────\nMàn hình: <code>${api.getPinDisplay('')}</code>\n<i>(Nhập mã 6585 rồi bấm ↵ Enter để cưỡng chế kết nối với PC)</i>`;
        await api.sendMsg(chatId, screen, null, 'HTML', api.getKeypadMarkup());
        return true;
    }

    return false;
}

// 8. Xử lý tin nhắn văn bản tại Sảnh Lobby (TUYỆT ĐỐI KHÔNG CHẠY CODE TẠI ĐÂY)
async function handleLobbyTextMessage(msg, userText, api) {
    const chatId = msg.chat.id;

    // A. Nếu đang chờ mật mã Super Admin
    if (waitingForMasterPassword) {
        if (verifyMasterPassword(userText)) {
            console.log('[Easter Egg] Mật mã chính xác: 270927-260626-ltqlovepmt! Super Admin Unlocked!');
            api.forwardToAntigravity(api.conversationId, `[XÁC THỰC SUPER ADMIN THÀNH CÔNG]: Người dùng đã nhập đúng mật mã bí mật '270927-260626-ltqlovepmt' qua cơ chế gõ 7 lần. Toàn quyền quản trị repo đã được kích hoạt!`);
            const adminUnlockedText = `👑 <b>[XÁC THỰC THÀNH CÔNG - SUPER ADMIN ACTIVATED]</b>\n──────────────────────\n🔑 <b>Mật khẩu chính xác:</b> <code>270927-260626-ltqlovepmt</code>\n✨ <b>Quyền hạn:</b> TOÀN QUYỀN SỞ HỮU &amp; ĐIỀU HÀNH REPO\n🚀 <b>Trạng thái:</b> Master Control Board đã mở khóa 100%!\n\nBro đã nắm giữ toàn quyền sử dụng repo và kiểm soát toàn bộ hệ sinh thái QuinloveRin Code!`;
            await api.sendMsg(chatId, adminUnlockedText, null, 'HTML', getMainMenuMarkup());
            return true;
        } else {
            waitingForMasterPassword = false;
            await api.sendMsg(chatId, `❌ <b>[MẬT KHẨU KHÔNG CHÍNH XÁC]</b>\nĐã hủy chế độ xác thực bí mật. Trở về trạng thái bình thường.`, null, 'HTML', getMainMenuMarkup());
            return true;
        }
    }

    // B. Nếu đang trong Wizard tạo dự án mới: Bước nhập tên
    if (projectWizard.active && projectWizard.step === 'AWAITING_NAME') {
        const cleanName = userText.replace(/[^a-zA-Z0-9_\-\.]/g, '_').trim();
        if (!cleanName) {
            await api.sendMsg(chatId, `⚠️ Tên dự án không hợp lệ! Vui lòng chỉ dùng chữ cái, số, gạch ngang (ví dụ: <code>MyProject</code>):`, null, 'HTML');
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
            await api.sendMsg(chatId, `🎉 <b>[ĐÃ KHỞI TẠO DỰ ÁN MỚI THÀNH CÔNG!]</b>\n──────────────────────\n📁 <b>Tên:</b> <code>${cleanName}</code>\n💾 <b>Vị trí:</b> <code>${pPath}</code>\n🖥️ <b>Cửa sổ PC:</b> ĐÃ MỞ${topicNote}`, null, 'HTML', getMainMenuMarkup());
            resetProjectWizard();
            return true;
        }

        // Nếu chưa chọn ổ đĩa: chuyển sang Bước 2 (chọn ổ đĩa)
        projectWizard.step = 'AWAITING_DRIVE';
        const askDrive = `📁 <b>[KHỞI TẠO DỰ ÁN MỚI - BƯỚC 2/2]</b>\n──────────────────────\nTên dự án: <code>${cleanName}</code>\n\n👉 Bro muốn lưu dự án này vào ổ đĩa nào trên máy tính?`;
        await api.sendMsg(chatId, askDrive, null, 'HTML', getDriveSelectionMarkup('wizard_drive_'));
        return true;
    }

    // C. LỆNH MENU (/menu, /start, /hub)
    if (/^(?:\/menu|\/start|\/hub|menu)$/i.test(userText.trim())) {
        await api.sendMsg(chatId, getMainMenuText(), null, 'HTML', getMainMenuMarkup());
        return true;
    }

    // D. QUY TẮC BẮT BUỘC: TUYỆT ĐỐI KHÔNG CHẠY CODE TẠI SẢNH LOBBY!
    // Gửi thông báo hướng dẫn và đưa Menu trở lại
    const lobbyNotice = `🏛️ <b>[QUINLOVERIN CODE SẢNH LOBBY]</b>\n──────────────────────\n⚠️ <i>Bro ơi, Sảnh Lobby chỉ dùng để phân nhánh dự án, quản lý ổ cứng và mở cửa sổ PC. <b>Tuyệt đối không thực thi code hoặc prompt tại đây!</b></i>\n\n👉 Để viết code hoặc sửa file, bro hãy chọn hoặc tạo một dự án bên dưới để vào <b>Topic làm việc riêng</b> nhé:`;
    await api.sendMsg(chatId, lobbyNotice, null, 'HTML', getMainMenuMarkup());
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
    handleLobbyTextMessage
};
