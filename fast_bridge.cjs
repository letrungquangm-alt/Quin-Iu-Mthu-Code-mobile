const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const {
    botToken,
    allowedChatId,
    cancelKeyboard,
    tgApi,
    tgApiRaw,
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
const {
    promptQueue,
    getQueueButtons,
    addPrompt,
    removePrompt,
    getPrompt,
    getNextPrompt,
    updatePrompt,
    getQueueListMarkup
} = require('./lib/queue.cjs');

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
console.log(' Fast Modular Telegram Bridge v3.2 (Cloud Standby & Raw Polling)');
console.log(` Working Dir: ${rootDir}`);
console.log(` Bot Token: ${botToken.substring(0, 10)}...`);
console.log(` Conversation ID: ${conversationId}`);
console.log(` Language Server: ${langServer}`);
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
            if (br.messages.length > 25) br.messages = br.messages.slice(-25);
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
                console.log('[Bridge IPC OK] Đã nạp tin nhắn vào Box Chat Antigravity PC:', text.substring(0, 60));
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
let isCloudStandby = false;
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
let waitingForEditQueueId = null;

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

// --- SILENT CLEANUP (ZERO SPAM, 1 API CALL) ---

async function runCountdownCleanup(chatId, threadId, msgIdsToDelete) {
    if (!msgIdsToDelete || msgIdsToDelete.length === 0) return;
    try {
        console.log(`[Cleanup] Dọn dẹp ${msgIdsToDelete.length} tin nhắn tạm sau 1.5s...`);
        setTimeout(async () => {
            await deleteMsgs(chatId, msgIdsToDelete);
            console.log('[Cleanup] Hoàn tất, khung chat sạch bong!');
        }, 1500);
    } catch (e) {
        console.error('[Cleanup Error]:', e.message);
    }
}

function formatStopwatch(sec) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m > 0 ? m + 'm ' : ''}${s}s`;
}

// --- LIVE TICKING STOPWATCH (EVERY 1.5S) ---

async function updateStatusBubble() {
    if (isUpdatingStatus || currentPhase === 'IDLE' || currentPhase === 'CANCELED') return;

    // A. Nếu có tool đang chạy và có runningFn, đếm giây trên bong bóng tool
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
    const timeStr = formatStopwatch(elapsed);
    let text = '';

    if (currentPhase === 'READING') {
        const promptLabel = isEditedPrompt
            ? `✏️ <b>[ĐÃ CẬP NHẬT PROMPT MỚI]</b> • ⏱️ <code>${timeStr}</code>`
            : (isPhotoSaved
                ? `📷 <b>[ĐÃ NHẬN ẢNH VÀ ĐANG PHÂN TÍCH]</b> • ⏱️ <code>${timeStr}</code>`
                : `📖 <b>[ĐÃ ĐỌC PROMPT &amp; ĐANG XỬ LÝ]</b> • ⏱️ <code>${timeStr}</code>`);
        const previewClean = (promptTextSaved || '').replace(/[<>]/g, '');
        const previewSafe = escapeHtml(previewClean.length > 55 ? previewClean.substring(0, 55) + '...' : previewClean);
        text = `${promptLabel}\n<blockquote><i>${previewSafe}</i></blockquote>\n⏱️ <i>Đang đếm giây xử lý: ${timeStr}...</i>`;
    } else if (currentPhase === 'THINKING' || currentPhase === 'WORKING') {
        const safe = escapeHtml(promptTextSaved || 'Yêu cầu của bạn');
        const detail = currentToolSummary ? `\n<i>⚡ ${escapeHtml(currentToolSummary)}</i>` : '';
        text = `💡 <b>[ĐANG SUY NGHĨ &amp; XỬ LÝ]</b> • ⏱️ <code>${timeStr}</code>\n<blockquote><i>${safe}</i></blockquote>${detail}\n⏱️ <i>Đang đếm giây xử lý: ${timeStr}...</i>`;
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
        tickerInterval = setInterval(updateStatusBubble, 1500);
    }
}

function stopTicker() {
    if (tickerInterval) {
        clearInterval(tickerInterval);
        tickerInterval = null;
    }
}

// --- HANDLE DISCONNECT & CLOUD HANDOVER ---

async function handleDisconnectCloud() {
    console.log('[Bridge Disconnect] Người dùng yêu cầu ngắt kết nối máy tính, bàn giao cho Cloud 24/7');
    isCloudStandby = true;
    stopTicker();
    if (typingInterval) {
        clearInterval(typingInterval);
        typingInterval = null;
    }
    await clearAllCancelButtons(activeChatId, tempMsgIds);
    tempMsgIds = [];
    promptMsgId = null;
    currentWorkingMsgId = null;

    const handoverText = `☁️ <b>[ĐÃ NGẮT KẾT NỐI VỚI PC - BÀN GIAO CHO VERCEL CLOUD 24/7]</b>\n──────────────────────\n🖥️ <b>Máy tính:</b> Đã ngưng tiếp nhận lệnh trực tiếp (Chế độ Chờ)\n🌐 <b>Vercel Cloud:</b> ĐÃ TIẾP QUẢN 24/7!\n\n✨ Giờ bro có thể chat, yêu cầu code, phân tích ảnh hoặc commit file lên GitHub an toàn ngay cả khi máy tính tắt nguồn hoặc cúp điện!\n\n👉 Khi muốn kết nối lại máy tính, chỉ cần gõ <code>/pc</code>, <code>/ketnoi</code> hoặc nhập mã <code>6585</code>.`;
    await sendMsg(activeChatId, handoverText, activeThreadId, 'HTML', { inline_keyboard: [] });

    try {
        const setRes = await tgApiRaw('setWebhook', { url: 'https://quiniumthucode.vercel.app/api/webhook' });
        console.log('[Bridge Disconnect] Đã gán Webhook Vercel:', setRes);
    } catch (e) {
        console.error('[Bridge Disconnect Error]:', e.message);
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

    if (fs.existsSync(transcriptPath)) {
        try {
            lastOffset = fs.statSync(transcriptPath).size;
            console.log('[Bridge Cancel] Đã tua nhanh offset transcript để ngừng đọc các tác vụ dở dang:', lastOffset);
        } catch (e) {}
    }

    await clearAllCancelButtons(activeChatId, tempMsgIds);

    const cancelMsg = `🛑 <b>[ĐÃ HỦY TÁC VỤ THEO YÊU CẦU CỦA BRO!]</b>\n<i>Đã dừng tiến trình, không chạy tiếp các phần còn lại và tiến hành dọn dẹp.</i>`;
    if (promptMsgId) {
        await editMsg(activeChatId, promptMsgId, cancelMsg, 'HTML', { inline_keyboard: [] }, true);
    } else {
        await sendMsg(activeChatId, cancelMsg, activeThreadId, 'HTML', { inline_keyboard: [] });
    }

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

// --- START PROMPT EXECUTION HELPER ---

async function executePromptImmediately(chatId, threadId, promptText, previewText, isEdit = false, isPhoto = false) {
    isCanceled = false;
    currentPhase = 'READING';
    stopTicker();
    promptStartTime = Date.now();
    promptTextSaved = previewText;
    isPhotoSaved = isPhoto;
    isEditedPrompt = isEdit;

    forwardToAntigravity(promptText);
    sendTyping(chatId, threadId);
    if (!typingInterval) {
        typingInterval = setInterval(() => {
            sendTyping(chatId, threadId);
        }, 3500);
    }

    const promptLabel = isEdit
        ? '✏️ <b>[ĐÃ CẬP NHẬT PROMPT MỚI]</b> • ⏱️ <code>1s</code>'
        : (isPhoto
            ? '📷 <b>[ĐÃ NHẬN ẢNH VÀ ĐANG PHÂN TÍCH]</b> • ⏱️ <code>1s</code>'
            : '📖 <b>[ĐÃ ĐỌC PROMPT &amp; ĐANG XỬ LÝ]</b> • ⏱️ <code>1s</code>');

    const previewClean = previewText.replace(/[<>]/g, '');
    const previewSafe = escapeHtml(previewClean.length > 55 ? previewClean.substring(0, 55) + '...' : previewClean);
    const initialText = `${promptLabel}\n<blockquote><i>${previewSafe}</i></blockquote>\n⏱️ <i>Đang đếm giây xử lý: 1s...</i>`;

    await clearAllCancelButtons(chatId);
    promptMsgId = await sendMsg(chatId, initialText, threadId, 'HTML', cancelKeyboard);
    if (promptMsgId) {
        tempMsgIds.push(promptMsgId);
        lastStatusText = initialText;
        recordBubbleText(promptMsgId, initialText);
        setActiveCancelMsgId(promptMsgId);
        startTicker();
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
    if (isCloudStandby || !fs.existsSync(transcriptPath)) return;
    let stat;
    try { stat = fs.statSync(transcriptPath); } catch (e) { return; }
    if (stat.size <= lastOffset) return;

    const fd = fs.openSync(transcriptPath, 'r');
    const bufLen = stat.size - lastOffset;
    const buf = Buffer.alloc(bufLen);
    fs.readSync(fd, buf, 0, bufLen, lastOffset);
    fs.closeSync(fd);
    lastOffset = stat.size;

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

                for (const tc of entry.tool_calls) {
                    const { summary, runningFn, finishedFn } = formatToolCall(tc);
                    currentToolSummary = summary;
                    currentToolRunningFn = runningFn;
                    currentToolFinishedFn = finishedFn;
                    console.log(`[Bridge Tool Call] ${summary}`);

                    // CHỈ tạo bong bóng riêng cho các tool thực thi quan trọng (run_command, write_file, edit_file)
                    if (runningFn) {
                        const prevCancelId = getActiveCancelMsgId();
                        if (prevCancelId) {
                            await removeCancelButtonFrom(activeChatId, prevCancelId);
                        }

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
                startTicker();
            }

            // Giai đoạn: Hoàn tất Tool Call
            if (entry.type === 'GENERIC' && entry.content) {
                const wSec = currentToolStartTime ? Math.max(1, Math.round((Date.now() - currentToolStartTime) / 1000)) : 1;
                const safeTask = escapeHtml(currentToolSummary || 'Tác vụ');
                console.log(`[Bridge Tool Done in ${wSec}s] ${safeTask}`);

                if (currentWorkingMsgId) {
                    const finishedBubble = currentToolFinishedFn
                        ? currentToolFinishedFn(wSec)
                        : `✅ <b>[ĐÃ HOÀN TẤT TRONG ${wSec}s]</b>: <code>${safeTask}</code>`;
                    recordBubbleText(currentWorkingMsgId, finishedBubble);

                    await editMsg(
                        activeChatId,
                        currentWorkingMsgId,
                        finishedBubble,
                        'HTML',
                        { inline_keyboard: [] },
                        true
                    );
                    setActiveCancelMsgId(null);
                    currentWorkingMsgId = null;
                    currentToolRunningFn = null;
                    currentToolFinishedFn = null;
                    lastWorkingBubbleText = '';
                }

                currentPhase = 'THINKING';
                startTicker();

                if (promptMsgId) {
                    setActiveCancelMsgId(promptMsgId);
                }

                sendTyping(activeChatId, activeThreadId);
                if (!typingInterval) {
                    typingInterval = setInterval(() => {
                        sendTyping(activeChatId, activeThreadId);
                    }, 4000);
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

                // Chạy prompt tiếp theo trong hàng đợi (nếu có)
                if (promptQueue.length > 0) {
                    const nextItem = getNextPrompt();
                    if (nextItem) {
                        const remCount = promptQueue.length;
                        const remNotice = remCount > 0 ? `\n<i>(Còn lại trong hàng chờ: ${remCount} prompt)</i>` : '';
                        await sendMsg(
                            activeChatId,
                            `🚀 <b>[ĐANG THỰC THI PROMPT TIẾP THEO TỪ HÀNG ĐỢI]:</b>\n<blockquote><i>${escapeHtml(nextItem.preview)}</i></blockquote>${remNotice}`,
                            activeThreadId
                        );
                        await executePromptImmediately(nextItem.chatId, nextItem.threadId, nextItem.text, nextItem.preview);
                    }
                }
            }
        } catch (e) {
            console.error('[Bridge Error] Lỗi parse dòng transcript:', e.message);
        }
    }
}

setInterval(processTranscript, 120);

// --- TELEGRAM RAW POLLING & STANDBY DISPATCHER ---

async function pollUpdates() {
    let pollOffset = 0;
    console.log('[Bridge Polling] Khởi động vòng lặp lắng nghe Telegram...');

    try {
        const delRes = await tgApiRaw('deleteWebhook');
        if (delRes.ok) {
            console.log('[Bridge Polling] Đã gỡ Webhook Cloud, máy tính tiếp quản Long Polling thành công!');
        }
    } catch (e) {}

    const allowedList = [2029333412, -1004457846636];
    if (allowedChatId) allowedList.push(Number(allowedChatId));

    try {
        const initRes = await tgApiRaw('getUpdates', { offset: -1 });
        if (initRes.ok && initRes.result && initRes.result.length > 0) {
            pollOffset = initRes.result[0].update_id + 1;
            console.log('[Bridge Polling] Đồng bộ offset mới nhất:', pollOffset);
        }
    } catch (e) {}

    while (true) {
        try {
            // 👉 KIỂM TRA CHẾ ĐỘ CLOUD STANDBY
            if (isCloudStandby) {
                await new Promise(r => setTimeout(r, 3500));
                const whInfo = await tgApiRaw('getWebhookInfo');
                if (whInfo.ok && (!whInfo.result.url || whInfo.result.url === '')) {
                    console.log('[Bridge Standby] Phát hiện Webhook đã được gỡ! Máy tính thức tỉnh!');
                    isCloudStandby = false;
                    await sendMsg(
                        activeChatId,
                        `⚡ <b>[MÁY TÍNH ĐÃ TIẾP QUẢN LẠI TỪ CLOUD!]</b>\n──────────────────────\n🖥️ <b>Cửa sổ Antigravity PC:</b> ĐÃ THỨC TỈNH & SẴN SÀNG 100%\n🚀 <b>Kênh làm việc:</b> Topic 315 (Quin-Iu-Mthu)\n✨ Máy tính đã lấy lại quyền điều khiển trực tiếp qua Long Polling!`,
                        activeThreadId
                    );
                }
                continue;
            }

            const res = await tgApiRaw('getUpdates', { offset: pollOffset, timeout: 12 });
            if (!res.ok) {
                if (res.error_code === 409) {
                    // Webhook đang hoạt động, chuyển sang standby
                    isCloudStandby = true;
                    await new Promise(r => setTimeout(r, 2000));
                    continue;
                }
                await new Promise(r => setTimeout(r, 1500));
                continue;
            }

            if (res.result && res.result.length > 0) {
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
                                await tgApiRaw('answerCallbackQuery', { callback_query_id: cb.id, text: `Đã bấm: ${num}` });
                                const screen = `📟 <b>[BÀN PHÍM XÁC THỰC KẾT NỐI]</b>\n──────────────────────\nMàn hình: <code>${getPinDisplay(currentPin)}</code>\n<i>(Nhập 4 số rồi bấm ↵ Enter để kết nối với PC)</i>`;
                                await editMsg(chatId, cb.message.message_id, screen, 'HTML', getKeypadMarkup(), true);
                            } else {
                                await tgApiRaw('answerCallbackQuery', { callback_query_id: cb.id, text: 'Đã đủ 4 số! Hãy bấm ↵ Enter' });
                            }
                            continue;
                        }

                        // B. XỬ LÝ NÚT XÓA TỪNG SỐ (BACKSPACE)
                        if (cbData === 'pin_action_backspace') {
                            if (currentPin.length > 0) {
                                currentPin = currentPin.slice(0, -1);
                                await tgApiRaw('answerCallbackQuery', { callback_query_id: cb.id, text: 'Đã xóa 1 số' });
                                const screen = `📟 <b>[BÀN PHÍM XÁC THỰC KẾT NỐI]</b>\n──────────────────────\nMàn hình: <code>${getPinDisplay(currentPin)}</code>\n<i>(Nhập 4 số rồi bấm ↵ Enter để kết nối với PC)</i>`;
                                await editMsg(chatId, cb.message.message_id, screen, 'HTML', getKeypadMarkup(), true);
                            } else {
                                await tgApiRaw('answerCallbackQuery', { callback_query_id: cb.id, text: 'Màn hình đang trống' });
                            }
                            continue;
                        }

                        // C. XỬ LÝ NÚT HỦY PIN KEYPAD -> Về lại Cloud bình thường
                        if (cbData === 'pin_action_cancel') {
                            currentPin = '';
                            pinFailedCount = 0;
                            await tgApiRaw('answerCallbackQuery', { callback_query_id: cb.id, text: 'Đã hủy xác thực' });
                            const cancelText = `☁️ <b>[ĐÃ HỦY NHẬP MÃ ĐỒNG BỘ]</b>\n──────────────────────\nBro đã hủy bàn phím nhập mã. Hệ thống duy trì chế độ Vercel Cloud 24/7 bình thường (không chặn).\n\n👉 Khi cần kết nối lại, gõ <code>/ketnoi</code> hoặc <code>/ketnoilai</code>.`;
                            await editMsg(chatId, cb.message.message_id, cancelText, 'HTML', { inline_keyboard: [] }, true);
                            continue;
                        }

                        // D. XỬ LÝ NÚT ENTER (XÁC NHẬN MÃ PIN 6585)
                        if (cbData === 'pin_action_enter') {
                            if (currentPin.length < 4) {
                                await tgApiRaw('answerCallbackQuery', { callback_query_id: cb.id, text: 'Vui lòng nhập đủ 4 số trước khi Enter!' });
                                continue;
                            }

                            if (currentPin === '6585') {
                                pinFailedCount = 0;
                                currentPin = '';
                                currentPhase = 'IDLE';
                                isCanceled = false;
                                isCloudStandby = false;
                                stopTicker();
                                if (typingInterval) {
                                    clearInterval(typingInterval);
                                    typingInterval = null;
                                }
                                tempMsgIds = [];
                                promptMsgId = null;
                                activeThreadId = (cb.message && cb.message.message_thread_id) || activeThreadId || 315;
                                await tgApiRaw('answerCallbackQuery', { callback_query_id: cb.id, text: '✅ Mã chính xác! Đang kết nối...' });
                                const successText = `⚡ <b>[ĐÃ KẾT NỐI QUA MÃ 6585 THÀNH CÔNG!]</b>\n──────────────────────\n🖥️ <b>Cửa sổ Antigravity PC:</b> SẴN SÀNG 100%\n🚀 <b>Kênh làm việc:</b> Topic 315 (Quin-Iu-Mthu)\n🔗 <b>Mã định danh:</b> <code>GM_6585_Mthu</code>\n✨ Đã cưỡng chế kết nối máy tính thành công! Bro gửi yêu cầu code hoặc ảnh ngay bây giờ nhé!`;
                                await editMsg(chatId, cb.message.message_id, successText, 'HTML', { inline_keyboard: [] }, true);
                                forwardToAntigravity(`[LỆNH CƯỠNG CHẾ KẾT NỐI LẠI]: Người dùng đã nhập đúng mã 6585 qua bàn phím PIN. Đồng bộ tức thì với cửa sổ Antigravity PC.`);
                                continue;
                            } else {
                                pinFailedCount++;
                                currentPin = '';

                                if (pinFailedCount >= 3) {
                                    pinFailedCount = 0;
                                    await tgApiRaw('answerCallbackQuery', { callback_query_id: cb.id, text: '❌ Sai 3 lần! Trở về Cloud 24/7' });
                                    const failMaxText = `☁️ <b>[NHẬP SAI 3 LẦN - TRỞ VỀ CLOUD 24/7]</b>\n──────────────────────\nBro đã nhập sai mã 3 lần. Hệ thống tự động chuyển về chế độ Vercel Cloud 24/7 bình thường (không chặn).\n\n👉 Khi muốn kết nối lại với PC, gõ <code>/ketnoi</code> hoặc <code>/ketnoilai</code>.`;
                                    await editMsg(chatId, cb.message.message_id, failMaxText, 'HTML', { inline_keyboard: [] }, true);
                                    continue;
                                } else {
                                    await tgApiRaw('answerCallbackQuery', { callback_query_id: cb.id, text: `❌ Sai mã! Còn ${3 - pinFailedCount} lần thử` });
                                    const retryText = `❌ <b>[MÃ 4 SỐ KHÔNG CHÍNH XÁC!]</b> <i>(Sai ${pinFailedCount}/3 lần)</i>\n──────────────────────\nMàn hình: <code>${getPinDisplay('')}</code>\n<i>Vui lòng nhập lại mã 4 số chính xác rồi bấm ↵ Enter:</i>`;
                                    await editMsg(chatId, cb.message.message_id, retryText, 'HTML', getKeypadMarkup(), true);
                                    continue;
                                }
                            }
                        }

                        // E. XỬ LÝ NÚT HỦY TÁC VỤ ĐANG CHẠY (CANCEL_TASK)
                        if (cbData === 'cancel_task') {
                            await tgApiRaw('answerCallbackQuery', {
                                callback_query_id: cb.id,
                                text: '🛑 Đang dừng tác vụ...'
                            });
                            if (cb.message && cb.message.message_id) {
                                const msgText = cb.message.text ? escapeHtml(cb.message.text) : '🛑 Đang dừng tác vụ...';
                                await editMsg(chatId, cb.message.message_id, msgText, 'HTML', { inline_keyboard: [] }, true);
                            }
                            await handleCancelAction('Inline Button');
                            continue;
                        }

                        // F. XỬ LÝ HÀNG ĐỢI PROMPT: ƯU TIÊN CHẠY NGAY (SEND NOW)
                        if (cbData.startsWith('q_now:')) {
                            const qId = cbData.replace('q_now:', '');
                            const qItem = removePrompt(qId);
                            if (qItem) {
                                await tgApiRaw('answerCallbackQuery', { callback_query_id: cb.id, text: '⚡ Ưu tiên chạy prompt này!' });
                                await handleCancelAction('Priority Send Now');
                                await new Promise(r => setTimeout(r, 600));
                                await sendMsg(chatId, `⚡ <b>[ĐÃ ƯU TIÊN THỰC THI NGAY TỪ HÀNG ĐỢI]:</b>\n<blockquote><i>${escapeHtml(qItem.preview)}</i></blockquote>`, activeThreadId);
                                await executePromptImmediately(qItem.chatId, qItem.threadId, qItem.text, qItem.preview);
                            } else {
                                await tgApiRaw('answerCallbackQuery', { callback_query_id: cb.id, text: 'Không tìm thấy prompt này trong hàng đợi!' });
                            }
                            continue;
                        }

                        // G. XỬ LÝ HÀNG ĐỢI PROMPT: SỬA PROMPT ĐANG CHỜ
                        if (cbData.startsWith('q_edit:')) {
                            const qId = cbData.replace('q_edit:', '');
                            const qItem = getPrompt(qId);
                            if (qItem) {
                                waitingForEditQueueId = qId;
                                await tgApiRaw('answerCallbackQuery', { callback_query_id: cb.id, text: 'Vui lòng gửi tin nhắn mới!' });
                                await sendMsg(
                                    chatId,
                                    `✏️ <b>[CHẾ ĐỘ SỬA PROMPT TRONG HÀNG ĐỢI]</b>\nPrompt hiện tại: <blockquote><i>${escapeHtml(qItem.preview)}</i></blockquote>\n<i>Bro hãy gửi tin nhắn tiếp theo, hệ thống sẽ tự động cập nhật nội dung mới cho prompt này!</i>`,
                                    activeThreadId
                                );
                            } else {
                                await tgApiRaw('answerCallbackQuery', { callback_query_id: cb.id, text: 'Prompt không còn trong hàng đợi!' });
                            }
                            continue;
                        }

                        // H. XỬ LÝ HÀNG ĐỢI PROMPT: XÓA PROMPT NÀY
                        if (cbData.startsWith('q_del:')) {
                            const qId = cbData.replace('q_del:', '');
                            const deleted = removePrompt(qId);
                            await tgApiRaw('answerCallbackQuery', { callback_query_id: cb.id, text: '🗑️ Đã xóa prompt khỏi hàng đợi!' });
                            if (deleted) {
                                await editMsg(
                                    chatId,
                                    cb.message.message_id,
                                    `🗑️ <b>[ĐÃ XÓA PROMPT KHỎI HÀNG ĐỢI]</b>\n<blockquote><i>${escapeHtml(deleted.preview)}</i></blockquote>\n<i>(Còn lại trong hàng chờ: ${promptQueue.length} prompt)</i>`,
                                    'HTML',
                                    { inline_keyboard: [] },
                                    true
                                );
                            }
                            continue;
                        }

                        // I. XỬ LÝ HÀNG ĐỢI PROMPT: GỬI THÊM VÀO HÀNG CHỜ
                        if (cbData === 'q_add') {
                            await tgApiRaw('answerCallbackQuery', { callback_query_id: cb.id, text: 'Bro cứ gửi tiếp prompt vào chat nhé!' });
                            continue;
                        }

                        // J. XỬ LÝ HÀNG ĐỢI PROMPT: DANH SÁCH PROMPT TRONG HÀNG CHỜ
                        if (cbData === 'q_list') {
                            await tgApiRaw('answerCallbackQuery', { callback_query_id: cb.id, text: `Hàng đợi có ${promptQueue.length} prompt` });
                            await sendMsg(
                                chatId,
                                `📋 <b>[DANH SÁCH PROMPT TRONG HÀNG CHỜ (${promptQueue.length})]:</b>\n<i>Bro có thể bấm chạy ngay hoặc xóa bất kỳ prompt nào:</i>`,
                                activeThreadId,
                                'HTML',
                                getQueueListMarkup()
                            );
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

                    // 👉 XỬ LÝ NẾU ĐANG CHỜ SỬA PROMPT TRONG HÀNG ĐỢI
                    if (waitingForEditQueueId) {
                        const updated = updatePrompt(waitingForEditQueueId, userText);
                        const editedId = waitingForEditQueueId;
                        waitingForEditQueueId = null;
                        if (updated) {
                            await sendMsg(
                                chatId,
                                `✅ <b>[ĐÃ CẬP NHẬT PROMPT MỚI CHO HÀNG ĐỢI]</b>\nNội dung mới: <blockquote><i>${escapeHtml(updated.preview)}</i></blockquote>`,
                                activeThreadId,
                                'HTML',
                                getQueueButtons(editedId)
                            );
                        }
                        continue;
                    }

                    // Xử lý lệnh ngắt kết nối / bàn giao Cloud 24/7
                    if (/^(?:\/disconnect|\/ngatketnoi|\/cloud|ngắt kết nối|ngắt kết nối đi)$/i.test(userText.trim())) {
                        await handleDisconnectCloud();
                        continue;
                    }

                    // Xử lý lệnh hủy nhanh
                    if (/^(?:\/cancel|stop|hủy|dừng|dừng lại)$/i.test(userText)) {
                        await handleCancelAction(isEdit ? 'Edit message to STOP' : 'Text STOP');
                        continue;
                    }

                    // Lệnh quét lịch sử tin nhắn trong box chat (/quet, /scan, /history)
                    if (/^(?:\/quet|\/scan|\/history|\/tinnhan)$/i.test(userText.trim())) {
                        let historyText = `📋 <b>[LỊCH SỬ TIN NHẮN GẦN ĐÂY TRONG BOX CHAT]:</b>\n──────────────────────\n`;
                        if (fs.existsSync(syncBridgePath)) {
                            try {
                                const raw = fs.readFileSync(syncBridgePath, 'utf8').replace(/^\uFEFF/, '');
                                const br = JSON.parse(raw);
                                const msgs = (br.messages || []).slice(-8);
                                if (msgs.length === 0) {
                                    historyText += `<i>Chưa có tin nhắn nào được ghi nhận.</i>`;
                                } else {
                                    msgs.forEach((m, idx) => {
                                        const time = m.timestamp ? new Date(m.timestamp).toLocaleTimeString('vi-VN') : '';
                                        const sender = m.sender === 'phone' ? '📱 Bro' : '🖥️ PC';
                                        historyText += `<b>${idx + 1}. [${time}] ${sender}:</b> <code>${escapeHtml(m.text.substring(0, 100))}</code>\n`;
                                    });
                                }
                            } catch (e) {
                                historyText += `<i>Không thể đọc sync_bridge.json</i>`;
                            }
                        }
                        historyText += `\n<i>👉 Bro có thể reply bất kỳ tin nhắn nào và gửi chỉ thị, tôi sẽ tự kiểm tra đúng vị trí đó!</i>`;
                        await sendMsg(chatId, historyText, activeThreadId, 'HTML');
                        continue;
                    }

                    // Kiểm tra nếu đang chờ mã 4 số kết nối lại
                    if ((waitingForPairCode && /^\d{4}$/.test(userText.trim())) || userText.trim() === '6585') {
                        const code = userText.trim();
                        if (code === '6585') {
                            waitingForPairCode = false;
                            isCloudStandby = false;
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

                    // Xử lý lệnh cưỡng chế kết nối lại (/ketnoi, /ketnoilai, /reconnect, /pc, /local)
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
                            isCloudStandby = false;
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

                    // Trích xuất ngữ cảnh reply
                    let replyContext = '';
                    if (msg.reply_to_message) {
                        const rm = msg.reply_to_message;
                        const rSender = rm.from ? (rm.from.first_name || 'Bot') : 'Bot';
                        const rText = rm.text || rm.caption || '[Đoạn mã / Hình ảnh / Tin nhắn hệ thống]';
                        replyContext = `[NGƯỜI DÙNG REPLY TIN NHẮN CỦA ${rSender} (#${rm.message_id})]:\n"""\n${rText.substring(0, 500)}\n"""\n↳ `;
                        console.log(`[Bridge Reply Detection] Trích xuất tin nhắn reply (#${rm.message_id}): ${rText.substring(0, 50)}`);
                    }

                    const forwardPrompt = localPhotoPath
                        ? `${replyContext}[Điện thoại gửi ảnh]: ${userText} (Đã tải ảnh về máy tại: ${localPhotoPath})`
                        : (isEdit ? `${replyContext}[Điện thoại sửa prompt thành]: ${userText}` : `${replyContext}[Điện thoại gửi]: ${userText}`);

                    const previewClean = userText.replace(/[<>]/g, '');
                    const previewSafe = escapeHtml(previewClean.length > 55 ? previewClean.substring(0, 55) + '...' : previewClean);
                    showScreenToast(isEdit ? '✏️ Telegram -> Prompt Sửa' : '📱 Telegram -> PC Sync', previewClean);
                    recordSyncMessage(isEdit ? `[Sửa tin]: ${userText}` : userText);

                    // Nếu máy tính đang bận: Đưa vào hàng đợi
                    if (currentPhase !== 'IDLE' && currentPhase !== 'CANCELED') {
                        const qId = 'q_' + Date.now();
                        addPrompt({
                            id: qId,
                            text: forwardPrompt,
                            preview: userText,
                            chatId: chatId,
                            threadId: activeThreadId,
                            timestamp: Date.now()
                        });

                        const qNotice = `📥 <b>[ĐÃ NẠP VÀO HÀNG ĐỢI PC]</b>\n<blockquote><i>${previewSafe}</i></blockquote>\n<i>Máy tính đang xử lý tác vụ trước đó. Prompt này đã được xếp vị trí <b>#${promptQueue.length}</b> trong hàng chờ!</i>`;
                        await sendMsg(chatId, qNotice, activeThreadId, 'HTML', getQueueButtons(qId));
                        console.log(`[Bridge Queue] Đã nạp prompt vào hàng đợi (#${promptQueue.length}): ${userText.substring(0, 40)}`);
                        continue;
                    }

                    // Nếu máy tính đang IDLE: Thực thi ngay lập tức
                    await executePromptImmediately(chatId, activeThreadId, forwardPrompt, userText, isEdit, isPhoto);
                }
            }
        } catch (e) {
            console.error('[Polling Exception]:', e.message);
            await new Promise(r => setTimeout(r, 2000));
        }
    }
}

pollUpdates();
