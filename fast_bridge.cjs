const fs = require('fs');
const path = require('path');
const { execFile, spawn } = require('child_process');

const {
    botToken,
    allowedChatId,
    cancelKeyboard,
    isRateLimited,
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

const {
    forwardToAntigravity,
    showScreenToast,
    recordSyncMessage
} = require('./lib/ipc.cjs');

const { createTranscriptWatcher } = require('./lib/transcript.cjs');
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

const {
    MASTER_PASSWORD,
    getPCDrives,
    getDriveFolders,
    getMainMenuMarkup,
    getDriveSelectionMarkup,
    getFolderSelectionMarkup,
    getMainMenuText,
    handleCreateProjectClick,
    verifyMasterPassword,
    isWaitingForMasterPassword,
    cancelWaitingPassword,
    isSuperAdmin,
    setSuperAdmin,
    getProjectWizard,
    resetProjectWizard
} = require('./lib/menu.cjs');

const rootDir = __dirname;
const conversationId = '7f7131ce-dc72-490f-97bd-4a675f9dd0c7';
const transcriptPath = `C:\\Users\\letru\\.gemini\\antigravity\\brain\\${conversationId}\\.system_generated\\logs\\transcript.jsonl`;
const syncBridgePath = path.join(rootDir, 'sync_bridge.json');

console.log('========================================================');
console.log(' Fast Modular Telegram Bridge v3.4 (Rate Limit Protected)');
console.log(` Working Dir: ${rootDir}`);
console.log(` Bot Token: ${botToken.substring(0, 10)}...`);
console.log(` Conversation ID: ${conversationId}`);
console.log('========================================================');

// --- STATE MANAGEMENT ---

let activeChatId = -1004457846636;
let activeThreadId = 1160;

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
let tempMsgIds = [];
let currentPin = '';
let pinFailedCount = 0;
let waitingForPairCode = false;
let waitingForEditQueueId = null;

// --- UNIVERSAL OUTBOX SENDER (OFFLOADED TO STANDALONE .BAT WORKER) ---

function sendViaBat(payloadData) {
    const outboxDir = path.join(rootDir, 'outbox');
    if (!fs.existsSync(outboxDir)) {
        try { fs.mkdirSync(outboxDir, { recursive: true }); } catch (e) {}
    }

    const payloadFile = path.join(outboxDir, `send_${Date.now()}_${Math.random().toString(36).substring(7)}.json`);
    try {
        fs.writeFileSync(payloadFile, JSON.stringify(payloadData), 'utf8');
        const batPath = path.join(rootDir, 'scripts', 'send_message.bat');
        spawn(process.env.ComSpec || 'cmd.exe', ['/c', `call "${batPath}" "${payloadFile}"`], {
            windowsHide: true,
            windowsVerbatimArguments: true,
            detached: true
        }).unref();
        return payloadFile;
    } catch (e) {
        console.error('[SendViaBat Error]:', e.message);
        return null;
    }
}

async function sendLongResponse(chatId, answerText, totalSec, threadId = 1160) {
    if (!answerText) return;
    const targetThreadId = Number(threadId) || activeThreadId || 1160;

    sendViaBat({
        action: 'response',
        chat_id: chatId,
        message_thread_id: targetThreadId,
        text: answerText,
        totalSec: totalSec
    });
    console.log(`[Bridge] Đã bàn giao phản hồi (${answerText.length} ký tự) cho send_message.bat xử lý ngầm!`);
}

// --- SILENT CLEANUP (1 FAST API CALL) ---

async function runCountdownCleanup(chatId, threadId, msgIdsToDelete) {
    if (!msgIdsToDelete || msgIdsToDelete.length === 0) return;
    try {
        setTimeout(async () => {
            await deleteMsgs(chatId, msgIdsToDelete);
        }, 1500);
    } catch (e) {}
}

function formatStopwatch(sec) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m > 0 ? m + 'm ' : ''}${s}s`;
}

// --- LIVE TICKING STOPWATCH (EVERY 3.5S TO PREVENT TELEGRAM 429) ---

async function updateStatusBubble() {
    if (isUpdatingStatus || isRateLimited() || currentPhase === 'IDLE' || currentPhase === 'CANCELED') return;

    // A. Nếu có tool đang chạy và có runningFn, đếm giây trên bong bóng tool
    if (currentWorkingMsgId && currentToolStartTime && currentToolRunningFn) {
        const toolElapsed = Math.max(1, Math.round((Date.now() - currentToolStartTime) / 1000));
        const updatedToolText = currentToolRunningFn(toolElapsed);
        if (updatedToolText !== lastWorkingBubbleText) {
            lastWorkingBubbleText = updatedToolText;
            recordBubbleText(currentWorkingMsgId, updatedToolText);
            isUpdatingStatus = true;
            try {
                const res = await editMsg(activeChatId, currentWorkingMsgId, updatedToolText, 'HTML', cancelKeyboard);
                if (res && res.notFound) {
                    currentWorkingMsgId = null;
                }
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
        const res = await editMsg(activeChatId, promptMsgId, text, 'HTML', kb);
        if (res && res.notFound) {
            promptMsgId = null;
            stopTicker();
        } else {
            lastStatusText = text;
            recordBubbleText(promptMsgId, text);
        }
    } catch (e) {}
    isUpdatingStatus = false;
}

function startTicker() {
    if (!tickerInterval) {
        tickerInterval = setInterval(updateStatusBubble, 3500); // 3.5s per edit -> max 17 edits/min
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
    console.log('[Bridge Disconnect] Bàn giao cho Cloud 24/7');
    isCloudStandby = true;
    stopTicker();
    await clearAllCancelButtons(activeChatId, tempMsgIds);
    tempMsgIds = [];
    promptMsgId = null;
    currentWorkingMsgId = null;

    const handoverText = `☁️ <b>[ĐÃ NGẮT KẾT NỐI VỚI PC - BÀN GIAO CHO VERCEL CLOUD 24/7]</b>\n──────────────────────\n🖥️ <b>Máy tính:</b> Đã ngưng tiếp nhận lệnh trực tiếp (Chế độ Chờ)\n🌐 <b>Vercel Cloud:</b> ĐÃ TIẾP QUẢN 24/7!\n\n✨ Giờ bro có thể chat, yêu cầu code hoặc commit file ngay cả khi máy tính tắt nguồn!\n\n👉 Khi muốn kết nối lại máy tính, chỉ cần gõ <code>/pc</code> hoặc nhập mã <code>6585</code>.`;
    await sendMsg(activeChatId, handoverText, activeThreadId, 'HTML', { inline_keyboard: [] });

    try {
        await tgApiRaw('setWebhook', { url: 'https://quiniumthucode.vercel.app/api/webhook' });
    } catch (e) {}
}

// --- HANDLE CANCEL ACTION ---

async function handleCancelAction(source = 'button') {
    console.log(`[Bridge Action] Hủy tác vụ (${source})`);
    currentPhase = 'CANCELED';
    stopTicker();

    if (transcriptWatcher) {
        transcriptWatcher.fastForward();
    }

    await clearAllCancelButtons(activeChatId, tempMsgIds);

    const cancelMsg = `🛑 <b>[ĐÃ HỦY TÁC VỤ THEO YÊU CẦU CỦA BRO!]</b>\n<i>Đã dừng tiến trình và dọn dẹp sạch sẽ.</i>`;
    if (promptMsgId) {
        await editMsg(activeChatId, promptMsgId, cancelMsg, 'HTML', { inline_keyboard: [] }, true);
    } else {
        await sendMsg(activeChatId, cancelMsg, activeThreadId, 'HTML', { inline_keyboard: [] });
    }

    forwardToAntigravity(conversationId, `[LỆNH HỦY TỪ ĐIỆN THOẠI]: Người dùng đã yêu cầu dừng/hủy tác vụ hiện tại. Ngừng ngay lập tức mọi hoạt động.`);

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
    currentPhase = 'READING';
    stopTicker();
    promptStartTime = Date.now();
    promptTextSaved = previewText;
    isPhotoSaved = isPhoto;
    isEditedPrompt = isEdit;
    activeChatId = chatId;
    activeThreadId = threadId;

    forwardToAntigravity(conversationId, promptText);
    sendTyping(chatId, threadId);

    const promptLabel = isEdit
        ? '✏️ <b>[ĐÃ CẬP NHẬT PROMPT MỚI]</b> • ⏱️ <code>1s</code>'
        : (isPhoto
            ? '📷 <b>[ĐÃ NHẬN ẢNH VÀ ĐANG PHÂN TÍCH]</b> • ⏱️ <code>1s</code>'
            : '📖 <b>[ĐÃ ĐỌC PROMPT &amp; ĐANG XỬ LÝ]</b> • ⏱️ <code>1s</code>');

    const previewClean = previewText.replace(/[<>]/g, '');
    const previewSafe = escapeHtml(previewClean.length > 55 ? previewClean.substring(0, 55) + '...' : previewClean);
    const initialText = `${promptLabel}\n<blockquote><i>${previewSafe}</i></blockquote>\n⏱️ <i>Đang đếm giây xử lý: 1s...</i>`;

    await clearAllCancelButtons(chatId);

    // Gửi bong bóng bắt thấy prompt qua file BAT độc lập theo đúng chỉ đạo của bro!
    sendViaBat({
        action: 'prompt_ack',
        chat_id: chatId,
        message_thread_id: threadId,
        preview: previewText,
        isEdit: isEdit,
        isPhoto: isPhoto
    });

    // Sau khi BAT gửi xong (trong ~350ms), đồng bộ promptMsgId để ticker tiếp tục đếm giây
    setTimeout(() => {
        try {
            const stateFile = path.join(rootDir, 'bridge_state.json');
            if (fs.existsSync(stateFile)) {
                const st = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
                if (st.lastPromptAckMsgId && (Date.now() - (st.lastPromptAckTime || 0) < 6000)) {
                    promptMsgId = st.lastPromptAckMsgId;
                    tempMsgIds.push(promptMsgId);
                    setActiveCancelMsgId(promptMsgId);
                    startTicker();
                }
            }
        } catch (e) {}
    }, 450);
}

// --- TRANSCRIPT WATCHER SETUP ---

const transcriptWatcher = createTranscriptWatcher({
    transcriptPath,
    onToolCall: async (toolCalls) => {
        if (currentPhase === 'CANCELED') return;
        currentToolStartTime = Date.now();
        currentPhase = 'WORKING';

        for (const tc of toolCalls) {
            const { summary, runningFn, finishedFn } = formatToolCall(tc);
            currentToolSummary = summary;
            currentToolRunningFn = runningFn;
            currentToolFinishedFn = finishedFn;

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
    },
    onToolComplete: async (entry) => {
        if (currentPhase === 'CANCELED') return;
        const wSec = currentToolStartTime ? Math.max(1, Math.round((Date.now() - currentToolStartTime) / 1000)) : 1;
        const safeTask = escapeHtml(currentToolSummary || 'Tác vụ');

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
    },
    onPlannerResponse: async (answer) => {
        currentPhase = 'IDLE';
        stopTicker();

        const totalSec = promptStartTime ? Math.max(1, Math.round((Date.now() - promptStartTime) / 1000)) : 1;
        console.log(`[Bridge] Phản hồi hoàn tất trong ${totalSec}s. Gửi tới Telegram #${activeThreadId}...`);

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

        if (promptQueue.length > 0) {
            const nextItem = getNextPrompt();
            if (nextItem) {
                const remCount = promptQueue.length;
                const remNotice = remCount > 0 ? `\n<i>(Còn lại trong hàng chờ: ${remCount} prompt)</i>` : '';
                await sendMsg(
                    activeChatId,
                    `🚀 <b>[ĐANG THỰC THI PROMPT TIẾP THEO TỪ HÀNG ĐỢI]:</b>\n<blockquote><i>${escapeHtml(nextItem.preview)}</i></blockquote>${remNotice}`,
                    nextItem.threadId || activeThreadId
                );
                await executePromptImmediately(nextItem.chatId, nextItem.threadId || activeThreadId, nextItem.text, nextItem.preview);
            }
        }
    }
});

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
        }
    } catch (e) {}

    while (true) {
        try {
            // 👉 KIỂM TRA CHẾ ĐỘ CLOUD STANDBY
            if (isCloudStandby) {
                await new Promise(r => setTimeout(r, 4000));
                const whInfo = await tgApiRaw('getWebhookInfo');
                if (whInfo.ok && (!whInfo.result.url || whInfo.result.url === '')) {
                    console.log('[Bridge Standby] Phát hiện Webhook đã được gỡ! Máy tính thức tỉnh!');
                    isCloudStandby = false;
                    await sendMsg(
                        activeChatId,
                        `⚡ <b>[MÁY TÍNH ĐÃ TIẾP QUẢN LẠI TỪ CLOUD!]</b>\n──────────────────────\n🖥️ <b>Cửa sổ Antigravity PC:</b> ĐÃ THỨC TỈNH & SẴN SÀNG 100%\n🚀 <b>Kênh làm việc:</b> Topic ${activeThreadId}\n✨ Máy tính đã lấy lại quyền điều khiển trực tiếp qua Long Polling!`,
                        activeThreadId
                    );
                }
                continue;
            }

            const res = await tgApiRaw('getUpdates', { offset: pollOffset, timeout: 8 });
            if (!res.ok) {
                if (res.error_code === 409) {
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

                        // C. XỬ LÝ NÚT HỦY PIN KEYPAD
                        if (cbData === 'pin_action_cancel') {
                            currentPin = '';
                            pinFailedCount = 0;
                            await tgApiRaw('answerCallbackQuery', { callback_query_id: cb.id, text: 'Đã hủy xác thực' });
                            const cancelText = `☁️ <b>[ĐÃ HỦY NHẬP MÃ ĐỒNG BỘ]</b>\n──────────────────────\nBro đã hủy bàn phím nhập mã. Hệ thống duy trì chế độ Vercel Cloud 24/7 bình thường.\n\n👉 Khi cần kết nối lại, gõ <code>/pc</code> hoặc <code>/ketnoi</code>.`;
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
                                isCloudStandby = false;
                                stopTicker();
                                tempMsgIds = [];
                                promptMsgId = null;
                                activeThreadId = (cb.message && cb.message.message_thread_id) || activeThreadId || 1160;
                                await tgApiRaw('answerCallbackQuery', { callback_query_id: cb.id, text: '✅ Mã chính xác! Đang kết nối...' });
                                const successText = `⚡ <b>[ĐÃ KẾT NỐI QUA MÃ 6585 THÀNH CÔNG!]</b>\n──────────────────────\n🖥️ <b>Cửa sổ Antigravity PC:</b> SẴN SÀNG 100%\n🚀 <b>Kênh làm việc:</b> Topic ${activeThreadId}\n🔗 <b>Mã định danh:</b> <code>GM_6585_Mthu</code>\n✨ Đã cưỡng chế kết nối máy tính thành công! Bro gửi yêu cầu code hoặc ảnh ngay bây giờ nhé!`;
                                await editMsg(chatId, cb.message.message_id, successText, 'HTML', { inline_keyboard: [] }, true);
                                forwardToAntigravity(conversationId, `[LỆNH CƯỠNG CHẾ KẾT NỐI LẠI]: Người dùng đã nhập đúng mã 6585 qua bàn phím PIN. Đồng bộ tức thì với cửa sổ Antigravity PC.`);
                                continue;
                            } else {
                                pinFailedCount++;
                                currentPin = '';

                                if (pinFailedCount >= 3) {
                                    pinFailedCount = 0;
                                    await tgApiRaw('answerCallbackQuery', { callback_query_id: cb.id, text: '❌ Sai 3 lần! Trở về Cloud 24/7' });
                                    const failMaxText = `☁️ <b>[NHẬP SAI 3 LẦN - TRỞ VỀ CLOUD 24/7]</b>\n──────────────────────\nBro đã nhập sai mã 3 lần. Hệ thống tự động chuyển về chế độ Vercel Cloud 24/7 bình thường.\n\n👉 Khi muốn kết nối lại với PC, gõ <code>/pc</code> hoặc <code>/ketnoi</code>.`;
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
                                await new Promise(r => setTimeout(r, 400));
                                await sendMsg(chatId, `⚡ <b>[ĐÃ ƯU TIÊN THỰC THI NGAY TỪ HÀNG ĐỢI]:</b>\n<blockquote><i>${escapeHtml(qItem.preview)}</i></blockquote>`, qItem.threadId || activeThreadId);
                                await executePromptImmediately(qItem.chatId, qItem.threadId || activeThreadId, qItem.text, qItem.preview);
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
                                    `✏️ <b>[CHẾ ĐỘ SỬA PROMPT TRONG HÀNG ĐỢI]</b>\nPrompt hiện tại: <blockquote><i>${escapeHtml(qItem.preview)}</i></blockquote>\n<i>Bro hãy gửi tin nhắn tiếp theo, hệ thống sẽ tự động cập nhật nội dung mới!</i>`,
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

                        // K. MASTER LOBBY: TẠO DỰ ÁN MỚI (KÈM EASTER EGG GÕ 7 LẦN)
                        if (cbData === 'hub_create_proj') {
                            const res = handleCreateProjectClick(
                                async () => {
                                    await tgApiRaw('answerCallbackQuery', {
                                        callback_query_id: cb.id,
                                        text: '🔒 [7/7] ĐÃ KÍCH HOẠT CHẾ ĐỘ SUPER ADMIN!',
                                        show_alert: true
                                    });
                                    const secretPrompt = `🔒 <b>[PHÁT HIỆN GÕ 7 LẦN LIÊN TỤC - KÍCH HOẠT CHẾ ĐỘ SUPER ADMIN]</b>\n──────────────────────\nBro vừa mở khóa cổng bảo mật bí mật của hệ sinh thái QuinloveRin Code!\n\n<i>Vui lòng nhập mật khẩu tối cao để nắm toàn quyền sử dụng repo này:</i>`;
                                    await sendMsg(chatId, secretPrompt, activeThreadId, 'HTML');
                                },
                                async () => {
                                    const wiz = getProjectWizard();
                                    wiz.active = true;
                                    wiz.chatId = chatId;
                                    wiz.threadId = activeThreadId;
                                    wiz.step = 'AWAITING_NAME';
                                    wiz.selectedDrive = '';
                                    const askName = `📁 <b>[KHỞI TẠO DỰ ÁN MỚI - BƯỚC 1/2]</b>\n──────────────────────\nBro muốn đặt tên cho dự án mới là gì?\n<i>(Ví dụ: <code>App-Ban-Hang</code>, <code>Landing-Page</code>, <code>Bot-Crypto</code>...)</i>\n\n👉 Hãy gửi tên dự án vào ô chat:`;
                                    await sendMsg(chatId, askName, activeThreadId, 'HTML');
                                }
                            );

                            if (res.action === 'PROGRESS') {
                                await tgApiRaw('answerCallbackQuery', {
                                    callback_query_id: cb.id,
                                    text: `👆 [${res.count}/7] Nhấp tiếp để mở khóa Admin...`
                                });
                            }
                            continue;
                        }

                        // L. MASTER LOBBY: QUẢN LÝ Ổ ĐĨA & DỰ ÁN PC
                        if (cbData === 'hub_explore_drives') {
                            await tgApiRaw('answerCallbackQuery', { callback_query_id: cb.id, text: '🔍 Đang quét toàn bộ ổ cứng PC...' });
                            const drives = getPCDrives();
                            let text = `💾 <b>[QUẢN LÝ Ổ ĐĨA &amp; DỰ ÁN TRÊN MÁY TÍNH]</b>\n──────────────────────\nĐã kết nối trực tiếp với PC và phát hiện <b>${drives.length} ổ cứng vật lý</b>:\n\n`;
                            for (const d of drives) {
                                text += `• <b>Ổ ${d.drive}:</b> Còn trống <b>${d.freeGB} GB</b> (Tổng: ${d.totalGB} GB)\n`;
                            }
                            text += `\n<i>👉 Chọn một ổ đĩa bên dưới để xem danh sách dự án / thư mục:</i>`;
                            await sendMsg(chatId, text, activeThreadId, 'HTML', getDriveSelectionMarkup('browse_drive_'));
                            continue;
                        }

                        // L2. DUYỆT THƯ MỤC TRONG Ổ ĐĨA ĐƯỢC CHỌN
                        if (cbData.startsWith('browse_drive_')) {
                            const d = cbData.replace('browse_drive_', '');
                            await tgApiRaw('answerCallbackQuery', { callback_query_id: cb.id, text: `Đang đọc ổ ${d}:...` });
                            const folders = getDriveFolders(d);
                            let text = `📂 <b>[DANH SÁCH THƯ MỤC / DỰ ÁN TRÊN Ổ ${d}:]</b>\n──────────────────────\n`;
                            if (folders.length === 0) {
                                text += `<i>Ổ đĩa chưa có thư mục nào.</i>\n`;
                            } else {
                                folders.forEach((f, idx) => {
                                    text += `${idx + 1}. 📁 <code>${d}:\\${f}</code>\n`;
                                });
                            }
                            text += `\n<i>👉 Bấm vào thư mục bên dưới để khởi chạy Cửa sổ làm việc mới:</i>`;
                            await sendMsg(chatId, text, activeThreadId, 'HTML', getFolderSelectionMarkup(d));
                            continue;
                        }

                        // L3. CHỌN 1 FOLDER ĐỂ KHỞI CHẠY CỬA SỔ MỚI
                        if (cbData.startsWith('sel_folder:')) {
                            const [, drive, fName] = cbData.split(':');
                            const fullPath = `${drive}:\\${fName}`;
                            await tgApiRaw('answerCallbackQuery', { callback_query_id: cb.id, text: `Khởi chạy: ${fName}` });

                            let newTopicId = null;
                            try {
                                const topicRes = await tgApiRaw('createForumTopic', {
                                    chat_id: activeChatId,
                                    name: `🚀 Dự Án: ${fName}`
                                });
                                if (topicRes.ok && topicRes.result?.message_thread_id) {
                                    newTopicId = topicRes.result.message_thread_id;
                                    await sendMsg(
                                        activeChatId,
                                        `🎉 <b>[CỬA SỔ DỰ ÁN ĐÃ KHỞI CHẠY]</b>\n──────────────────────\n📁 <b>Tên thư mục:</b> <code>${fName}</code>\n💾 <b>Đường dẫn:</b> <code>${fullPath}</code>\n🚀 <b>Topic ID:</b> <code>#${newTopicId}</code>\n\n✨ Cửa sổ Antigravity PC và Topic Telegram đã sẵn sàng! Bro gửi yêu cầu code ngay tại Topic này nhé!`,
                                        newTopicId,
                                        'HTML'
                                    );
                                }
                            } catch (e) {}

                            try {
                                const agyExe = 'C:\\Users\\letru\\AppData\\Local\\Programs\\antigravity\\Antigravity.exe';
                                if (fs.existsSync(agyExe)) {
                                    execFile(agyExe, [fullPath], { detached: true, stdio: 'ignore' }).unref();
                                }
                            } catch (e) {}

                            const topicNote = newTopicId ? `\n🚀 <b>Telegram Topic mới:</b> <code>#${newTopicId}</code>` : '';
                            await sendMsg(chatId, `🎉 <b>[ĐÃ MỞ CỬA SỔ DỰ ÁN TRÊN PC]</b>\n──────────────────────\n📁 <b>Dự án:</b> <code>${fName}</code>\n💾 <b>Vị trí:</b> <code>${fullPath}</code>${topicNote}`, activeThreadId, 'HTML', getMainMenuMarkup());
                            forwardToAntigravity(conversationId, `[MỞ DỰ ÁN TRÊN PC]: Người dùng đã mở thư mục '${fullPath}'${topicNote}`);
                            continue;
                        }

                        // M. MASTER LOBBY: BÀN GIAO CLOUD 24/7
                        if (cbData === 'hub_cloud') {
                            await tgApiRaw('answerCallbackQuery', { callback_query_id: cb.id, text: '☁️ Khởi tạo Cửa sổ Cloud 24/7...' });
                            await handleDisconnectCloud();
                            await sendMsg(chatId, `☁️ <b>[ĐÃ BÀN GIAO CHO CLOUD 24/7 THÀNH CÔNG]</b>\n──────────────────────\nMáy tính chuyển sang chế độ Chờ!`, activeThreadId, 'HTML', getMainMenuMarkup());
                            continue;
                        }

                        // P. PROJECT WIZARD: CHỌN Ổ ĐĨA KHI TẠO MỚI
                        if (cbData.startsWith('wizard_drive_')) {
                            const drive = cbData.replace('wizard_drive_', '');
                            const wiz = getProjectWizard();
                            const pName = wiz.projectName || 'New-Project';
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
                                const topicRes = await tgApiRaw('createForumTopic', {
                                    chat_id: activeChatId,
                                    name: `🚀 Dự Án: ${pName}`
                                });
                                if (topicRes.ok && topicRes.result?.message_thread_id) {
                                    newTopicId = topicRes.result.message_thread_id;
                                    await sendMsg(
                                        activeChatId,
                                        `🎉 <b>[CỬA SỔ DỰ ÁN MỚI ĐÃ KHỞI TẠO]</b>\n──────────────────────\n📁 <b>Tên dự án:</b> <code>${pName}</code>\n💾 <b>Thư mục PC:</b> <code>${pPath}</code>\n🚀 <b>Topic ID:</b> <code>#${newTopicId}</code>\n\n✨ Cửa sổ Antigravity PC và Topic Telegram đã sẵn sàng! Bro gửi yêu cầu code ngay tại Topic này nhé!`,
                                        newTopicId,
                                        'HTML'
                                    );
                                }
                            } catch (e) {}

                            try {
                                const agyExe = 'C:\\Users\\letru\\AppData\\Local\\Programs\\antigravity\\Antigravity.exe';
                                if (fs.existsSync(agyExe)) {
                                    execFile(agyExe, [pPath], { detached: true, stdio: 'ignore' }).unref();
                                }
                            } catch (e) {}

                            await tgApiRaw('answerCallbackQuery', { callback_query_id: cb.id, text: `✅ Đã tạo dự án tại ổ ${drive}:` });
                            const topicNote = newTopicId ? `\n🚀 <b>Telegram Topic mới:</b> <code>#${newTopicId}</code>` : '';
                            const createdText = `🎉 <b>[ĐÃ KHỞI TẠO DỰ ÁN MỚI THÀNH CÔNG!]</b>\n──────────────────────\n📁 <b>Tên dự án:</b> <code>${pName}</code>\n💾 <b>Vị trí lưu trữ:</b> <code>${pPath}</code>\n🖥️ <b>Cửa sổ Antigravity PC:</b> ĐÃ BẬT MỞ${topicNote}\n\n✨ Cửa sổ làm việc mới trên PC và Topic Telegram đã được đồng bộ song song 1-1!`;
                            resetProjectWizard();
                            await sendMsg(chatId, createdText, activeThreadId, 'HTML', getMainMenuMarkup());
                            forwardToAntigravity(conversationId, `[DỰ ÁN MỚI ĐÃ TẠO]: Người dùng vừa tạo dự án mới '${pName}' tại: ${pPath}${topicNote}`);
                            continue;
                        }

                        // Q. PROJECT WIZARD: HỦY TẠO DỰ ÁN
                        if (cbData === 'wizard_cancel') {
                            resetProjectWizard();
                            await tgApiRaw('answerCallbackQuery', { callback_query_id: cb.id, text: 'Đã hủy thao tác' });
                            await sendMsg(chatId, `❌ <b>[ĐÃ HỦY THAO TÁC]</b>`, activeThreadId, 'HTML', getMainMenuMarkup());
                            continue;
                        }

                        continue;
                    }

                    // 2. XỬ LÝ TIN NHẮN MỚI HOẶC TIN NHẮN ĐƯỢC CHỈNH SỬA
                    const msg = update.message || update.edited_message;
                    if (!msg) continue;
                    const isEdit = !!update.edited_message;

                    const chatId = msg.chat.id;
                    const threadId = msg.message_thread_id || 1160;
                    const fromId = msg.from ? msg.from.id : 0;

                    if (msg.from && msg.from.is_bot) continue;

                    const isAllowed = allowedList.includes(Number(chatId)) || allowedList.includes(Number(fromId));
                    if (!isAllowed) continue;

                    activeChatId = chatId;
                    activeThreadId = threadId;

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

                    console.log(`[Telegram Nhận Tin] (chat=${chatId}, thread=${threadId}): ${userText.substring(0, 60)}`);

                    // 👉 XỬ LÝ NẾU ĐANG CHỜ SỬA PROMPT TRONG HÀNG ĐỢI
                    if (waitingForEditQueueId) {
                        const updated = updatePrompt(waitingForEditQueueId, userText);
                        const editedId = waitingForEditQueueId;
                        waitingForEditQueueId = null;
                        if (updated) {
                            await sendMsg(
                                chatId,
                                `✅ <b>[ĐÃ CẬP NHẬT PROMPT MỚI CHO HÀNG ĐỢI]</b>\nNội dung mới: <blockquote><i>${escapeHtml(updated.preview)}</i></blockquote>`,
                                threadId,
                                'HTML',
                                getQueueButtons(editedId)
                            );
                        }
                        continue;
                    }

                    // 1. Kiểm tra nếu đang chờ mật khẩu tối cao Super Admin (Easter Egg 7 lần)
                    if (isWaitingForMasterPassword()) {
                        if (verifyMasterPassword(userText)) {
                            console.log('[Easter Egg] Mật mã chính xác: 270927-260626-ltqlovepmt! Super Admin Unlocked!');
                            forwardToAntigravity(conversationId, `[XÁC THỰC SUPER ADMIN THÀNH CÔNG]: Người dùng đã nhập đúng mật mã bí mật '270927-260626-ltqlovepmt' qua cơ chế gõ 7 lần. Toàn quyền quản trị repo đã được kích hoạt!`);
                            const adminUnlockedText = `👑 <b>[XÁC THỰC THÀNH CÔNG - SUPER ADMIN ACTIVATED]</b>\n──────────────────────\n🔑 <b>Mật khẩu chính xác:</b> <code>270927-260626-ltqlovepmt</code>\n✨ <b>Quyền hạn:</b> TOÀN QUYỀN SỞ HỮU &amp; ĐIỀU HÀNH REPO\n🚀 <b>Trạng thái:</b> Master Control Board đã mở khóa 100%!\n\nBro đã nắm giữ toàn quyền sử dụng repo và kiểm soát toàn bộ hệ sinh thái QuinloveRin Code!`;
                            await sendMsg(chatId, adminUnlockedText, threadId, 'HTML', getMainMenuMarkup());
                            continue;
                        } else {
                            cancelWaitingPassword();
                            await sendMsg(chatId, `❌ <b>[MẬT KHẨU KHÔNG CHÍNH XÁC]</b>\nĐã hủy chế độ xác thực bí mật. Trở về trạng thái bình thường.`, threadId, 'HTML', getMainMenuMarkup());
                            continue;
                        }
                    }

                    // 2. Kiểm tra nếu đang trong Wizard tạo dự án mới (Bước 1: Nhận tên dự án)
                    const currentWiz = getProjectWizard();
                    if (currentWiz.active && currentWiz.step === 'AWAITING_NAME') {
                        const cleanProjectName = userText.trim().replace(/[^a-zA-Z0-9_\-]/g, '_');
                        if (!cleanProjectName) {
                            await sendMsg(chatId, `❌ Tên dự án không hợp lệ. Vui lòng gửi lại tên dự án (ví dụ: <code>App-Ban-Hang</code>):`, threadId);
                            continue;
                        }
                        currentWiz.projectName = cleanProjectName;

                        currentWiz.step = 'AWAITING_DRIVE';
                        const drivePrompt = `💾 <b>[KHỞI TẠO DỰ ÁN MỚI - BƯỚC 2/2]</b>\n──────────────────────\n• <b>Tên dự án:</b> <code>${cleanProjectName}</code>\n\nĐã phát hiện các ổ cứng trên PC của bro. Chọn vị trí lưu trữ dự án:`;
                        await sendMsg(chatId, drivePrompt, threadId, 'HTML', getDriveSelectionMarkup('wizard_drive_'));
                        continue;
                    }

                    // 3. Menu Hub Command (/menu, /start, /hub)
                    if (/^(?:\/menu|\/start|\/hub|menu)$/i.test(userText.trim())) {
                        await sendMsg(chatId, getMainMenuText(), threadId, 'HTML', getMainMenuMarkup());
                        continue;
                    }

                    // Xử lý lệnh ngắt kết nối / bàn giao Cloud 24/7
                    if (/^(?:\/disconnect|\/ngatketnoi|\/cloud|ngắt kết nối)$/i.test(userText.trim())) {
                        await handleDisconnectCloud();
                        continue;
                    }

                    // Xử lý lệnh hủy nhanh
                    if (/^(?:\/cancel|stop|hủy|dừng|dừng lại)$/i.test(userText)) {
                        await handleCancelAction(isEdit ? 'Edit message to STOP' : 'Text STOP');
                        continue;
                    }

                    // Kiểm tra nếu đang chờ mã 4 số kết nối lại
                    if ((waitingForPairCode && /^\d{4}$/.test(userText.trim())) || userText.trim() === '6585') {
                        const code = userText.trim();
                        if (code === '6585') {
                            waitingForPairCode = false;
                            isCloudStandby = false;
                            forwardToAntigravity(conversationId, `[LỆNH CƯỠNG CHẾ KẾT NỐI LẠI]: Người dùng đã nhập đúng mã 6585 từ Telegram. Đồng bộ tức thì với cửa sổ Antigravity PC.`);
                            await sendMsg(
                                chatId,
                                `⚡ <b>[ĐÃ KẾT NỐI QUA MÃ 6585 THÀNH CÔNG!]</b>\n──────────────────────\n🖥️ <b>Cửa sổ Antigravity PC:</b> SẴN SÀNG 100%\n🚀 <b>Kênh làm việc:</b> Topic ${threadId}\n✨ Cầu nối PC đã thức tỉnh hoàn toàn! Bro gửi yêu cầu code hoặc ảnh ngay bây giờ nhé!`,
                                threadId
                            );
                            continue;
                        } else {
                            await sendMsg(
                                chatId,
                                `❌ <b>[SAI MÃ ĐỒNG BỘ]</b>\nMã <code>${code}</code> không chính xác! Vui lòng nhập lại mã 4 số (Ví dụ: <code>6585</code>):`,
                                threadId
                            );
                            continue;
                        }
                    }

                    // Xử lý lệnh cưỡng chế kết nối lại (/ketnoi, /ketnoilai, /reconnect, /pc)
                    if (/^(?:\/ketnoi|\/ketnoilai|\/reconnect|\/pc|\/local|kết nối lại)(?:\s+(\w+))?$/i.test(userText.trim())) {
                        const match = userText.trim().match(/^(?:\/ketnoi|\/ketnoilai|\/reconnect|\/pc|\/local|kết nối lại)(?:\s+(\w+))?$/i);
                        const providedCode = match ? match[1] : null;

                        if (!providedCode) {
                            currentPin = '';
                            pinFailedCount = 0;
                            const initialScreen = `📟 <b>[BÀN PHÍM XÁC THỰC KẾT NỐI]</b>\n──────────────────────\nMàn hình: <code>${getPinDisplay('')}</code>\n<i>(Nhập mã 4 số rồi bấm ↵ Enter để kết nối với PC)</i>`;
                            await sendMsg(chatId, initialScreen, threadId, 'HTML', getKeypadMarkup());
                            continue;
                        }

                        if (providedCode === '6585' || /6585/i.test(providedCode)) {
                            waitingForPairCode = false;
                            currentPhase = 'IDLE';
                            isCloudStandby = false;
                            stopTicker();
                            tempMsgIds = [];
                            promptMsgId = null;

                            forwardToAntigravity(conversationId, `[LỆNH CƯỠNG CHẾ KẾT NỐI LẠI]: Người dùng yêu cầu đồng bộ tức thì qua mã 6585. Cửa sổ Antigravity PC đã kết nối sẵn sàng 100%.`);

                            await sendMsg(
                                chatId,
                                `⚡ <b>[ĐÃ CƯỠNG CHẾ KẾT NỐI LẠI THÀNH CÔNG!]</b>\n──────────────────────\n🖥️ <b>Cửa sổ Antigravity PC:</b> SẴN SÀNG 100%\n🚀 <b>Kênh làm việc:</b> Topic ${threadId}\n✨ Cầu nối PC đã thức tỉnh hoàn toàn! Mọi tin nhắn bro gửi tiếp theo sẽ được xử lý ngay lập tức!`,
                                threadId
                            );
                            continue;
                        } else {
                            waitingForPairCode = true;
                            await sendMsg(
                                chatId,
                                `❌ <b>[MÃ 4 SỐ KHÔNG ĐÚNG]</b>\nMã <code>${providedCode}</code> không khớp. Bro hãy nhập lại mã 4 số chính xác (<code>6585</code>):`,
                                threadId
                            );
                            continue;
                        }
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
                    }

                    const forwardPrompt = localPhotoPath
                        ? `${replyContext}[Topic #${threadId}][Điện thoại gửi ảnh]: ${userText} (Đã tải ảnh về máy tại: ${localPhotoPath})`
                        : (isEdit ? `${replyContext}[Topic #${threadId}][Điện thoại sửa prompt thành]: ${userText}` : `${replyContext}[Topic #${threadId}][Điện thoại gửi]: ${userText}`);

                    const previewClean = userText.replace(/[<>]/g, '');
                    const previewSafe = escapeHtml(previewClean.length > 55 ? previewClean.substring(0, 55) + '...' : previewClean);
                    showScreenToast(isEdit ? '✏️ Telegram -> Prompt Sửa' : '📱 Telegram -> PC Sync', previewClean);
                    recordSyncMessage(syncBridgePath, conversationId, 'phone', isEdit ? `[Sửa tin]: ${userText}` : userText);

                    // Nếu máy tính đang bận: Đưa vào hàng đợi
                    if (currentPhase !== 'IDLE' && currentPhase !== 'CANCELED') {
                        const qId = 'q_' + Date.now();
                        addPrompt({
                            id: qId,
                            text: forwardPrompt,
                            preview: userText,
                            chatId: chatId,
                            threadId: threadId,
                            timestamp: Date.now()
                        });

                        const qNotice = `📥 <b>[ĐÃ NẠP VÀO HÀNG ĐỢI PC]</b>\n<blockquote><i>${previewSafe}</i></blockquote>\n<i>Máy tính đang xử lý tác vụ trước đó. Prompt này đã được xếp vị trí <b>#${promptQueue.length}</b> trong hàng chờ!</i>`;
                        await sendMsg(chatId, qNotice, threadId, 'HTML', getQueueButtons(qId));
                        continue;
                    }

                    // Nếu máy tính đang IDLE: Thực thi ngay lập tức tại đúng thread đó!
                    await executePromptImmediately(chatId, threadId, forwardPrompt, userText, isEdit, isPhoto);
                }
            }
        } catch (e) {
            console.error('[Polling Exception]:', e.message);
            await new Promise(r => setTimeout(r, 2000));
        }
    }
}

pollUpdates();
