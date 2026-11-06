const mtproto = require('./mtproto_auth.cjs');
// lib/gmcloud.cjs - Dedicated GMCloud Virtual Storage & Interactive Telegram Explorer
// Hoạt động 100% độc lập, không xung đột với Antigravity IDE hay Cloud AI Prompt.
// Lưu trữ vĩnh viễn tại Topic # (General Topic) không thể bị xóa!
// Bảo mật bằng Mã PIN dự án (2726) / Super Admin.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const rootDir = path.resolve(__dirname, '..');
const configPath = path.join(rootDir, 'config.json');
const manifestPath = path.join(rootDir, 'gmcloud_manifest.json');
const legacyManifestPath = path.join(rootDir, 'telecloud_manifest.json');

// Topic # (General Topic trong supergroup Telegram luôn có threadId là 1)
const GMCLOUD_TOPIC_ID = 1;

// Bộ nhớ xác thực phiên người dùng
const gmCloudUnlockedUsers = new Set();
const gmCloudPinBuffer = new Map();

function getProjectPin() {
    if (fs.existsSync(configPath)) {
        try {
            const raw = fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/, '');
            const cfg = JSON.parse(raw);
            if (cfg.PROJECT_PIN) return String(cfg.PROJECT_PIN);
        } catch (e) {}
    }
    return "2726";
}

function isGmCloudUnlocked(userId, chatId) {
    if (userId && gmCloudUnlockedUsers.has(Number(userId))) return true;
    if (chatId && gmCloudUnlockedUsers.has(Number(chatId))) return true;

    // Kiểm tra Super Admin từ config.json
    try {
        if (fs.existsSync(configPath)) {
            const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            if (cfg.IS_SUPER_ADMIN) return true;
        }
    } catch (e) {}
    return false;
}

function unlockGmCloud(userId, chatId) {
    if (userId) gmCloudUnlockedUsers.add(Number(userId));
    if (chatId) gmCloudUnlockedUsers.add(Number(chatId));
}

function loadGmCloudTopicId() {
    return GMCLOUD_TOPIC_ID;
}

function loadManifest() {
    const target = fs.existsSync(manifestPath) ? manifestPath : (fs.existsSync(legacyManifestPath) ? legacyManifestPath : null);
    if (target) {
        try {
            const raw = fs.readFileSync(target, 'utf8').replace(/^\uFEFF/, '');
            return JSON.parse(raw);
        } catch (e) {}
    }
    return {
        file_count: 0,
        raw_bytes: 0,
        gzipped_size: 0,
        file_tree: []
    };
}

function escapeHtml(str) {
    if (!str) return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function getLanguageByExt(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    switch (ext) {
        case '.js':
        case '.cjs':
        case '.mjs': return 'javascript';
        case '.json': return 'json';
        case '.html': return 'html';
        case '.css': return 'css';
        case '.ps1': return 'powershell';
        case '.bat':
        case '.cmd': return 'batch';
        case '.toml': return 'toml';
        case '.md': return 'markdown';
        default: return 'text';
    }
}

/**
 * Phân tích cấu trúc thư mục từ manifest
 */
function getDirectoryContents(targetDir = '') {
    const manifest = loadManifest();
    const tree = manifest.file_tree || [];
    const normalizedTarget = targetDir.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');

    const dirs = new Map();
    const files = [];

    for (const item of tree) {
        const itemPath = item.path.replace(/\\/g, '/');
        
        if (!normalizedTarget) {
            if (itemPath.includes('/')) {
                const topDir = itemPath.split('/')[0];
                dirs.set(topDir, (dirs.get(topDir) || 0) + 1);
            } else {
                files.push(item);
            }
        } else {
            if (itemPath.startsWith(normalizedTarget + '/')) {
                const subPath = itemPath.slice(normalizedTarget.length + 1);
                if (subPath.includes('/')) {
                    const nextDir = subPath.split('/')[0];
                    dirs.set(nextDir, (dirs.get(nextDir) || 0) + 1);
                } else {
                    files.push(item);
                }
            }
        }
    }

    return {
        currentDir: normalizedTarget,
        dirs: Array.from(dirs.entries()).map(([name, count]) => ({ name, count })),
        files: files.sort((a, b) => a.path.localeCompare(b.path)),
        totalFiles: manifest.file_count || tree.length,
        rawBytes: manifest.raw_bytes || 0,
        gzippedSize: manifest.gzipped_size || 0,
        updatedAt: manifest.updated_at || new Date().toISOString()
    };
}

/**
 * Tạo giao diện Bảng điều khiển duyệt thư mục GMCloud Explorer
 */
function buildExplorerMarkup(dir = '', page = 0) {
    const contents = getDirectoryContents(dir);
    const rows = [];

    // 1. Các nút thư mục con (2 nút / hàng)
    const dirButtons = contents.dirs.map(d => {
        const fullSubDir = dir ? `${dir}/${d.name}` : d.name;
        return {
            text: `📁 ${d.name}/ (${d.count})`,
            callback_data: `gmcloud_dir:${fullSubDir}`
        };
    });

    for (let i = 0; i < dirButtons.length; i += 2) {
        if (dirButtons[i + 1]) {
            rows.push([dirButtons[i], dirButtons[i + 1]]);
        } else {
            rows.push([dirButtons[i]]);
        }
    }

    // 2. Phân trang files (6 file / trang)
    const pageSize = 6;
    const totalFiles = contents.files.length;
    const totalPages = Math.max(1, Math.ceil(totalFiles / pageSize));
    const safePage = Math.min(Math.max(0, page), totalPages - 1);
    const startIdx = safePage * pageSize;
    const currentFiles = contents.files.slice(startIdx, startIdx + pageSize);

    for (const f of currentFiles) {
        const fileName = path.basename(f.path);
        const sizeKB = (f.size / 1024).toFixed(1);
        rows.push([{
            text: `📄 ${fileName} (${sizeKB} KB)`,
            callback_data: `gmcloud_view:${f.path}`
        }]);
    }

    // 3. Hàng điều hướng phân trang
    if (totalPages > 1) {
        const navRow = [];
        if (safePage > 0) {
            navRow.push({ text: '⬅️ Trang trước', callback_data: `gmcloud_page:${dir}:${safePage - 1}` });
        }
        navRow.push({ text: `📄 ${safePage + 1}/${totalPages}`, callback_data: 'gmcloud_noop' });
        if (safePage < totalPages - 1) {
            navRow.push({ text: '➡️ Trang sau', callback_data: `gmcloud_page:${dir}:${safePage + 1}` });
        }
        rows.push(navRow);
    }

    // 4. Hàng nút chức năng
    const actionRow = [];
    if (dir) {
        const parentParts = dir.split('/');
        parentParts.pop();
        const parentDir = parentParts.join('/');
        actionRow.push({ text: '🔙 Thư mục cha', callback_data: `gmcloud_dir:${parentDir}` });
    }
    actionRow.push({ text: '🔄 Làm mới', callback_data: `gmcloud_dir:${dir}` });
    actionRow.push({ text: '⚡ Đồng bộ PC', callback_data: 'gmcloud_sync' });
    rows.push(actionRow);

    // Hàng nút MTProto User Account
    const isMt = mtproto.isMtprotoAuthenticated();
    const mtInfo = mtproto.getMtprotoSessionInfo();
    const mtRow = [];
    if (isMt && mtInfo) {
        mtRow.push({ text: `👤 MTProto: ${mtInfo.userName || mtInfo.userPhone} (2GB+)`, callback_data: 'gmcloud_mt_info' });
        mtRow.push({ text: '🚪 Đăng xuất MTProto', callback_data: 'gmcloud_mt_logout' });
    } else {
        mtRow.push({ text: '🔐 Xác Thực Tài Khoản Chủ (OTP my.telegram.org)', callback_data: 'gmcloud_mt_auth' });
    }
    rows.push(mtRow);

    const headerText = `☁️ <b>[GMCLOUD VIRTUAL STORAGE - KHO MÃ NGUỒN VĨNH CỬU]</b>\n──────────────────────\n📂 <b>Repo:</b> <code>Quin-Iu-Mthu-Code-mobile</code>\n🏛️ <b>Kênh lưu trữ:</b> Topic # (General Topic vĩnh cửu)\n📁 <b>Vị trí:</b> <code>/${dir ? dir + '/' : ''}</code>\n📊 <b>Mã nguồn:</b> ${contents.totalFiles} files (${(contents.rawBytes / 1024).toFixed(1)} KB) | <b>Gzip:</b> ${(contents.gzippedSize / 1024).toFixed(1)} KB\n⚡ <b>Lưu trữ:</b> Telegram Object Storage 24/7 (Không bao giờ mất khi đóng topic)\n🔒 <b>Bảo mật:</b> Đã xác thực mã PIN dự án thành công${(function() {
        const isMt = mtproto.isMtprotoAuthenticated();
        const mtInfo = mtproto.getMtprotoSessionInfo();
        return isMt && mtInfo
            ? `\n👤 <b>Tài khoản chủ (MTProto):</b> ✅ <code>${mtInfo.userName || mtInfo.userPhone}</code> (Lưu trữ 2GB - 4GB)`
            : `\n👤 <b>Tài khoản chủ (MTProto):</b> ☁️ <i>Chưa liên kết (Đang dùng Bot API 50MB)</i>`;
    })()}\n\n👉 <i>Bro bấm các nút bên dưới để mở thư mục hoặc xem trực tiếp code:</i>`;

    return {
        text: headerText,
        markup: { inline_keyboard: rows }
    };
}

/**
 * Giao diện Bàn phím PIN xác thực cho Kho GMCloud
 */
function buildPinKeypad(currentPin = '') {
    const display = currentPin.split('').map(() => '●').join(' ') + ' ' + '- '.repeat(Math.max(0, 4 - currentPin.length)).trim();
    const text = `🔒 <b>[KHO GMCLOUD - XÁC THỰC BẢO MẬT]</b>\n──────────────────────\n📂 <b>Kho lưu trữ:</b> <code>Quin-Iu-Mthu-Code-mobile</code>\n🏛️ <b>Kênh lưu trữ:</b> ☁️ Kho GMCloud Storage (Topic #)\n🔑 <i>Kho mã nguồn được bảo vệ an toàn. Bro hãy nhập <b>Mã PIN dự án (2726)</b> để mở khóa quyền xem mã nguồn và duyệt file:</i>\n\n📟 <b>Màn hình PIN:</b> <code>[ ${display} ]</code>`;

    return {
        text,
        markup: {
            inline_keyboard: [
                [
                    { text: '1', callback_data: 'gmpin_num_1' },
                    { text: '2', callback_data: 'gmpin_num_2' },
                    { text: '3', callback_data: 'gmpin_num_3' }
                ],
                [
                    { text: '4', callback_data: 'gmpin_num_4' },
                    { text: '5', callback_data: 'gmpin_num_5' },
                    { text: '6', callback_data: 'gmpin_num_6' }
                ],
                [
                    { text: '7', callback_data: 'gmpin_num_7' },
                    { text: '8', callback_data: 'gmpin_num_8' },
                    { text: '9', callback_data: 'gmpin_num_9' }
                ],
                [
                    { text: '🔙 Menu Sảnh', callback_data: 'hub_refresh_menu' },
                    { text: '0', callback_data: 'gmpin_num_0' },
                    { text: '⌫ Xóa', callback_data: 'gmpin_del' }
                ],
                [
                    { text: '🔓 Xác Nhận Mở Khóa', callback_data: 'gmpin_enter' }
                ]
            ]
        }
    };
}

/**
 * Đọc nội dung file từ Snapshot đã tải hoặc từ disk PC
 */
async function getFileContent(filePath) {
    const localFile = path.join(rootDir, filePath);
    if (fs.existsSync(localFile)) {
        try {
            return fs.readFileSync(localFile, 'utf8');
        } catch (e) {}
    }
    return `// Khong the doc file: ${filePath}`;
}

/**
 * Hiển thị chi tiết file với syntax highlighting
 */
async function renderFileView(filePath, api, chatId, messageId, threadId) {
    const content = await getFileContent(filePath);
    const size = Buffer.byteLength(content, 'utf8');
    const lang = getLanguageByExt(filePath);
    const lines = content.split('\n');
    const lineCount = lines.length;

    let displayCode = content;
    let truncateNotice = '';
    if (displayCode.length > 3200) {
        displayCode = displayCode.substring(0, 3200) + '\n... [Nội dung dài đã được rút gọn để hiển thị tối ưu trên Telegram]';
        truncateNotice = '\n<i>💡 Bro bấm nút <b>⬇️ Tải file thô (.raw)</b> bên dưới để tải toàn bộ code về máy!</i>';
    }

    const viewText = `📄 <b>[GMCLOUD VIEWER]:</b> <code>${filePath}</code>\n──────────────────────\n📊 <b>Dung lượng:</b> ${(size / 1024).toFixed(1)} KB | <b>${lineCount} dòng</b> | <b>Ngôn ngữ:</b> <code>${lang}</code>\n🕒 <b>Kênh lưu trữ:</b> Topic # (General Topic vĩnh cửu)\n\n<pre><code class="language-${lang}">${escapeHtml(displayCode)}</code></pre>${truncateNotice}`;

    const normalizedDir = path.dirname(filePath).replace(/\\/g, '/');
    const viewMarkup = {
        inline_keyboard: [
            [
                { text: `🔙 Quay lại ${normalizedDir ? normalizedDir + '/' : 'Root'}`, callback_data: `gmcloud_dir:${normalizedDir === '.' ? '' : normalizedDir}` },
                { text: '⬇️ Tải file thô (.raw)', callback_data: `gmcloud_raw:${filePath}` }
            ],
            [
                { text: '🔄 Làm mới file', callback_data: `gmcloud_view:${filePath}` },
                { text: '🏠 Về Kho GMCloud', callback_data: 'gmcloud_dir:' }
            ]
        ]
    };

    await api.tgApiRaw('editMessageText', {
        chat_id: chatId,
        message_id: messageId,
        text: viewText,
        parse_mode: 'HTML',
        reply_markup: viewMarkup
    });
}

/**
 * Gửi file document raw về Telegram cho người dùng
 */
async function sendRawFile(filePath, api, chatId, threadId) {
    const content = await getFileContent(filePath);
    const fileName = path.basename(filePath);
    const fileBuffer = Buffer.from(content, 'utf8');

    try {
        const boundary = '----GMCloudRawBoundary' + Date.now().toString(16);
        const parts = [];

        parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n${chatId}\r\n`));
        if (threadId && Number(threadId) > 1) {
            parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="message_thread_id"\r\n\r\n${threadId}\r\n`));
        }
        parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="caption"\r\n\r\n📄 <b>[GMCLOUD RAW FILE]:</b> <code>${filePath}</code>\n⚡ Lưu trữ vĩnh cửu tại Topic #!\r\n`));
        parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="parse_mode"\r\n\r\nHTML\r\n`));
        parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="document"; filename="${fileName}"\r\nContent-Type: application/octet-stream\r\n\r\n`));
        parts.push(fileBuffer);
        parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));

        const bodyBuffer = Buffer.concat(parts);

        await fetch(`https://api.telegram.org/bot${api.botToken}/sendDocument`, {
            method: 'POST',
            headers: {
                'Content-Type': `multipart/form-data; boundary=${boundary}`,
                'Content-Length': bodyBuffer.length.toString()
            },
            body: bodyBuffer
        });
    } catch (e) {
        console.error('[SendRawFile Error]:', e.message);
    }
}

/**
 * Xử lý toàn bộ Callback Query của GMCloud Virtual Storage Explorer
 */
async function handleGmCloudCallback(cb, api) {
    const cbData = cb.data;
    const chatId = cb.message && cb.message.chat ? cb.message.chat.id : null;
    const messageId = cb.message && cb.message.message_id ? cb.message.message_id : null;
    const threadId = cb.message && cb.message.message_thread_id ? cb.message.message_thread_id : null;
    const fromId = cb.from ? cb.from.id : chatId;
    const userKey = fromId || chatId;

    // --- XỬ LÝ XÁC THỰC MTPROTO USER ACCOUNT ---
    if (cbData === 'gmcloud_mt_auth') {
        const promptPhoneText = `📱 <b>[XÁC THỰC TÀI KHOẢN CHỦ TELEGRAM - GMCLOUD]</b>\n──────────────────────\nĐể biến tài khoản Telegram chính chủ thành Kho Lưu Trữ Vô Hạn (Lưu tới 2GB - 4GB/file):\n\n1. Truy cập trang web: https://my.telegram.org\n2. Nhận mã OTP đăng nhập về điện thoại\n3. Bot sẽ tự động kết nối tài khoản của bro qua MTProto an toàn 100%!\n\n👉 <b>Bro hãy gửi số điện thoại vào ô chat</b> <i>(kèm mã quốc tế, ví dụ: <code>+84912345678</code>)</i>:`;
        const cancelMarkup = {
            inline_keyboard: [[{ text: '❌ Hủy xác thực', callback_data: 'gmcloud_dir:' }]]
        };
        await api.tgApiRaw('answerCallbackQuery', { callback_query_id: cb.id, text: '🔐 Mở luồng xác thực MTProto' });
        await api.tgApiRaw('editMessageText', {
            chat_id: chatId,
            message_id: messageId,
            text: promptPhoneText,
            parse_mode: 'HTML',
            reply_markup: cancelMarkup
        });
        mtproto.getAuthState().step = 'AWAITING_PHONE';
        return true;
    }

    if (cbData === 'gmcloud_mt_info') {
        const info = mtproto.getMtprotoSessionInfo();
        const cardText = `👤 <b>[THÔNG TIN TÀI KHOẢN CHỦ MTPROTO]</b>\n──────────────────────\n• <b>Tên:</b> ${info.userName || 'Chưa đặt'}\n• <b>Số điện thoại:</b> <code>${info.userPhone}</code>\n• <b>User ID:</b> <code>${info.userId}</code>\n• <b>Telegram Premium:</b> ${info.isPremium ? '✅ Có (Lưu tới 4GB/file)' : '❌ Không (Lưu tới 2GB/file)'}\n• <b>Thời gian liên kết:</b> ${new Date(info.authTime).toLocaleString('vi-VN')}\n\n✨ Kho GMCloud Storage đang hoạt động trực tiếp với tài khoản chính chủ của bro!`;
        await api.tgApiRaw('answerCallbackQuery', { callback_query_id: cb.id, text: 'Thông tin tài khoản MTProto' });
        await api.tgApiRaw('editMessageText', {
            chat_id: chatId,
            message_id: messageId,
            text: cardText,
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [[{ text: '🔙 Quay lại Explorer', callback_data: 'gmcloud_dir:' }]]
            }
        });
        return true;
    }

    if (cbData === 'gmcloud_mt_logout') {
        mtproto.logoutMtproto();
        await api.tgApiRaw('answerCallbackQuery', { callback_query_id: cb.id, text: '🚪 Đã đăng xuất MTProto thành công!', show_alert: true });
        const explorer = buildExplorerMarkup('', 0);
        await api.tgApiRaw('editMessageText', {
            chat_id: chatId,
            message_id: messageId,
            text: explorer.text,
            parse_mode: 'HTML',
            reply_markup: explorer.markup
        });
        return true;
    }

    // --- A. BÀN PHÍM XÁC THỰC MÃ PIN CHO GMCLOUD ---
    if (cbData.startsWith('gmpin_')) {
        let currentPin = gmCloudPinBuffer.get(userKey) || '';

        if (cbData.startsWith('gmpin_num_')) {
            const num = cbData.replace('gmpin_num_', '');
            if (currentPin.length < 4) {
                currentPin += num;
                gmCloudPinBuffer.set(userKey, currentPin);
            }
            await api.tgApiRaw('answerCallbackQuery', { callback_query_id: cb.id });

            // Tự động kiểm tra khi đủ 4 số
            if (currentPin.length === 4) {
                const expectedPin = getProjectPin();
                if (currentPin === expectedPin) {
                    unlockGmCloud(fromId, chatId);
                    gmCloudPinBuffer.delete(userKey);
                    await api.tgApiRaw('answerCallbackQuery', { callback_query_id: cb.id, text: '✅ Mã PIN chính xác! Đã mở khóa GMCloud' });

                    // Gửi bảng điều khiển GMCloud vào Topic # (Topic 1)
                    const explorer = buildExplorerMarkup('', 0);
                    try {
                        const sendPayload = {
                            chat_id: chatId,
                            text: explorer.text,
                            parse_mode: 'HTML',
                            reply_markup: explorer.markup
                        };
                        if (GMCLOUD_TOPIC_ID && Number(GMCLOUD_TOPIC_ID) > 1) {
                            sendPayload.message_thread_id = GMCLOUD_TOPIC_ID;
                        }
                        await api.tgApiRaw('sendMessage', sendPayload);
                    } catch (e) {}

                    // Cập nhật giao diện Sảnh
                    const successText = `✅ <b>[XÁC THỰC KHO GMCLOUD THÀNH CÔNG!]</b>\n──────────────────────\n🔓 <b>Trạng thái:</b> ĐÃ MỞ KHÓA KHO MÃ NGUỒN VĨNH CỬU\n🏛️ <b>Kênh lưu trữ:</b> Topic # (<code>☁️ Kho GMCloud Storage</code>)\n⚡ Dữ liệu lưu tại Topic # sẽ không bao giờ bị mất kể cả khi đóng topic dự án!\n\n👉 <i>Bro bấm nút bên dưới để vào duyệt code ngay:</i>`;
                    const successMarkup = {
                        inline_keyboard: [
                            [{ text: '☁️ Vào Kho GMCloud Storage (Topic #)', url: `https://t.me/c/4457846636/1` }],
                            [{ text: '🏛️ Trở về Menu Sảnh', callback_data: 'hub_refresh_menu' }]
                        ]
                    };
                    await api.tgApiRaw('editMessageText', {
                        chat_id: chatId,
                        message_id: messageId,
                        text: successText,
                        parse_mode: 'HTML',
                        reply_markup: successMarkup
                    });
                    return true;
                } else {
                    gmCloudPinBuffer.set(userKey, '');
                    await api.tgApiRaw('answerCallbackQuery', { callback_query_id: cb.id, text: '❌ Mã PIN sai! Vui lòng thử lại' });
                    const retryPad = buildPinKeypad('');
                    await api.tgApiRaw('editMessageText', {
                        chat_id: chatId,
                        message_id: messageId,
                        text: retryPad.text + `\n\n⚠️ <i>Mã PIN không đúng, bro nhập lại nhé (mặc định: 2726):</i>`,
                        parse_mode: 'HTML',
                        reply_markup: retryPad.markup
                    });
                    return true;
                }
            } else {
                const pad = buildPinKeypad(currentPin);
                await api.tgApiRaw('editMessageText', {
                    chat_id: chatId,
                    message_id: messageId,
                    text: pad.text,
                    parse_mode: 'HTML',
                    reply_markup: pad.markup
                });
                return true;
            }
        }

        if (cbData === 'gmpin_del') {
            if (currentPin.length > 0) {
                currentPin = currentPin.slice(0, -1);
                gmCloudPinBuffer.set(userKey, currentPin);
            }
            await api.tgApiRaw('answerCallbackQuery', { callback_query_id: cb.id });
            const pad = buildPinKeypad(currentPin);
            await api.tgApiRaw('editMessageText', {
                chat_id: chatId,
                message_id: messageId,
                text: pad.text,
                parse_mode: 'HTML',
                reply_markup: pad.markup
            });
            return true;
        }

        if (cbData === 'gmpin_cancel') {
            gmCloudPinBuffer.delete(userKey);
            await api.tgApiRaw('answerCallbackQuery', { callback_query_id: cb.id, text: 'Đã hủy mở khóa' });
            return false;
        }

        if (cbData === 'gmpin_enter') {
            const expectedPin = getProjectPin();
            if (currentPin === expectedPin) {
                unlockGmCloud(fromId, chatId);
                gmCloudPinBuffer.delete(userKey);
                await api.tgApiRaw('answerCallbackQuery', { callback_query_id: cb.id, text: '✅ Mã PIN chính xác!' });
                const successText = `✅ <b>[XÁC THỰC KHO GMCLOUD THÀNH CÔNG!]</b>\n──────────────────────\n🔓 <b>Trạng thái:</b> ĐÃ MỞ KHÓA TOÀN QUYỀN\n🏛️ <b>Kênh lưu trữ:</b> Topic # (<code>☁️ Kho GMCloud Storage</code>)\n\n👉 <i>Bro bấm nút bên dưới để vào duyệt code ngay:</i>`;
                const successMarkup = {
                    inline_keyboard: [
                        [{ text: '☁️ Vào Kho GMCloud Storage (Topic #)', url: `https://t.me/c/4457846636/1` }],
                        [{ text: '🏛️ Trở về Menu Sảnh', callback_data: 'hub_refresh_menu' }]
                    ]
                };
                await api.tgApiRaw('editMessageText', {
                    chat_id: chatId,
                    message_id: messageId,
                    text: successText,
                    parse_mode: 'HTML',
                    reply_markup: successMarkup
                });
                return true;
            } else {
                gmCloudPinBuffer.set(userKey, '');
                await api.tgApiRaw('answerCallbackQuery', { callback_query_id: cb.id, text: '❌ Mã PIN không chính xác!' });
                return true;
            }
        }
    }

    // --- B. BẤM NÚT GMCLOUD TỪ SẢNH LOBBY (HOẶC LỆNH /gmcloud) ---
    if (cbData === 'hub_gmcloud') {
        // 1. Kiểm tra xác thực bảo mật
        if (!isGmCloudUnlocked(fromId, chatId)) {
            await api.tgApiRaw('answerCallbackQuery', { callback_query_id: cb.id, text: '🔒 Yêu cầu nhập mã PIN bảo mật' });
            gmCloudPinBuffer.set(userKey, '');
            const pad = buildPinKeypad('');
            await api.tgApiRaw('editMessageText', {
                chat_id: chatId,
                message_id: messageId,
                text: pad.text,
                parse_mode: 'HTML',
                reply_markup: pad.markup
            });
            return true;
        }

        await api.tgApiRaw('answerCallbackQuery', { callback_query_id: cb.id, text: '☁️ Đang mở Kho GMCloud Storage (Topic #)...' });

        const explorer = buildExplorerMarkup('', 0);

        // Gửi bảng điều khiển GMCloud vào Topic # (Topic 1)
        try {
            const sendPayload = {
                chat_id: chatId,
                text: explorer.text,
                parse_mode: 'HTML',
                reply_markup: explorer.markup
            };
            if (GMCLOUD_TOPIC_ID && Number(GMCLOUD_TOPIC_ID) > 1) {
                sendPayload.message_thread_id = GMCLOUD_TOPIC_ID;
            }
            await api.tgApiRaw('sendMessage', sendPayload);
        } catch (e) {
            console.error('[Send GMCloud Explorer Error]:', e.message);
        }

        // Cập nhật Sảnh Lobby thông báo link nhảy vào Topic #
        const lobbyText = `☁️ <b>[KHO GMCLOUD VIRTUAL STORAGE ĐÃ SẴN SÀNG]</b>\n──────────────────────\n📂 <b>Kho mã nguồn ảo:</b> Đang hoạt động tại <b>Topic # (☁️ Kho GMCloud Storage)</b>!\n⚡ <b>Lưu trữ vĩnh cửu:</b> Toàn bộ file và snapshot đều lưu tại Topic #, không bao giờ bị mất kể cả khi đóng topic dự án!\n🔒 <b>Trạng thái:</b> Đã xác thực bảo mật thành công.\n\n👉 <i>Bro bấm nút bên dưới để vào xem mã nguồn ngay:</i>`;
        const lobbyMarkup = {
            inline_keyboard: [
                [{ text: '☁️ Vào Kho GMCloud Storage (Topic #)', url: `https://t.me/c/4457846636/1` }],
                [{ text: '🏛️ Quay lại Menu Sảnh', callback_data: 'hub_refresh_menu' }]
            ]
        };

        if (api.isLobby && api.isLobby(threadId)) {
            await api.editMsg(chatId, messageId, lobbyText, 'HTML', lobbyMarkup, true);
        } else {
            await api.sendMsg(chatId, lobbyText, threadId, 'HTML', lobbyMarkup);
        }
        return true;
    }

    // --- C. CHUYỂN THƯ MỤC: gmcloud_dir:<path> ---
    if (cbData.startsWith('gmcloud_dir:')) {
        const dir = cbData.replace('gmcloud_dir:', '');
        await api.tgApiRaw('answerCallbackQuery', { callback_query_id: cb.id, text: `📁 Thư mục /${dir}` });
        const explorer = buildExplorerMarkup(dir, 0);
        await api.tgApiRaw('editMessageText', {
            chat_id: chatId,
            message_id: messageId,
            text: explorer.text,
            parse_mode: 'HTML',
            reply_markup: explorer.markup
        });
        return true;
    }

    // --- D. CHUYỂN TRANG FILE: gmcloud_page:<dir>:<page> ---
    if (cbData.startsWith('gmcloud_page:')) {
        const parts = cbData.replace('gmcloud_page:', '').split(':');
        const dir = parts[0] || '';
        const page = parseInt(parts[1] || '0', 10);
        await api.tgApiRaw('answerCallbackQuery', { callback_query_id: cb.id, text: `Trang ${page + 1}` });
        const explorer = buildExplorerMarkup(dir, page);
        await api.tgApiRaw('editMessageText', {
            chat_id: chatId,
            message_id: messageId,
            text: explorer.text,
            parse_mode: 'HTML',
            reply_markup: explorer.markup
        });
        return true;
    }

    // --- E. XEM CHI TIẾT FILE: gmcloud_view:<path> ---
    if (cbData.startsWith('gmcloud_view:')) {
        const filePath = cbData.replace('gmcloud_view:', '');
        await api.tgApiRaw('answerCallbackQuery', { callback_query_id: cb.id, text: `⏳ Đang nạp ${path.basename(filePath)}...` });
        await renderFileView(filePath, api, chatId, messageId, threadId);
        return true;
    }

    // --- F. TẢI FILE THÔ (.RAW DOCUMENT): gmcloud_raw:<path> ---
    if (cbData.startsWith('gmcloud_raw:')) {
        const filePath = cbData.replace('gmcloud_raw:', '');
        await api.tgApiRaw('answerCallbackQuery', { callback_query_id: cb.id, text: `⬇️ Đang gửi file ${path.basename(filePath)}...` });
        await sendRawFile(filePath, api, chatId, threadId);
        return true;
    }

    // --- G. ĐỒNG BỘ GMCLOUD TỪ PC VÀO TOPIC # ---
    if (cbData === 'gmcloud_sync') {
        await api.tgApiRaw('answerCallbackQuery', { callback_query_id: cb.id, text: '🔄 Đang đồng bộ cây mã nguồn PC vào Kho GMCloud (Topic #)...' });
        const { syncRepoToGmCloud } = require('./gmcloud_storage.cjs');
        try {
            await syncRepoToGmCloud(api.botToken, chatId, 'https://quin-iu-mthu-code-mobile.letrungquangm.workers.dev', rootDir);
            const explorer = buildExplorerMarkup('', 0);
            await api.tgApiRaw('editMessageText', {
                chat_id: chatId,
                message_id: messageId,
                text: `✅ <b>[ĐỒNG BỘ KHO GMCLOUD THÀNH CÔNG VÀO TOPIC #!]</b>\n\n` + explorer.text,
                parse_mode: 'HTML',
                reply_markup: explorer.markup
            });
        } catch (e) {
            await api.tgApiRaw('answerCallbackQuery', { callback_query_id: cb.id, text: `❌ Lỗi: ${e.message}`, show_alert: true });
        }
        return true;
    }

    if (cbData === 'gmcloud_noop') {
        await api.tgApiRaw('answerCallbackQuery', { callback_query_id: cb.id });
        return true;
    }

    return false;
}

module.exports = {
    GMCLOUD_TOPIC_ID,
    loadGmCloudTopicId,
    buildExplorerMarkup,
    renderFileView,
    sendRawFile,
    handleGmCloudCallback,
    isGmCloudUnlocked,
    unlockGmCloud
};
