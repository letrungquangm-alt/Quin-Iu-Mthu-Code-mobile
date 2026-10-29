/**
 * QuinloveRin Code - Fast Telegram Bridge v2.9 (.cjs)
 * - TỰ ĐỘNG GỠ WEBHOOK CLOUD KHI MÁY TÍNH BẬT (CHUYỂN GIAO MƯỢT MÀ VỀ PC).
 * - NÚT BẤM INLINE 1 CHẠM [🛑 DỪNG TÁC VỤ (CANCEL)]: Hủy ngay lập tức từ điện thoại.
 * - HỖ TRỢ SỬA TIN NHẮN (EDIT MESSAGE): Sửa prompt trên Telegram = Tái khởi động tác vụ mới.
 * - ĐỒNG HỒ BẤM GIỜ NHẢY GIÂY LIVE LIÊN TỤC (2.0s/LẦN) XUYÊN SUỐT CÁC GIAI ĐOẠN:
 *   + 📖 [ĐÃ ĐỌC PROMPT VÀ ĐANG XỬ LÝ YÊU CẦU BẠN, VUI LÒNG ĐỢI (Xs)...]
 *   + ✏️ [ĐÃ CẬP NHẬT PROMPT MỚI, KHỞI ĐỘNG LẠI (Xs)...]
 *   + 💡 [ĐÃ CÓ CÁCH, ĐỢI MÌNH CHÚT - Xs]
 *   + ⏳ [ĐÃ XONG YÊU CẦU CỦA BẠN, CHỜ CHÚT TÔI ĐANG GỬI PHẢN HỒI YÊU CẦU CỦA BẠN (Xs)...]
 * - DỌN DẸP 5 GIÂY TỐI ƯU HÓA: Không spam edit, triệt tiêu 100% lỗi Telegram 429 Rate Limit.
 * - MÀU SẮC TRỰC QUAN CHO CÔNG CỤ (Diff Syntax Highlighting):
 *   + 🟢 [TẠO FILE MỚI] (+ X dòng mã nguồn mới - Xanh lá)
 *   + 🟠 [SỬA FILE] (+ X dòng thêm, - Y dòng sửa, ! Ghi đè - Cam)
 *   + 🔴 [XÓA FILE / THƯ MỤC] (- Lệnh xóa - Đỏ)
 *   + 📄 [ĐỌC FILE] (Kèm phạm vi dòng)
 *   + ⚡ [MÁY TÍNH ĐANG THỰC HIỆN] (Chạy lệnh terminal)
 * - PHẢN CHIẾU 100% TIẾN TRÌNH VÀO BOX CHAT ANTIGRAVITY PC:
 *   + Pop-up nổi Toast trên màn hình máy tính (show_notification.ps1).
 *   + Nạp tin nhắn vào box chat máy tính qua agentapi send-message.
 *   + Giữ câu trả lời vĩnh viễn trên Topic 315.
 */

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const rootDir = __dirname;
const configPath = path.join(rootDir, 'config.json');
const syncBridgePath = path.join(rootDir, 'sync_bridge.json');
const notifScript = path.join(rootDir, 'show_notification.ps1');

if (!fs.existsSync(configPath)) {
    console.error('[Bridge Error] Không tìm thấy config.json tại:', configPath);
    process.exit(1);
}

const config = JSON.parse(fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/, ''));
const botToken = config.BOT_TOKEN;
const allowedChatId = config.ALLOWED_CHAT_ID;
const conversationId = '7f7131ce-dc72-490f-97bd-4a675f9dd0c7';

const transcriptPath = path.join(
    process.env.USERPROFILE,
    '.gemini',
    'antigravity',
    'brain',
    conversationId,
    '.system_generated',
    'logs',
    'transcript.jsonl'
);

const langServer = path.join(
    process.env.LOCALAPPDATA,
    'Programs',
    'antigravity',
    'resources',
    'bin',
    'language_server.exe'
);

const cancelKeyboard = {
    inline_keyboard: [
        [{ text: '🛑 Dừng tác vụ (Cancel)', callback_data: 'cancel_task' }]
    ]
};

console.log('========================================================');
console.log(' Fast Telegram Bridge v2.9 (Edit Message & 1-Touch Cancel)');
console.log(' Bot Token:', botToken ? botToken.substring(0, 10) + '...' : 'NONE');
console.log(' Conversation ID:', conversationId);
console.log(' Transcript:', transcriptPath);
console.log('========================================================');

// --- TELEGRAM API HELPERS ---

async function tgApi(method, data) {
    try {
        const res = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        const json = await res.json();
        if (!json.ok) {
            if (json.error_code === 429 && json.parameters && json.parameters.retry_after) {
                const waitSec = json.parameters.retry_after;
                console.warn(`[429 Rate Limit] Chờ ${waitSec}s trước khi gửi tiếp...`);
                await new Promise(r => setTimeout(r, (waitSec + 1) * 1000));
                return tgApi(method, data);
            }
            if (json.description &&
                !json.description.includes('message to delete not found') &&
                !json.description.includes('message is not modified')) {
                console.warn(`[API ${method} Fail]:`, json.description);
            }
        }
        return json;
    } catch (e) {
        console.error(`[API ${method} Ex]:`, e.message);
        return { ok: false, error: e.message };
    }
}

async function downloadTelegramPhoto(fileId, savePath) {
    try {
        const fileRes = await tgApi('getFile', { file_id: fileId });
        if (fileRes.ok && fileRes.result && fileRes.result.file_path) {
            const fileUrl = `https://api.telegram.org/file/bot${botToken}/${fileRes.result.file_path}`;
            const res = await fetch(fileUrl);
            const buffer = Buffer.from(await res.arrayBuffer());
            fs.writeFileSync(savePath, buffer);
            console.log(`[Bridge Photo] Đã tải ảnh Telegram về: ${savePath} (${buffer.length} bytes)`);
            return savePath;
        }
    } catch (e) {
        console.error('[Bridge Photo Error]:', e.message);
    }
    return null;
}

async function sendTyping(chatId, threadId = 315) {
    const payload = { chat_id: chatId, action: 'typing' };
    if (threadId) payload.message_thread_id = threadId;
    await tgApi('sendChatAction', payload);
}

async function sendMsg(chatId, text, threadId = 315, parseMode = 'HTML', replyMarkup = null) {
    const targetThread = threadId || 315;
    const payload = {
        chat_id: chatId,
        text: text,
        disable_web_page_preview: true,
        message_thread_id: targetThread
    };
    if (parseMode) payload.parse_mode = parseMode;
    if (replyMarkup) payload.reply_markup = replyMarkup;

    const res = await tgApi('sendMessage', payload);
    if (!res.ok && parseMode) {
        delete payload.parse_mode;
        payload.text = text.replace(/<[^>]+>/g, '');
        const fallbackRes = await tgApi('sendMessage', payload);
        return fallbackRes.result ? fallbackRes.result.message_id : null;
    }
    return res.result ? res.result.message_id : null;
}

async function editMsg(chatId, messageId, text, parseMode = 'HTML', replyMarkup = null) {
    if (!messageId) return;
    const payload = {
        chat_id: chatId,
        message_id: messageId,
        text: text,
        disable_web_page_preview: true
    };
    if (parseMode) payload.parse_mode = parseMode;
    if (replyMarkup !== null) {
        payload.reply_markup = replyMarkup;
    }
    const res = await tgApi('editMessageText', payload);
    if (!res.ok && parseMode) {
        delete payload.parse_mode;
        payload.text = text.replace(/<[^>]+>/g, '');
        await tgApi('editMessageText', payload);
    }
}

async function deleteMsgs(chatId, messageIds) {
    if (!messageIds || messageIds.length === 0) return;
    const validIds = messageIds.filter(id => typeof id === 'number' && id > 0);
    if (validIds.length === 0) return;

    if (validIds.length === 1) {
        await tgApi('deleteMessage', { chat_id: chatId, message_id: validIds[0] });
        return;
    }

    for (let i = 0; i < validIds.length; i += 80) {
        const batch = validIds.slice(i, i + 80);
        const res = await tgApi('deleteMessages', { chat_id: chatId, message_ids: batch });
        if (!res.ok) {
            for (const mid of batch) {
                await tgApi('deleteMessage', { chat_id: chatId, message_id: mid });
                await new Promise(r => setTimeout(r, 120));
            }
        }
    }
}

function escapeHtml(str) {
    return (str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function mdToTgHtml(text) {
    if (!text) return '';
    const codeBlocks = [];
    text = text.replace(/```([a-zA-Z0-9_\-\+]*)\r?\n([\s\S]*?)```/g, (m, lang, code) => {
        const c = escapeHtml(code);
        const l = lang || 'text';
        const idx = codeBlocks.length;
        codeBlocks.push(`<pre><code class="language-${l}">${c}</code></pre>`);
        return `___CODE_BLOCK_${idx}___`;
    });

    const inlineCodes = [];
    text = text.replace(/`([^`\r\n]+)`/g, (m, code) => {
        const c = escapeHtml(code);
        const idx = inlineCodes.length;
        inlineCodes.push(`<code>${c}</code>`);
        return `___INLINE_${idx}___`;
    });

    text = escapeHtml(text);
    text = text.replace(/\*\*([^\*\r\n]+)\*\*/g, '<b>$1</b>');
    text = text.replace(/(?<!\w)\*([^\*\r\n]+)\*(?!\w)/g, '<i>$1</i>');
    text = text.replace(/^&gt;\s*([^\r\n]+)/gm, '<blockquote>$1</blockquote>');

    codeBlocks.forEach((b, i) => { text = text.replace(`___CODE_BLOCK_${i}___`, b); });
    inlineCodes.forEach((b, i) => { text = text.replace(`___INLINE_${i}___`, b); });
    return text;
}

async function sendLongResponse(chatId, answerText, totalSec, threadId = 315) {
    if (!answerText) return;

    const targetThreadId = threadId || activeThreadId || 315;
    const maxLen = 3500;
    const headerTitle = `🤖 <b>[MÁY TÍNH ĐÃ PHẢN HỒI XONG TRONG ${totalSec}s]:</b>\n\n`;

    if (answerText.length <= maxLen) {
        const html = mdToTgHtml(answerText);
        await sendMsg(chatId, `${headerTitle}${html}`, targetThreadId);
        return;
    }

    const paragraphs = answerText.split(/\r?\n\r?\n/);
    const chunks = [];
    let currentChunk = '';

    for (const p of paragraphs) {
        if ((currentChunk + '\n\n' + p).length > maxLen) {
            if (currentChunk) chunks.push(currentChunk.trim());
            if (p.length > maxLen) {
                const lines = p.split(/\r?\n/);
                let lineChunk = '';
                for (const l of lines) {
                    if ((lineChunk + '\n' + l).length > maxLen) {
                        if (lineChunk) chunks.push(lineChunk.trim());
                        lineChunk = l;
                    } else {
                        lineChunk = lineChunk ? lineChunk + '\n' + l : l;
                    }
                }
                if (lineChunk) currentChunk = lineChunk;
            } else {
                currentChunk = p;
            }
        } else {
            currentChunk = currentChunk ? currentChunk + '\n\n' + p : p;
        }
    }
    if (currentChunk) chunks.push(currentChunk.trim());

    for (let i = 0; i < chunks.length; i++) {
        const html = mdToTgHtml(chunks[i]);
        const header = (i === 0) ? headerTitle : `<i>(Phần ${i + 1}/${chunks.length})</i>\n\n`;
        await sendMsg(chatId, `${header}${html}`, targetThreadId);
        if (i < chunks.length - 1) {
            await new Promise(r => setTimeout(r, 200));
        }
    }
}

// --- CƠ CHẾ DỌN DẸP ĐẾM NGƯỢC 5S (KHÔNG GÂY LỖI 429 RATE LIMIT) ---

async function runCountdownCleanup(chatId, threadId, msgIdsToDelete) {
    if (!msgIdsToDelete || msgIdsToDelete.length === 0) return;
    const targetThreadId = threadId || activeThreadId || 315;
    try {
        console.log(`[Countdown Cleanup] Bắt đầu dọn dẹp ${msgIdsToDelete.length} tin nhắn tạm trong 5s...`);
        const countdownMsgId = await sendMsg(
            chatId,
            `🧹 <b>[ĐANG DỌN DẸP TIẾN TRÌNH TRONG 5 GIÂY...]</b>`,
            targetThreadId
        );

        for (let s = 4; s >= 1; s--) {
            await new Promise(r => setTimeout(r, 1000));
            if (countdownMsgId) {
                await editMsg(
                    chatId,
                    countdownMsgId,
                    `🧹 <b>[ĐANG DỌN DẸP TIẾN TRÌNH TRONG ${s} GIÂY...]</b>`
                );
            }
        }
        await new Promise(r => setTimeout(r, 1000));

        console.log('[Countdown Cleanup] Xóa toàn bộ tiến trình tạm...');
        await deleteMsgs(chatId, msgIdsToDelete);

        if (countdownMsgId) {
            await editMsg(chatId, countdownMsgId, `✨ <b>[ĐÃ DỌN DẸP THÀNH CÔNG!]</b>`);
            setTimeout(async () => {
                await tgApi('deleteMessage', { chat_id: chatId, message_id: countdownMsgId });
                console.log('[Countdown Cleanup] Hoàn tất, khung chat sạch bong!');
            }, 1500);
        }
    } catch (e) {
        console.error('[Countdown Cleanup Error]:', e.message);
    }
}

// --- COLOR-CODED TOOL CALL FORMATTER ---

function formatToolCall(tc) {
    const toolName = tc.name;
    const args = tc.args || {};
    const rawSummary = args.toolSummary ? args.toolSummary.replace(/^"|"$/g, '') : '';

    let bubbleText = '';
    let summary = rawSummary || `Thực thi ${toolName}`;

    if (toolName === 'run_command') {
        const cmd = args.CommandLine ? args.CommandLine.toString().trim() : '';
        const safeCmd = escapeHtml(cmd.length > 200 ? cmd.substring(0, 200) + '... [dài]' : cmd);

        if (/(Remove-Item|rm\s+|del\s+|rmdir|unlink)/i.test(cmd)) {
            summary = rawSummary || 'Xóa file / thư mục';
            bubbleText = `🔴 <b>[XÓA FILE / THƯ MỤC]</b>\n<pre><code class="language-diff">- ${safeCmd}</code></pre>`;
        } else {
            summary = rawSummary || 'Chạy lệnh terminal';
            bubbleText = `⚡ <b>[ĐANG XỬ LÝ]</b>\n▶ <code>${escapeHtml(summary)}</code>\n<pre><code class="language-powershell">${safeCmd}</code></pre>`;
        }
    } else if (toolName === 'write_file') {
        const rawPath = args.Path ? args.Path.toString().replace(/^"|"$/g, '') : 'file';
        const fileName = path.basename(rawPath);
        const isOverwrite = (args.Overwrite === true || args.Overwrite === 'true');
        const isAppend = (args.Append === true || args.Append === 'true');
        const contentLines = args.Content ? args.Content.toString().split(/\r?\n/).length : 0;
        const fileExisted = fs.existsSync(rawPath);

        if (isOverwrite || isAppend || fileExisted) {
            summary = rawSummary || `Cập nhật file ${fileName}`;
            bubbleText = `🟠 <b>[SỬA FILE]:</b> <code>${fileName}</code>\n<pre><code class="language-diff">--- a/${fileName}\n- Ghi đè thay thế nội dung cũ\n+++ b/${fileName}\n+ ${contentLines} dòng thêm mới</code></pre>`;
        } else {
            summary = rawSummary || `Tạo mới file ${fileName}`;
            bubbleText = `🟢 <b>[TẠO FILE MỚI]:</b> <code>${fileName}</code>\n<pre><code class="language-diff">+++ b/${fileName}\n+ ${contentLines} dòng mã nguồn mới</code></pre>`;
        }
    } else if (toolName === 'edit_file') {
        const rawPath = args.Path ? args.Path.toString().replace(/^"|"$/g, '') : 'file';
        const fileName = path.basename(rawPath);
        const linesRemoved = args.Target ? args.Target.toString().split(/\r?\n/).length : 1;
        const linesAdded = args.Replacement ? args.Replacement.toString().split(/\r?\n/).length : 0;
        summary = rawSummary || `Chỉnh sửa code ${fileName}`;
        bubbleText = `🟠 <b>[SỬA FILE]:</b> <code>${fileName}</code>\n<pre><code class="language-diff">--- a/${fileName}\n- ${linesRemoved} dòng đã xóa\n+++ b/${fileName}\n+ ${linesAdded} dòng thêm</code></pre>`;
    } else if (toolName === 'read_file') {
        const rawPath = args.Path ? args.Path.toString().replace(/^"|"$/g, '') : 'file';
        const fileName = path.basename(rawPath);
        if (/\.(jpg|jpeg|png|webp|gif)$/i.test(fileName)) {
            summary = rawSummary || `Phân tích thị giác hình ảnh ${fileName}`;
            bubbleText = `🖼️ <b>[PHÂN TÍCH HÌNH ẢNH]:</b> <code>${fileName}</code>`;
        } else {
            const sLine = args.StartLine || '';
            const eLine = args.EndLine || '';
            let rangeInfo = '(Đọc toàn bộ file)';
            if (sLine && eLine) rangeInfo = `(Dòng ${sLine} - ${eLine})`;
            else if (sLine) rangeInfo = `(Từ dòng ${sLine})`;
            else if (eLine) rangeInfo = `(Đến dòng ${eLine})`;
            summary = rawSummary || `Đọc nội dung ${fileName}`;
            bubbleText = `📄 <b>[ĐỌC FILE]:</b> <code>${fileName}</code> <i>${rangeInfo}</i>`;
        }
    } else if (toolName === 'manage_task') {
        const action = args.Action || '';
        if (action === 'status' || action === 'list') {
            return { summary: 'Kiểm tra trạng thái', bubbleText: null };
        }
        summary = rawSummary || `Đang xử lý (${action})`;
        bubbleText = `⚡ <b>[ĐANG XỬ LÝ]:</b> <code>${escapeHtml(summary)}</code>`;
    } else {
        summary = rawSummary || `Xử lý ${toolName}`;
        bubbleText = `⚡ <b>[ĐANG XỬ LÝ]</b>\n▶ <code>${escapeHtml(summary)}</code>`;
    }

    return { summary, bubbleText };
}

// --- SYNC BRIDGE DISPATCHER ---

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

function recordSyncMessage(text) {
    if (fs.existsSync(syncBridgePath)) {
        try {
            const raw = fs.readFileSync(syncBridgePath, 'utf8').replace(/^\uFEFF/, '');
            const br = JSON.parse(raw);
            if (!Array.isArray(br.messages)) br.messages = [];
            br.messages.push({
                sender: 'phone',
                timestamp: new Date().toISOString(),
                text: text
            });
            if (br.messages.length > 20) br.messages = br.messages.slice(-20);
            br.active = true;
            br.status = 'CONNECTED';
            br.conversationId = conversationId;
            fs.writeFileSync(syncBridgePath, JSON.stringify(br, null, 4), 'utf8');
        } catch (e) {}
    }
}

function forwardToAntigravity(text) {
    if (fs.existsSync(langServer)) {
        execFile(langServer, ['agentapi', 'send-message', conversationId, text], (err, stdout) => {
            if (err) {
                console.error('[Bridge IPC Error] Không thể chuyển tin nhắn tới Antigravity:', err.message);
            } else {
                console.log('[Bridge IPC OK] Đã nạp tin nhắn vào Box Chat Antigravity PC:', text.substring(0, 50));
            }
        });
    } else {
        console.warn('[Bridge Warning] Không tìm thấy language_server.exe tại:', langServer);
    }
}

// --- STATE MANAGEMENT ---

let activeChatId = -1004457846636;
let activeThreadId = 315;

if (fs.existsSync(syncBridgePath)) {
    try {
        const br = JSON.parse(fs.readFileSync(syncBridgePath, 'utf8').replace(/^\uFEFF/, ''));
        if (br.activeChatId) activeChatId = Number(br.activeChatId);
        if (br.activeThreadId) activeThreadId = Number(br.activeThreadId);
    } catch (e) {}
}
if (!activeThreadId) activeThreadId = 315;
if (!activeChatId) activeChatId = -1004457846636;

let promptStartTime = null;
let promptTextSaved = '';
let promptMsgId = null;
let isPhotoSaved = false;
let isEditedPrompt = false;
let currentPhase = 'IDLE'; // 'IDLE' | 'READING' | 'THINKING' | 'PREPARING_RESPONSE'
let tickerInterval = null;
let lastStatusText = '';
let isUpdatingStatus = false;
let thinkingSent = false;
let currentWorkingMsgId = null;
let currentToolStartTime = null;
let currentToolSummary = '';
let currentToolBubbleText = '';
let typingInterval = null;
let tempMsgIds = [];
let currentCancelMsgId = null;
let lastBubbleTexts = {};
let waitingForPairCode = false;

async function moveCancelButtonTo(chatId, newMsgId, newText, threadId = 315) {
    if (currentCancelMsgId && currentCancelMsgId !== newMsgId) {
        const prevText = lastBubbleTexts[currentCancelMsgId];
        if (prevText) {
            await editMsg(chatId, currentCancelMsgId, prevText, 'HTML', { inline_keyboard: [] });
        }
    }
    currentCancelMsgId = newMsgId;
    if (newMsgId && newText) {
        lastBubbleTexts[newMsgId] = newText;
    }
}

async function removeAllCancelButtons(chatId) {
    if (currentCancelMsgId) {
        const prevText = lastBubbleTexts[currentCancelMsgId];
        if (prevText) {
            await editMsg(chatId, currentCancelMsgId, prevText, 'HTML', { inline_keyboard: [] });
        }
        currentCancelMsgId = null;
    }
}

// --- LIVE TICKING STOPWATCH (EVERY 2.0 SECONDS - CHỐNG NGHẼN 429) ---

async function updateStatusBubble() {
    if (!promptMsgId || !promptStartTime || currentPhase === 'IDLE' || isUpdatingStatus) return;

    const elapsed = Math.max(1, Math.round((Date.now() - promptStartTime) / 1000));
    let text = '';

    if (currentPhase === 'READING') {
        const promptLabel = isEditedPrompt
            ? `✏️ <b>[ĐÃ CẬP NHẬT PROMPT MỚI, KHỞI ĐỘNG LẠI (${elapsed}s)...]</b>`
            : (isPhotoSaved
                ? `📷 <b>[ĐÃ NHẬN ẢNH VÀ ĐANG PHÂN TÍCH, VUI LÒNG ĐỢI (${elapsed}s)...]</b>`
                : `📖 <b>[ĐÃ ĐỌC PROMPT VÀ ĐANG XỬ LÝ YÊU CẦU BẠN, VUI LÒNG ĐỢI (${elapsed}s)...]</b>`);
        const previewClean = (promptTextSaved || '').replace(/[<>]/g, '');
        const previewSafe = escapeHtml(previewClean.length > 55 ? previewClean.substring(0, 55) + '...' : previewClean);
        text = `${promptLabel}\n<blockquote><i>${previewSafe}</i></blockquote>`;
    } else if (currentPhase === 'THINKING') {
        const safe = escapeHtml(promptTextSaved || 'Yêu cầu của bạn');
        text = `💡 <b>[ĐANG SUY NGHĨ, ĐỢI MÌNH CHÚT (${elapsed}s)...]</b>\n<blockquote><i>${safe}</i></blockquote>`;
    } else if (currentPhase === 'GENERATING') {
        text = `⏳ <b>[ĐANG KHỞI TẠO PHẢN HỒI CHO BẠN, VUI LÒNG CHỜ TRONG GIÂY LÁT (${elapsed}s)...]</b>`;
    } else {
        return;
    }

    if (text === lastStatusText) return;

    isUpdatingStatus = true;
    try {
        const kb = (currentCancelMsgId === promptMsgId ? cancelKeyboard : { inline_keyboard: [] });
        await editMsg(activeChatId, promptMsgId, text, 'HTML', kb);
        lastStatusText = text;
        lastBubbleTexts[promptMsgId] = text;
    } catch (e) {
        // Ignored
    } finally {
        isUpdatingStatus = false;
    }
}

function startTicker() {
    if (!tickerInterval) {
        tickerInterval = setInterval(updateStatusBubble, 2000);
    }
}

function stopTicker() {
    if (tickerInterval) {
        clearInterval(tickerInterval);
        tickerInterval = null;
    }
}

// --- XỬ LÝ LỆNH HỦY (CANCEL) ---

async function handleCancelAction(source = 'button') {
    console.log(`[Bridge Action] Người dùng yêu cầu hủy tác vụ (${source})`);
    currentPhase = 'IDLE';
    stopTicker();
    if (typingInterval) {
        clearInterval(typingInterval);
        typingInterval = null;
    }

    const cancelMsg = `🛑 <b>[ĐÃ HỦY TÁC VỤ THEO YÊU CẦU CỦA BRO!]</b>\n<i>Đã dừng tiến trình và dọn dẹp các tác vụ đang thực thi.</i>`;
    if (promptMsgId) {
        await editMsg(activeChatId, promptMsgId, cancelMsg, 'HTML', { inline_keyboard: [] });
    }

    // Gửi tín hiệu thông báo vào Box Chat PC
    forwardToAntigravity(`[LỆNH HỦY TỪ ĐIỆN THOẠI]: Người dùng đã yêu cầu dừng/hủy tác vụ hiện tại.`);

    const toClean = [...tempMsgIds];
    tempMsgIds = [];
    promptStartTime = null;
    promptTextSaved = '';
    lastStatusText = '';
    isPhotoSaved = false;
    isEditedPrompt = false;
    thinkingSent = false;
    currentWorkingMsgId = null;

    if (toClean.length > 0) {
        runCountdownCleanup(activeChatId, activeThreadId, toClean);
    }
}

// --- TRANSCRIPT MIRROR WATCHER ---

let lastOffset = 0;
if (fs.existsSync(transcriptPath)) {
    try {
        lastOffset = fs.statSync(transcriptPath).size;
        console.log('[Bridge] Bắt đầu theo dõi transcript từ byte offset:', lastOffset);
    } catch (e) {}
}

async function processTranscript() {
    if (!fs.existsSync(transcriptPath)) return;
    let stat;
    try { stat = fs.statSync(transcriptPath); } catch (e) { return; }
    if (stat.size <= lastOffset) return;

    const fd = fs.openSync(transcriptPath, 'r');
    const bufLen = stat.size - lastOffset;
    const buf = Buffer.alloc(bufLen);
    fs.readSync(fd, buf, 0, bufLen, lastOffset);
    fs.closeSync(fd);
    lastOffset = stat.size;

    const content = buf.toString('utf8');
    const lines = content.split(/\r?\n/).filter(l => l.trim().length > 0);

    for (const line of lines) {
        try {
            const entry = JSON.parse(line);

            // Bắt Prompt nhập từ PC
            if (entry.type === 'USER_INPUT' && entry.content) {
                const uText = entry.content.toString().trim();
                promptStartTime = Date.now();
                promptTextSaved = uText;
                isPhotoSaved = false;
                isEditedPrompt = false;
                thinkingSent = false;
                currentPhase = 'READING';

                const previewClean = uText.replace(/[<>]/g, '');
                const previewSafe = escapeHtml(previewClean.length > 55 ? previewClean.substring(0, 55) + '...' : previewClean);
                const initialText = `📖 <b>[ĐÃ ĐỌC PROMPT VÀ ĐANG XỬ LÝ YÊU CẦU BẠN, VUI LÒNG ĐỢI (1s)...]</b>\n<blockquote><i>${previewSafe}</i></blockquote>`;

                if (!promptMsgId) {
                    promptMsgId = await sendMsg(
                        activeChatId,
                        initialText,
                        activeThreadId,
                        'HTML',
                        cancelKeyboard
                    );
                    if (promptMsgId) {
                        tempMsgIds.push(promptMsgId);
                        lastStatusText = initialText;
                        await moveCancelButtonTo(activeChatId, promptMsgId, initialText, activeThreadId);
                        startTicker();
                    }
                }
            }

            // Giai đoạn: AI đang suy nghĩ -> Chuyển pha THINKING & tiếp tục đếm giây
            if (entry.thinking && !entry.content && (!entry.tool_calls || entry.tool_calls.length === 0)) {
                if (!thinkingSent) {
                    thinkingSent = true;
                    currentPhase = 'THINKING';
                    startTicker();
                    if (!promptMsgId) {
                        const elapsed = promptStartTime ? Math.max(1, Math.round((Date.now() - promptStartTime) / 1000)) : 1;
                        const safe = escapeHtml(promptTextSaved || 'Yêu cầu của bạn');
                        const text = `💡 <b>[ĐANG SUY NGHĨ, ĐỢI MÌNH CHÚT (${elapsed}s)...]</b>\n<blockquote><i>${safe}</i></blockquote>`;
                        promptMsgId = await sendMsg(activeChatId, text, activeThreadId, 'HTML', cancelKeyboard);
                        if (promptMsgId) {
                            tempMsgIds.push(promptMsgId);
                            lastStatusText = text;
                            await moveCancelButtonTo(activeChatId, promptMsgId, text, activeThreadId);
                        }
                    } else {
                        await updateStatusBubble();
                    }
                }
            }

            // Giai đoạn: Tool Call (Phân loại màu sắc)
            if (entry.tool_calls && entry.tool_calls.length > 0) {
                currentToolStartTime = Date.now();
                currentPhase = 'THINKING'; // Duy trì trạng thái ticking trong suốt quá trình tool chạy
                startTicker(); // Tiếp tục đồng hồ nếu có thêm tool tiếp theo
                for (const tc of entry.tool_calls) {
                    const { summary, bubbleText } = formatToolCall(tc);
                    currentToolSummary = summary;
                    currentToolBubbleText = bubbleText;
                    console.log(`[Bridge Tool Call] ${summary}`);

                    if (bubbleText) {
                        currentWorkingMsgId = await sendMsg(activeChatId, bubbleText, activeThreadId, 'HTML', cancelKeyboard);
                        if (currentWorkingMsgId) {
                            tempMsgIds.push(currentWorkingMsgId);
                            await moveCancelButtonTo(activeChatId, currentWorkingMsgId, bubbleText, activeThreadId);
                        }
                    }
                }
            }

            // Giai đoạn: Hoàn tất Tool Call -> Chuyển sang GENERATING (khởi tạo phản hồi & tiếp tục đếm giây)
            if (entry.type === 'GENERIC' && entry.content) {
                const wSec = currentToolStartTime ? Math.max(1, Math.round((Date.now() - currentToolStartTime) / 1000)) : 1;
                const safeTask = escapeHtml(currentToolSummary || 'Tác vụ');
                console.log(`[Bridge Tool Done in ${wSec}s] ${safeTask}`);

                if (currentWorkingMsgId) {
                    const finishedBubble = currentToolBubbleText
                        ? `${currentToolBubbleText}\n<i>↳ ✅ Hoàn tất trong ${wSec}s</i>`
                        : `✅ <b>[ĐÃ HOÀN TẤT TRONG ${wSec}s]</b>: <code>${safeTask}</code>`;
                    lastBubbleTexts[currentWorkingMsgId] = finishedBubble;
                    await editMsg(
                        activeChatId,
                        currentWorkingMsgId,
                        finishedBubble,
                        'HTML',
                        { inline_keyboard: [] }
                    );
                    currentWorkingMsgId = null;
                    currentToolBubbleText = '';
                }

                currentPhase = 'GENERATING';
                startTicker();
                if (promptMsgId) {
                    await moveCancelButtonTo(activeChatId, promptMsgId, lastStatusText, activeThreadId);
                    await updateStatusBubble();
                }

                sendTyping(activeChatId, activeThreadId);
                if (!typingInterval) {
                    typingInterval = setInterval(() => {
                        sendTyping(activeChatId, activeThreadId);
                    }, 3000);
                }
            }

            // Giai đoạn: Phản hồi hoàn chỉnh từ Antigravity PC
            if (entry.type === 'PLANNER_RESPONSE' && entry.content && (!entry.tool_calls || entry.tool_calls.length === 0)) {
                const answer = entry.content.toString().trim();
                if (!answer) continue;

                currentPhase = 'IDLE';
                stopTicker();

                if (typingInterval) {
                    clearInterval(typingInterval);
                    typingInterval = null;
                }

                const totalSec = promptStartTime ? Math.max(1, Math.round((Date.now() - promptStartTime) / 1000)) : 1;
                console.log('[Bridge] Gửi câu trả lời hoàn chỉnh từ PC tới Telegram...');
                await removeAllCancelButtons(activeChatId);
                await sendLongResponse(activeChatId, answer, totalSec, activeThreadId);

                const toClean = [...tempMsgIds];
                tempMsgIds = [];
                promptMsgId = null;
                promptStartTime = null;
                promptTextSaved = '';
                lastStatusText = '';
                isPhotoSaved = false;
                isEditedPrompt = false;
                thinkingSent = false;
                currentWorkingMsgId = null;

                if (toClean.length > 0) {
                    runCountdownCleanup(activeChatId, activeThreadId, toClean);
                }
            }
        } catch (e) {
            console.error('[Bridge Error] Lỗi parse dòng transcript:', e.message);
        }
    }
}

setInterval(processTranscript, 100);

// --- TELEGRAM POLLING LOOP ---

let pollOffset = 0;

async function pollUpdates() {
    console.log('[Bridge Polling] Khởi động vòng lặp lắng nghe Telegram...');

    // 1. TỰ ĐỘNG GỠ WEBHOOK CLOUD ĐỂ MÁY TÍNH TIẾP QUẢN
    try {
        const delRes = await tgApi('deleteWebhook', { drop_pending_updates: false });
        if (delRes.ok) {
            console.log('[Bridge Polling] Đã gỡ Webhook Cloud, máy tính tiếp quản Long Polling thành công!');
        }
    } catch (e) {}

    const allowedList = [2029333412, -1004457846636];
    if (allowedChatId) allowedList.push(Number(allowedChatId));

    try {
        const initRes = await tgApi('getUpdates', { offset: -1 });
        if (initRes.ok && initRes.result && initRes.result.length > 0) {
            pollOffset = initRes.result[0].update_id + 1;
            console.log('[Bridge Polling] Đồng bộ offset mới nhất:', pollOffset);
        }
    } catch (e) {}

    while (true) {
        try {
            const res = await tgApi('getUpdates', { offset: pollOffset, timeout: 12 });
            if (res.ok && res.result && res.result.length > 0) {
                for (const update of res.result) {
                    pollOffset = update.update_id + 1;

                    // 1. XỬ LÝ NÚT BẤM INLINE (CALLBACK QUERY)
                    if (update.callback_query) {
                        const cb = update.callback_query;
                        const cbData = cb.data;
                        const fromId = cb.from ? cb.from.id : 0;
                        const chatId = cb.message && cb.message.chat ? cb.message.chat.id : activeChatId;

                        const isAllowed = allowedList.includes(Number(chatId)) || allowedList.includes(Number(fromId));
                        if (!isAllowed) continue;

                        await tgApi('answerCallbackQuery', {
                            callback_query_id: cb.id,
                            text: '🛑 Đang dừng tác vụ...'
                        });

                        if (cbData === 'cancel_task') {
                            await handleCancelAction('Inline Button');
                        }
                        continue;
                    }

                    // 2. XỬ LÝ TIN NHẮN MỚI HOẶC TIN NHẮN ĐƯỢC CHỈNH SỬA
                    const msg = update.message || update.edited_message;
                    if (!msg) continue;
                    const isEdit = !!update.edited_message;

                    const chatId = msg.chat.id;
                    const threadId = msg.message_thread_id || 315;
                    const fromId = msg.from ? msg.from.id : 0;

                    // Bỏ qua tin nhắn từ Bot
                    if (msg.from && msg.from.is_bot) continue;

                    const isAllowed = allowedList.includes(Number(chatId)) || allowedList.includes(Number(fromId));
                    if (!isAllowed) {
                        console.log(`[Bridge Security] Chặn tin nhắn từ chatId=${chatId}, fromId=${fromId}`);
                        continue;
                    }

                    activeChatId = chatId;
                    activeThreadId = threadId || 315;

                    let userText = '';
                    let isPhoto = false;
                    let photoFileId = null;

                    if (msg.photo && msg.photo.length > 0) {
                        isPhoto = true;
                        userText = msg.caption ? msg.caption.trim() : 'Phân tích hình ảnh này';
                        const bestPhoto = msg.photo[msg.photo.length - 1];
                        photoFileId = bestPhoto.file_id;
                    } else if (msg.text) {
                        userText = msg.text.trim();
                    }

                    if (!userText && !isPhoto) continue;

                    // Xử lý lệnh hủy nhanh
                    if (/^(?:\/cancel|stop|hủy|dừng|dừng lại)$/i.test(userText)) {
                        await handleCancelAction(isEdit ? 'Edit message to STOP' : 'Text STOP');
                        continue;
                    }

                    // 1. Kiểm tra nếu đang chờ mã 4 số kết nối lại
                    if (waitingForPairCode && (/^\d{4}$/.test(userText.trim()) || /6585/i.test(userText))) {
                        const code = userText.trim();
                        if (code === '6585' || /6585/i.test(code)) {
                            waitingForPairCode = false;
                            console.log(`[Bridge Pair] Đã xác thực thành công mã 4 số: 6585`);
                            forwardToAntigravity(`[LỆNH CƯỠNG CHẾ KẾT NỐI LẠI]: Người dùng đã nhập đúng mã 6585 từ Telegram. Đồng bộ tức thì với cửa sổ Antigravity PC.`);
                            await sendMsg(
                                chatId,
                                `⚡ <b>[ĐÃ KẾT NỐI QUA MÃ 6585 THÀNH CÔNG!]</b>\n──────────────────────\n🖥️ <b>Cửa sổ Antigravity PC:</b> SẴN SÀNG 100%\n🚀 <b>Kênh làm việc:</b> Topic 315 (Quin-Iu-Mthu)\n🔗 <b>Mã định danh:</b> <code>GM_6585_Mthu</code>\n✨ Cầu nối PC đã thức tỉnh hoàn toàn! Bro gửi yêu cầu code hoặc ảnh ngay bây giờ nhé!`,
                                activeThreadId
                            );
                            continue;
                        } else {
                            await sendMsg(
                                chatId,
                                `❌ <b>[SAI MÃ ĐỒNG BỘ]</b>\nMã <code>${code}</code> không chính xác! Vui lòng nhập lại mã 4 số (Ví dụ: <code>6585</code>):`,
                                activeThreadId
                            );
                            continue;
                        }
                    }

                    // 2. Xử lý lệnh cưỡng chế kết nối lại (/ketnoilai, /reconnect, /pc, /local)
                    if (/^(?:\/ketnoilai|\/reconnect|\/pc|\/local|kết nối lại)(?:\s+(\w+))?$/i.test(userText)) {
                        const match = userText.match(/^(?:\/ketnoilai|\/reconnect|\/pc|\/local|kết nối lại)(?:\s+(\w+))?$/i);
                        const providedCode = match ? match[1] : null;

                        if (!providedCode) {
                            waitingForPairCode = true;
                            await sendMsg(
                                chatId,
                                `🔑 <b>[XÁC THỰC KẾT NỐI]</b>\n──────────────────────\nBro vui lòng nhập <b>mã 4 số</b> (Ví dụ: <code>6585</code>) để cưỡng chế đồng bộ với máy tính:`,
                                activeThreadId
                            );
                            continue;
                        }

                        if (providedCode === '6585' || /6585/i.test(providedCode)) {
                            waitingForPairCode = false;
                            console.log(`[Bridge Reconnect] Nhận lệnh cưỡng chế kết nối lại với mã 6585 từ Telegram...`);
                            currentPhase = 'IDLE';
                            stopTicker();
                            if (typingInterval) {
                                clearInterval(typingInterval);
                                typingInterval = null;
                            }
                            tempMsgIds = [];
                            promptMsgId = null;
                            activeThreadId = threadId || 315;

                            forwardToAntigravity(`[LỆNH CƯỠNG CHẾ KẾT NỐI LẠI]: Người dùng yêu cầu đồng bộ tức thì qua mã 6585. Cửa sổ Antigravity PC đã kết nối sẵn sàng 100%.`);

                            await sendMsg(
                                chatId,
                                `⚡ <b>[ĐÃ CƯỠNG CHẾ KẾT NỐI LẠI THÀNH CÔNG!]</b>\n──────────────────────\n🖥️ <b>Cửa sổ Antigravity PC:</b> SẴN SÀNG 100%\n🚀 <b>Kênh làm việc:</b> Topic 315 (Quin-Iu-Mthu)\n🔗 <b>Mã đồng bộ:</b> <code>GM_6585_Mthu</code>\n✨ Cầu nối PC đã thức tỉnh hoàn toàn! Mọi tin nhắn hoặc hình ảnh bro gửi tiếp theo sẽ được xử lý ngay lập tức!`,
                                activeThreadId
                            );
                            continue;
                        } else {
                            waitingForPairCode = true;
                            await sendMsg(
                                chatId,
                                `❌ <b>[MÃ 4 SỐ KHÔNG ĐÚNG]</b>\nMã <code>${providedCode}</code> không khớp. Bro hãy nhập lại mã 4 số chính xác (<code>6585</code>):`,
                                activeThreadId
                            );
                            continue;
                        }
                    }

                    if (isEdit) {
                        console.log(`[Telegram Sửa Tin] (${chatId}, thread=${threadId}): ${userText.substring(0, 50)}`);
                    } else {
                        console.log(`[Telegram Nhận Tin] (${chatId}, thread=${threadId}): ${userText.substring(0, 50)}`);
                    }

                    // Khởi động lại ticker
                    stopTicker();
                    promptStartTime = Date.now();
                    promptTextSaved = userText;
                    isPhotoSaved = isPhoto;
                    isEditedPrompt = isEdit;
                    thinkingSent = false;
                    currentPhase = 'READING';

                    const previewClean = userText.replace(/[<>]/g, '');
                    const previewSafe = escapeHtml(previewClean.length > 55 ? previewClean.substring(0, 55) + '...' : previewClean);

                    const promptLabel = isEdit
                        ? '✏️ <b>[ĐÃ CẬP NHẬT PROMPT MỚI, KHỞI ĐỘNG LẠI (1s)...]</b>'
                        : (isPhoto
                            ? '📷 <b>[ĐÃ NHẬN ẢNH VÀ ĐANG PHÂN TÍCH, VUI LÒNG ĐỢI (1s)...]</b>'
                            : '📖 <b>[ĐÃ ĐỌC PROMPT VÀ ĐANG XỬ LÝ YÊU CẦU BẠN, VUI LÒNG ĐỢI (1s)...]</b>');

                    const initialText = `${promptLabel}\n<blockquote><i>${previewSafe}</i></blockquote>`;

                    if (isEdit && promptMsgId) {
                        await editMsg(chatId, promptMsgId, initialText, 'HTML', cancelKeyboard);
                        lastStatusText = initialText;
                        await moveCancelButtonTo(chatId, promptMsgId, initialText, activeThreadId);
                        startTicker();
                    } else {
                        promptMsgId = await sendMsg(chatId, initialText, activeThreadId, 'HTML', cancelKeyboard);
                        if (promptMsgId) {
                            tempMsgIds.push(promptMsgId);
                            lastStatusText = initialText;
                            await moveCancelButtonTo(chatId, promptMsgId, initialText, activeThreadId);
                            startTicker();
                        }
                    }

                    let localPhotoPath = null;
                    if (isPhoto && photoFileId) {
                        const targetPhoto = path.join(rootDir, 'incoming_photo.jpg');
                        localPhotoPath = await downloadTelegramPhoto(photoFileId, targetPhoto);
                    }

                    showScreenToast(isEdit ? '✏️ Telegram -> Prompt Sửa' : '📱 Telegram -> PC Sync', previewClean);
                    recordSyncMessage(isEdit ? `[Sửa tin]: ${userText}` : userText);
                    const forwardPrompt = localPhotoPath
                        ? `[Điện thoại gửi ảnh]: ${userText} (Đã tải ảnh về máy tại: ${localPhotoPath})`
                        : (isEdit ? `[Điện thoại sửa prompt thành]: ${userText}` : `[Điện thoại gửi]: ${userText}`);
                    forwardToAntigravity(forwardPrompt);
                }
            }
        } catch (e) {
            console.error('[Polling Exception]:', e.message);
            await new Promise(r => setTimeout(r, 2000));
        }
    }
}

pollUpdates();
