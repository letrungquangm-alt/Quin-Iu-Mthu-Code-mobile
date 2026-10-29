const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const {
    botToken,
    allowedChatId,
    cancelKeyboard,
    tgApi,
    sendMsg,
    editMsg,
    deleteMsgs,
    downloadTelegramPhoto,
    sendTyping,
    escapeHtml,
    mdToTgHtml,
    recordBubbleText,
    moveCancelButtonTo,
    removeCancelButtonFrom,
    clearAllCancelButtons,
    getActiveCancelMsgId,
    setActiveCancelMsgId
} = require('./lib/telegram.cjs');

const { formatToolCall } = require('./lib/formatter.cjs');
const { getPinDisplay, getKeypadMarkup } = require('./lib/numpad.cjs');

const rootDir = __dirname;
const conversationId = '7f7131ce-dc72-490f-97bd-4a675f9dd0c7';
const transcriptPath = `C:\\Users\\letru\\.gemini\\antigravity\\brain\\${conversationId}\\.system_generated\\logs\\transcript.jsonl`;
let langServer = path.join(process.env.LOCALAPPDATA || 'C:\\Users\\letru\\AppData\\Local', 'Programs', 'antigravity', 'resources', 'bin', 'language_server.exe');
if (!fs.existsSync(langServer)) {
    langServer = 'C:\\Users\\letru\\AppData\\Local\\Programs\\antigravity\\resources\\bin\\language_server.exe';
}
const notifScript = path.join(rootDir, 'show_notification.ps1');
const syncBridgePath = path.join(rootDir, 'sync_bridge.json');

console.log('========================================================');
console.log(' Fast Modular Telegram Bridge v3.0 (Zero Lag & Strict 1-Cancel)');
console.log(` Bot Token: ${botToken.substring(0, 10)}...`);
console.log(` Conversation ID: ${conversationId}`);
console.log(` Transcript: ${transcriptPath}`);
console.log('========================================================');

// --- DISPATCHERS ---

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
        const raw = fs.readFileSync(syncBridgePath, 'utf8').replace(/^\uFEFF/, '');
        const br = JSON.parse(raw);
        if (br.chatId) activeChatId = Number(br.chatId);
        if (br.threadId) activeThreadId = Number(br.threadId);
    } catch (e) {}
}

let promptMsgId = null;
let promptStartTime = null;
let promptTextSaved = '';
let isPhotoSaved = false;
let isEditedPrompt = false;
let currentPhase = 'IDLE'; // 'IDLE' | 'READING' | 'THINKING' | 'WORKING' | 'CANCELED'
let isCanceled = false;
let tickerInterval = null;
let lastStatusText = '';
let isUpdatingStatus = false;
let currentWorkingMsgId = null;
let currentToolStartTime = null;
let currentToolSummary = '';
let currentToolRunningFn = null;
let currentToolFinishedFn = null;
let lastWorkingBubbleText = '';
let typingInterval = null;
let tempMsgIds = [];
let currentPin = '';
let pinFailedCount = 0;
let waitingForPairCode = false;

// --- LONG RESPONSE SENDER ---

async function sendLongResponse(chatId, answerText, totalSec, threadId = 315) {
    if (!answerText) return;
    const targetThreadId = threadId || activeThreadId || 315;
    const maxLen = 3500;
    const headerTitle = `🤖 <b>[MÁY TÍNH ĐÃ PHẢN HỒI (Hoàn tất trong ${totalSec}s)]:</b>\n\n`;

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

// --- COUNTDOWN CLEANUP 5S ---

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
                await deleteMsgs(chatId, [countdownMsgId]);
                console.log('[Countdown Cleanup] Hoàn tất, khung chat sạch bong!');
            }, 3000);
        }
    } catch (e) {
        console.error('[Countdown Cleanup Error]:', e.message);
    }
}

// --- LIVE TICKING STOPWATCH (EVERY 2.0S) ---

async function updateStatusBubble() {
    if (isUpdatingStatus || currentPhase === 'IDLE' || currentPhase === 'CANCELED') return;

    // A. Nếu có tool đang chạy, đếm giây trực tiếp trên bong bóng tool
    if (currentWorkingMsgId && currentToolStartTime && currentToolRunningFn) {
        const toolElapsed = Math.max(1, Math.round((Date.now() - currentToolStartTime) / 1000));
        const updatedToolText = currentToolRunningFn(toolElapsed);
        if (updatedToolText !== lastWorkingBubbleText) {
            lastWorkingBubbleText = updatedToolText;
            recordBubbleText(currentWorkingMsgId, updatedToolText);
            isUpdatingStatus = true;
            try {
                await editMsg(activeChatId, currentWorkingMsgId, updatedToolText, 'HTML', cancelKeyboard);
            } catch (e) {}
            isUpdatingStatus = false;
        }
        return;
    }

    // B. Nếu không có tool nào đang chạy, đếm giây trên promptMsgId
    if (!promptMsgId || !promptStartTime) return;

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
        text = `💡 <b>[ĐANG SUY NGHĨ & XỬ LÝ (${elapsed}s)...]</b>\n<blockquote><i>${safe}</i></blockquote>`;
    } else {
        return;
    }

    if (text === lastStatusText) return;

    isUpdatingStatus = true;
    try {
        const kb = (getActiveCancelMsgId() === promptMsgId ? cancelKeyboard : { inline_keyboard: [] });
        await editMsg(activeChatId, promptMsgId, text, 'HTML', kb);
        lastStatusText = text;
        recordBubbleText(promptMsgId, text);
    } catch (e) {}
    isUpdatingStatus = false;
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

// --- HANDLE CANCEL ACTION (STOP IMMEDIATELY) ---

async function handleCancelAction(source = 'button') {
    console.log(`[Bridge Action] Người dùng yêu cầu hủy tác vụ (${source})`);
    isCanceled = true;
    currentPhase = 'CANCELED';
    stopTicker();

    if (typingInterval) {
        clearInterval(typingInterval);
        typingInterval = null;
    }

    // Nhảy cóc offset transcript tới cuối file để bỏ qua mọi tool call đang dở dang
    if (fs.existsSync(transcriptPath)) {
        try {
            lastOffset = fs.statSync(transcriptPath).size;
            console.log('[Bridge Cancel] Đã tua nhanh offset transcript để ngừng đọc các tác vụ dở dang:', lastOffset);
        } catch (e) {}
    }

    // Gỡ sạch mọi nút Cancel trong cuộc trò chuyện
    await clearAllCancelButtons(activeChatId, tempMsgIds);

    const cancelMsg = `🛑 <b>[ĐÃ HỦY TÁC VỤ THEO YÊU CẦU CỦA BRO!]</b>\n<i>Đã dừng tiến trình, không chạy tiếp các phần còn lại và tiến hành dọn dẹp.</i>`;
    if (promptMsgId) {
        await editMsg(activeChatId, promptMsgId, cancelMsg, 'HTML', { inline_keyboard: [] });
    } else {
        await sendMsg(activeChatId, cancelMsg, activeThreadId, 'HTML', { inline_keyboard: [] });
    }

    // Báo ngay sang Antigravity PC
    forwardToAntigravity(`[LỆNH HỦY TỪ ĐIỆN THOẠI]: Người dùng đã yêu cầu dừng/hủy tác vụ hiện tại. Ngừng ngay lập tức mọi hoạt động.`);

    const toClean = [...tempMsgIds];
    tempMsgIds = [];
    promptMsgId = null;
    promptStartTime = null;
    promptTextSaved = '';
    lastStatusText = '';
    isPhotoSaved = false;
    isEditedPrompt = false;
    currentWorkingMsgId = null;
    currentToolRunningFn = null;
    currentToolFinishedFn = null;
    lastWorkingBubbleText = '';

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

    // Nếu đã bị hủy, bỏ qua xử lý các khối tool cũ
    if (isCanceled) {
        return;
    }

    const content = buf.toString('utf8');
    const lines = content.split(/\r?\n/).filter(l => l.trim().length > 0);

    for (const line of lines) {
        try {
            const entry = JSON.parse(line);

            // Giai đoạn: Tool Call (Phân loại màu sắc & Ticking)
            if (entry.tool_calls && entry.tool_calls.length > 0) {
                currentToolStartTime = Date.now();
                currentPhase = 'WORKING';
                startTicker();

                for (const tc of entry.tool_calls) {
                    const { summary, runningFn, finishedFn } = formatToolCall(tc);
                    currentToolSummary = summary;
                    currentToolRunningFn = runningFn;
                    currentToolFinishedFn = finishedFn;
                    console.log(`[Bridge Tool Call] ${summary}`);

                    if (runningFn) {
                        // 1. Gỡ nút Cancel ở bong bóng trước đó (đảm bảo CHỈ CÓ 1 NÚT DUY NHẤT)
                        const prevCancelId = getActiveCancelMsgId();
                        if (prevCancelId) {
                            await removeCancelButtonFrom(activeChatId, prevCancelId);
                        }

                        // 2. Gửi bong bóng mới KÈM NÚT CANCEL
                        const initialText = runningFn(1);
                        lastWorkingBubbleText = initialText;
                        currentWorkingMsgId = await sendMsg(
                            activeChatId,
                            initialText,
                            activeThreadId,
                            'HTML',
                            cancelKeyboard
                        );
                        if (currentWorkingMsgId) {
                            tempMsgIds.push(currentWorkingMsgId);
                            setActiveCancelMsgId(currentWorkingMsgId);
                            recordBubbleText(currentWorkingMsgId, initialText);
                        }
                    }
                }
            }

            // Giai đoạn: Hoàn tất Tool Call -> Hiển thị thời gian hoàn thành & chuyển nút Cancel
            if (entry.type === 'GENERIC' && entry.content) {
                const wSec = currentToolStartTime ? Math.max(1, Math.round((Date.now() - currentToolStartTime) / 1000)) : 1;
                const safeTask = escapeHtml(currentToolSummary || 'Tác vụ');
                console.log(`[Bridge Tool Done in ${wSec}s] ${safeTask}`);

                if (currentWorkingMsgId) {
                    const finishedBubble = currentToolFinishedFn
                        ? currentToolFinishedFn(wSec)
                        : `✅ <b>[ĐÃ HOÀN TẤT TRONG ${wSec}s]</b>: <code>${safeTask}</code>`;
                    recordBubbleText(currentWorkingMsgId, finishedBubble);
                    
                    // Gỡ nút cancel khỏi tool vừa hoàn tất và chốt kết quả
                    await editMsg(
                        activeChatId,
                        currentWorkingMsgId,
                        finishedBubble,
                        'HTML',
                        { inline_keyboard: [] }
                    );
                    setActiveCancelMsgId(null);
                    currentWorkingMsgId = null;
                    currentToolRunningFn = null;
                    currentToolFinishedFn = null;
                    lastWorkingBubbleText = '';
                }

                currentPhase = 'THINKING';
                startTicker();

                // Đưa nút Cancel về lại promptMsgId (vì agent đang tiếp tục suy nghĩ / viết kết luận)
                if (promptMsgId) {
                    setActiveCancelMsgId(promptMsgId);
                    const elapsed = promptStartTime ? Math.max(1, Math.round((Date.now() - promptStartTime) / 1000)) : 1;
                    const safe = escapeHtml(promptTextSaved || 'Yêu cầu của bạn');
                    const text = `💡 <b>[ĐANG SUY NGHĨ & XỬ LÝ (${elapsed}s)...]</b>\n<blockquote><i>${safe}</i></blockquote>`;
                    lastStatusText = text;
                    recordBubbleText(promptMsgId, text);
                    await editMsg(activeChatId, promptMsgId, text, 'HTML', cancelKeyboard);
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
                isCanceled = false;
                stopTicker();

                if (typingInterval) {
                    clearInterval(typingInterval);
                    typingInterval = null;
                }

                const totalSec = promptStartTime ? Math.max(1, Math.round((Date.now() - promptStartTime) / 1000)) : 1;
                console.log(`[Bridge] Gửi câu trả lời hoàn chỉnh từ PC tới Telegram (Hoàn tất trong ${totalSec}s)...`);
                
                // Gỡ sạch mọi nút Cancel
                await clearAllCancelButtons(activeChatId, tempMsgIds);
                await sendLongResponse(activeChatId, answer, totalSec, activeThreadId);

                const toClean = [...tempMsgIds];
                tempMsgIds = [];
                promptMsgId = null;
                promptStartTime = null;
                promptTextSaved = '';
                lastStatusText = '';
                isPhotoSaved = false;
                isEditedPrompt = false;
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

// --- TELEGRAM LONG POLLING DISPATCHER ---

async function pollUpdates() {
    let pollOffset = 0;
    console.log('[Bridge Polling] Khởi động vòng lặp lắng nghe Telegram...');

    try {
        const delRes = await tgApi('deleteWebhook');
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

                        // A. XỬ LÝ NÚT SỐ TRÊN BÀN PHÍM PIN (1 - 9)
                        if (cbData.startsWith('pin_num_')) {
                            const num = cbData.replace('pin_num_', '');
                            if (currentPin.length < 4) {
                                currentPin += num;
                                await tgApi('answerCallbackQuery', { callback_query_id: cb.id, text: `Đã bấm: ${num}` });
                                const screen = `📟 <b>[BÀN PHÍM XÁC THỰC KẾT NỐI]</b>\n──────────────────────\nMàn hình: <code>${getPinDisplay(currentPin)}</code>\n<i>(Nhập 4 số rồi bấm ↵ Enter để kết nối với PC)</i>`;
                                await editMsg(chatId, cb.message.message_id, screen, 'HTML', getKeypadMarkup());
                            } else {
                                await tgApi('answerCallbackQuery', { callback_query_id: cb.id, text: 'Đã đủ 4 số! Hãy bấm ↵ Enter' });
                            }
                            continue;
                        }

                        // B. XỬ LÝ NÚT XÓA TỪNG SỐ (BACKSPACE)
                        if (cbData === 'pin_action_backspace') {
                            if (currentPin.length > 0) {
                                currentPin = currentPin.slice(0, -1);
                                await tgApi('answerCallbackQuery', { callback_query_id: cb.id, text: 'Đã xóa 1 số' });
                                const screen = `📟 <b>[BÀN PHÍM XÁC THỰC KẾT NỐI]</b>\n──────────────────────\nMàn hình: <code>${getPinDisplay(currentPin)}</code>\n<i>(Nhập 4 số rồi bấm ↵ Enter để kết nối với PC)</i>`;
                                await editMsg(chatId, cb.message.message_id, screen, 'HTML', getKeypadMarkup());
                            } else {
                                await tgApi('answerCallbackQuery', { callback_query_id: cb.id, text: 'Màn hình đang trống' });
                            }
                            continue;
                        }

                        // C. XỬ LÝ NÚT HỦY PIN KEYPAD -> Về lại Cloud bình thường
                        if (cbData === 'pin_action_cancel') {
                            currentPin = '';
                            pinFailedCount = 0;
                            await tgApi('answerCallbackQuery', { callback_query_id: cb.id, text: 'Đã hủy xác thực' });
                            const cancelText = `☁️ <b>[ĐÃ HỦY NHẬP MÃ ĐỒNG BỘ]</b>\n──────────────────────\nBro đã hủy bàn phím nhập mã. Hệ thống duy trì chế độ Vercel Cloud 24/7 bình thường (không chặn).\n\n👉 Khi cần kết nối lại, gõ <code>/ketnoi</code> hoặc <code>/ketnoilai</code>.`;
                            await editMsg(chatId, cb.message.message_id, cancelText, 'HTML', { inline_keyboard: [] });
                            continue;
                        }

                        // D. XỬ LÝ NÚT ENTER (XÁC NHẬN MÃ)
                        if (cbData === 'pin_action_enter') {
                            if (currentPin.length < 4) {
                                await tgApi('answerCallbackQuery', { callback_query_id: cb.id, text: 'Vui lòng nhập đủ 4 số trước khi Enter!' });
                                continue;
                            }

                            if (currentPin === '6585') {
                                pinFailedCount = 0;
                                currentPin = '';
                                currentPhase = 'IDLE';
                                isCanceled = false;
                                stopTicker();
                                if (typingInterval) {
                                    clearInterval(typingInterval);
                                    typingInterval = null;
                                }
                                tempMsgIds = [];
                                promptMsgId = null;
                                activeThreadId = (cb.message && cb.message.message_thread_id) || activeThreadId || 315;
                                await tgApi('answerCallbackQuery', { callback_query_id: cb.id, text: '✅ Mã chính xác! Đang kết nối...' });
                                const successText = `⚡ <b>[ĐÃ KẾT NỐI QUA MÃ 6585 THÀNH CÔNG!]</b>\n──────────────────────\n🖥️ <b>Cửa sổ Antigravity PC:</b> SẴN SÀNG 100%\n🚀 <b>Kênh làm việc:</b> Topic 315 (Quin-Iu-Mthu)\n🔗 <b>Mã định danh:</b> <code>GM_6585_Mthu</code>\n✨ Đã cưỡng chế kết nối máy tính thành công! Bro gửi yêu cầu code hoặc ảnh ngay bây giờ nhé!`;
                                await editMsg(chatId, cb.message.message_id, successText, 'HTML', { inline_keyboard: [] });
                                forwardToAntigravity(`[LỆNH CƯỠNG CHẾ KẾT NỐI LẠI]: Người dùng đã nhập đúng mã 6585 qua bàn phím PIN. Đồng bộ tức thì với cửa sổ Antigravity PC.`);
                                continue;
                            } else {
                                pinFailedCount++;
                                currentPin = '';

                                if (pinFailedCount >= 3) {
                                    pinFailedCount = 0;
                                    await tgApi('answerCallbackQuery', { callback_query_id: cb.id, text: '❌ Sai 3 lần! Trở về Cloud 24/7' });
                                    const failMaxText = `☁️ <b>[NHẬP SAI 3 LẦN - TRỞ VỀ CLOUD 24/7]</b>\n──────────────────────\nBro đã nhập sai mã 3 lần. Hệ thống tự động chuyển về chế độ Vercel Cloud 24/7 bình thường (không chặn).\n\n👉 Khi muốn kết nối lại với PC, gõ <code>/ketnoi</code> hoặc <code>/ketnoilai</code>.`;
                                    await editMsg(chatId, cb.message.message_id, failMaxText, 'HTML', { inline_keyboard: [] });
                                    continue;
                                } else {
                                    await tgApi('answerCallbackQuery', { callback_query_id: cb.id, text: `❌ Sai mã! Còn ${3 - pinFailedCount} lần thử` });
                                    const retryText = `❌ <b>[MÃ 4 SỐ KHÔNG CHÍNH XÁC!]</b> <i>(Sai ${pinFailedCount}/3 lần)</i>\n──────────────────────\nMàn hình: <code>${getPinDisplay('')}</code>\n<i>Vui lòng nhập lại mã 4 số chính xác rồi bấm ↵ Enter:</i>`;
                                    await editMsg(chatId, cb.message.message_id, retryText, 'HTML', getKeypadMarkup());
                                    continue;
                                }
                            }
                        }

                        // E. XỬ LÝ NÚT HỦY TÁC VỤ ĐANG CHẠY (CANCEL_TASK)
                        if (cbData === 'cancel_task') {
                            await tgApi('answerCallbackQuery', {
                                callback_query_id: cb.id,
                                text: '🛑 Đang dừng tác vụ...'
                            });
                            // Ngay lập tức gỡ bỏ nút trên chính tin nhắn vừa được bấm
                            if (cb.message && cb.message.message_id) {
                                const msgText = cb.message.text ? escapeHtml(cb.message.text) : '🛑 Đang dừng tác vụ...';
                                await editMsg(chatId, cb.message.message_id, msgText, 'HTML', { inline_keyboard: [] });
                            }
                            await handleCancelAction('Inline Button');
                            continue;
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

                    if (msg.text) {
                        userText = msg.text.trim();
                    } else if (msg.caption) {
                        userText = msg.caption.trim();
                    }

                    if (msg.photo && Array.isArray(msg.photo) && msg.photo.length > 0) {
                        isPhoto = true;
                        photoFileId = msg.photo[msg.photo.length - 1].file_id;
                        if (!userText) userText = 'Phân tích hình ảnh này';
                    }

                    if (!userText && !isPhoto) continue;

                    // Xử lý lệnh hủy nhanh
                    if (/^(?:\/cancel|stop|hủy|dừng|dừng lại)$/i.test(userText)) {
                        await handleCancelAction(isEdit ? 'Edit message to STOP' : 'Text STOP');
                        continue;
                    }

                    // 1. Kiểm tra nếu đang chờ mã 4 số kết nối lại
                    if ((waitingForPairCode && /^\d{4}$/.test(userText.trim())) || userText.trim() === '6585') {
                        const code = userText.trim();
                        if (code === '6585') {
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

                    // 2. Xử lý lệnh cưỡng chế kết nối lại (/ketnoi, /ketnoilai, /reconnect, /pc, /local)
                    if (/^(?:\/ketnoi|\/ketnoilai|\/reconnect|\/pc|\/local|kết nối lại)(?:\s+(\w+))?$/i.test(userText.trim())) {
                        const match = userText.trim().match(/^(?:\/ketnoi|\/ketnoilai|\/reconnect|\/pc|\/local|kết nối lại)(?:\s+(\w+))?$/i);
                        const providedCode = match ? match[1] : null;

                        if (!providedCode) {
                            currentPin = '';
                            pinFailedCount = 0;
                            const initialScreen = `📟 <b>[BÀN PHÍM XÁC THỰC KẾT NỐI]</b>\n──────────────────────\nMàn hình: <code>${getPinDisplay('')}</code>\n<i>(Nhập mã 4 số rồi bấm ↵ Enter để kết nối với PC)</i>`;
                            await sendMsg(chatId, initialScreen, activeThreadId, 'HTML', getKeypadMarkup());
                            continue;
                        }

                        if (providedCode === '6585' || /6585/i.test(providedCode)) {
                            waitingForPairCode = false;
                            currentPhase = 'IDLE';
                            isCanceled = false;
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

                    // Tải ảnh nếu có
                    let localPhotoPath = null;
                    if (isPhoto && photoFileId) {
                        const targetPhoto = path.join(rootDir, 'incoming_photo.jpg');
                        localPhotoPath = await downloadTelegramPhoto(photoFileId, targetPhoto);
                    }

                    const forwardPrompt = localPhotoPath
                        ? `[Điện thoại gửi ảnh]: ${userText} (Đã tải ảnh về máy tại: ${localPhotoPath})`
                        : (isEdit ? `[Điện thoại sửa prompt thành]: ${userText}` : `[Điện thoại gửi]: ${userText}`);

                    // 👉 1. BẮN PROMPT SANG ANTIGRAVITY PC NGAY LẬP TỨC (SIÊU TỐC 1MS)
                    forwardToAntigravity(forwardPrompt);
                    console.log(`[Bridge Dispatch OK] Đã nạp prompt sang PC: ${userText.substring(0, 50)}`);

                    const previewClean = userText.replace(/[<>]/g, '');
                    const previewSafe = escapeHtml(previewClean.length > 55 ? previewClean.substring(0, 55) + '...' : previewClean);
                    showScreenToast(isEdit ? '✏️ Telegram -> Prompt Sửa' : '📱 Telegram -> PC Sync', previewClean);
                    recordSyncMessage(isEdit ? `[Sửa tin]: ${userText}` : userText);

                    // 👉 2. NẾU MÁY TÍNH ĐANG BẬN CHẠY TÁC VỤ KHÁC: BÁO RÕ RÀNG VÀO HÀNG ĐỢI
                    if (currentPhase !== 'IDLE' && currentPhase !== 'CANCELED') {
                        const queueNotice = `📥 <b>[ĐÃ NẠP VÀO HÀNG ĐỢI PC]</b>\n<blockquote><i>${previewSafe}</i></blockquote>\n<i>Máy tính đang xử lý tác vụ trước đó. Prompt mới của bro đã được nạp vào hàng đợi và PC sẽ thực thi tiếp nối ngay!</i>`;
                        await sendMsg(chatId, queueNotice, activeThreadId, 'HTML');
                        continue;
                    }

                    // 👉 3. NẾU MÁY TÍNH ĐANG IDLE: BẬT TIẾN TRÌNH MỚI
                    isCanceled = false;
                    currentPhase = 'READING';
                    stopTicker();
                    promptStartTime = Date.now();
                    promptTextSaved = userText;
                    isPhotoSaved = isPhoto;
                    isEditedPrompt = isEdit;

                    const promptLabel = isEdit
                        ? '✏️ <b>[ĐÃ CẬP NHẬT PROMPT MỚI, KHỞI ĐỘNG LẠI (1s)...]</b>'
                        : (isPhoto
                            ? '📷 <b>[ĐÃ NHẬN ẢNH VÀ ĐANG PHÂN TÍCH, VUI LÒNG ĐỢI (1s)...]</b>'
                            : '📖 <b>[ĐÃ ĐỌC PROMPT VÀ ĐANG XỬ LÝ YÊU CẦU BẠN, VUI LÒNG ĐỢI (1s)...]</b>');

                    const initialText = `${promptLabel}\n<blockquote><i>${previewSafe}</i></blockquote>`;

                    if (isEdit && promptMsgId) {
                        await editMsg(chatId, promptMsgId, initialText, 'HTML', cancelKeyboard);
                        lastStatusText = initialText;
                        recordBubbleText(promptMsgId, initialText);
                        setActiveCancelMsgId(promptMsgId);
                        startTicker();
                    } else {
                        // Gỡ sạch mọi nút cancel cũ trước khi tạo tin nhắn mới
                        await clearAllCancelButtons(chatId);
                        promptMsgId = await sendMsg(chatId, initialText, activeThreadId, 'HTML', cancelKeyboard);
                        if (promptMsgId) {
                            tempMsgIds.push(promptMsgId);
                            lastStatusText = initialText;
                            recordBubbleText(promptMsgId, initialText);
                            setActiveCancelMsgId(promptMsgId);
                            startTicker();
                        }
                    }
                }
            }
        } catch (e) {
            console.error('[Polling Exception]:', e.message);
            await new Promise(r => setTimeout(r, 2000));
        }
    }
}

pollUpdates();
