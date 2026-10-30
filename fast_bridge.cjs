const fs = require('fs');
const path = require('path');
const { execFile, spawn, exec } = require('child_process');

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
    recordSyncMessage,
    launchOrFocusAntigravity
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
    getQueueListMarkup,
    clearQueue
} = require('./lib/queue.cjs');

const lobby = require('./lib/lobby.cjs');
const {
    getMainMenuMarkup,
    getMainMenuText
} = lobby;

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

// --- LIVE TICKING STOPWATCH IS OFFLOADED TO STANDALONE .BAT WORKER (send_worker.cjs) ---
function startTicker() {}
function stopTicker() {}

// --- HUGGING FACE GRADIO CLOUD HANDOVER HELPERS ---

async function callGradioApi(fnName, dataArr) {
    try {
        const resp = await fetch('https://trungm-quinloverin.hf.space/gradio_api/call/' + fnName, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ data: dataArr }),
            signal: AbortSignal.timeout(4000)
        });
        if (!resp.ok) return null;
        const j = await resp.json();
        if (!j.event_id) return null;
        const streamResp = await fetch('https://trungm-quinloverin.hf.space/gradio_api/call/' + fnName + '/' + j.event_id, {
            signal: AbortSignal.timeout(4000)
        });
        const text = await streamResp.text();
        const match = text.match(/data:\s*\[(.*?)\]/);
        return match ? JSON.parse('[' + match[1] + ']')[0] : null;
    } catch (e) {
        return null;
    }
}

async function checkHfMode() {
    return await callGradioApi('get_mode', []);
}

async function setHfMode(mode) {
    return await callGradioApi('set_mode', [mode]);
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

    const handoverText = `☁️ <b>[ĐÃ NGẮT KẾT NỐI VỚI PC - BÀN GIAO CHO HUGGING FACE CLOUD 24/7]</b>\n──────────────────────\n🖥️ <b>Máy tính:</b> Đã ngưng tiếp nhận lệnh trực tiếp (Chế độ Chờ)\n🌐 <b>Hugging Face Cloud (Gemini 3.5 Flash):</b> ĐÃ TIẾP QUẢN 24/7!\n\n✨ Giờ bro có thể chat, yêu cầu code hoặc commit file ngay cả khi máy tính tắt nguồn!\n\n👉 Khi muốn kết nối lại máy tính, chỉ cần gõ <code>/pc</code> hoặc nhập mã PIN <code>2726</code>.`;
    await sendMsg(activeChatId, handoverText, activeThreadId, 'HTML', { inline_keyboard: [] });

    try {
        await tgApiRaw('deleteWebhook');
        await setHfMode('cloud');
        console.log('[Bridge Disconnect] Đã gỡ webhook và kích hoạt Hugging Face tiếp quản 24/7!');
    } catch (e) {}
}

// --- HANDLE CANCEL ACTION ---

async function handleEmergencyCancel(chatId, threadId, source = '/cancel') {
    console.log(`[Bridge Action] 🛑 KÍCH HOẠT LỆNH HỦY KHẨN CẤP /CANCEL (${source})`);
    
    // 1. Dọn sạch hàng đợi (Queue)
    const clearedQueueCount = clearQueue();
    
    // 2. Chuyển trạng thái về IDLE ngay lập tức để sẵn sàng nhận lệnh mới
    currentPhase = 'IDLE';
    stopTicker();

    // 3. Tua nhanh transcript watcher để bỏ qua mọi phản hồi cũ
    if (transcriptWatcher) {
        transcriptWatcher.fastForward();
    }

    // 4. Xóa toàn bộ nút bấm hủy cũ trên Telegram
    await clearAllCancelButtons(chatId || activeChatId, tempMsgIds);

    // 5. Gửi tín hiệu cancel cho worker ngầm BAT
    sendViaBat({
        action: 'cancel',
        chat_id: chatId || activeChatId,
        message_thread_id: threadId || activeThreadId
    });

    // 6. Phát tín hiệu ưu tiên tối cao vào Antigravity PC
    forwardToAntigravity(conversationId, `[LỆNH HỦY KHẨN CẤP /CANCEL TỪ ĐIỆN THOẠI]: Người dùng đã phát lệnh /cancel ưu tiên tối cao nhất! Hãy dừng ngay lập tức mọi tác vụ, hủy bỏ toàn bộ tiến trình ngầm và chuyển sang trạng thái IDLE sẵn sàng đón yêu cầu mới.`);

    // 7. Dọn dẹp toàn bộ biến tạm
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
        runCountdownCleanup(chatId || activeChatId, threadId || activeThreadId, toClean);
    }

    // 8. Bắn phản hồi xác nhận khẩn cấp về Telegram Topic
    const targetChat = chatId || activeChatId;
    const targetThread = threadId || activeThreadId;
    const cancelNotice = `🛑 <b>[LỆNH ƯU TIÊN CAO NHẤT: /CANCEL]</b>\n──────────────────────\n✅ <b>ĐÃ CƯỠNG CHẾ DỪNG TOÀN BỘ THÀNH CÔNG!</b>\n\n• 🛑 <b>Tác vụ đang chạy:</b> Đã ngắt ngay lập tức.\n• 🧹 <b>Hàng đợi (Queue):</b> Đã dọn sạch (${clearedQueueCount} prompt chờ).\n• 🔄 <b>Tiến trình máy tính:</b> Đã reset về trạng thái <b>SẴN SÀNG (IDLE)</b>.\n• ⚡ <b>AI Cầu Nối:</b> Đã ngắt lệnh chờ, bro gửi yêu cầu mới được ngay!`;

    await sendMsg(targetChat, cancelNotice, targetThread, 'HTML');
}

async function handleCancelAction(source = 'button') {
    return await handleEmergencyCancel(activeChatId, activeThreadId, source);
}

// --- REMOTE CMD CONTROLLER (ĐIỀU KHIỂN TERMINAL TỪ XA CHO MÁY MỚI / QUÁN NET) ---

function executeRemoteCmd(chatId, threadId, command, isBackground = false) {
    if (!command || !command.trim()) {
        return sendMsg(chatId, '⚠️ Vui lòng nhập lệnh sau <code>/cmd</code> (Ví dụ: <code>/cmd dir</code> hoặc <code>/cmd git status</code>)', threadId);
    }
    const cleanCmd = command.trim();
    console.log(`[Remote CMD] Thực thi (${isBackground ? 'Background' : 'Sync'}): ${cleanCmd}`);

    if (isBackground) {
        try {
            const child = spawn('cmd.exe', ['/c', cleanCmd], {
                cwd: rootDir,
                detached: true,
                stdio: 'ignore'
            });
            child.unref();
            return sendMsg(
                chatId,
                `⚡ <b>[ĐÃ KHỞI CHẠY TIẾN TRÌNH NGẦM]</b>\n──────────────────────\n💻 <b>Lệnh:</b> <code>${escapeHtml(cleanCmd)}</code>\n🆔 <b>PID:</b> <code>${child.pid || 'Active'}</code>\n📂 <b>Thư mục:</b> <code>${escapeHtml(rootDir)}</code>\n<i>Tiến trình đang chạy ngầm độc lập, không chặn các lệnh khác!</i>`,
                threadId
            );
        } catch (e) {
            return sendMsg(chatId, `❌ Lỗi khởi chạy tiến trình ngầm: ${escapeHtml(e.message)}`, threadId);
        }
    }

    sendTyping(chatId, threadId);
    const startTime = Date.now();
    exec(cleanCmd, { cwd: rootDir, timeout: 30000, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        let output = (stdout || '').trim();
        if (stderr && stderr.trim()) {
            output += (output ? '\n' : '') + '[STDERR]: ' + stderr.trim();
        }
        if (!output && err) {
            output = '[LỖI]: ' + err.message;
        }
        if (!output) {
            output = '(Lệnh đã thực thi thành công nhưng không có dữ liệu trả về)';
        }

        if (output.length > 3500) {
            output = output.substring(0, 3500) + '\n... [Đã cắt ngắn bớt nội dung vượt quá giới hạn]';
        }

        const reply = `💻 <b>[CMD OUTPUT]</b> (⏱️ ${elapsed}s)\n<pre><code>${escapeHtml(output)}</code></pre>`;
        sendMsg(chatId, reply, threadId, 'HTML');
    });
}

// --- START PROMPT EXECUTION HELPER ---

async function executePromptImmediately(chatId, threadId, promptText, previewText, isEdit = false, isPhoto = false) {
    currentPhase = 'READING';
    promptStartTime = Date.now();
    promptTextSaved = previewText;
    isPhotoSaved = isPhoto;
    isEditedPrompt = isEdit;
    activeChatId = chatId;
    activeThreadId = threadId;

    forwardToAntigravity(conversationId, promptText);
    sendTyping(chatId, threadId);

    await clearAllCancelButtons(chatId);

    // Giao toàn bộ việc gửi bong bóng nhận prompt & Live Ticking Stopwatch cho BAT độc lập
    sendViaBat({
        action: 'prompt_start',
        chat_id: chatId,
        message_thread_id: threadId,
        preview: previewText,
        isEdit: isEdit,
        isPhoto: isPhoto
    });
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
                const wakeSignal = path.join(rootDir, 'wake_pc.signal');
                if (fs.existsSync(wakeSignal)) {
                    try { fs.unlinkSync(wakeSignal); } catch (e) {}
                    isCloudStandby = false;
                    console.log('[Bridge Wakeup] ⚡ Đã nhận tín hiệu cưỡng chế kết nối lại từ PC! Tiếp quản Telegram ngay lập tức!');
                    await sendMsg(activeChatId, '🖥️ <b>[PC LOCAL BRIDGE - SẴN SÀNG]</b>\n──────────────────────\nPC đã thức tỉnh và tiếp quản kết nối Telegram thành công!', activeThreadId);
                } else {
                    try {
                        const hfMode = await checkHfMode();
                        if (hfMode === 'pc') {
                            isCloudStandby = false;
                            console.log('[Bridge Wakeup] ⚡ Hugging Face đã bàn giao lại cho PC! Tiếp quản Telegram ngay lập tức!');
                            await sendMsg(activeChatId, '🖥️ <b>[PC LOCAL BRIDGE - TIẾP QUẢN THÀNH CÔNG]</b>\n──────────────────────\nPC đã nhận lệnh bàn giao từ Cloud và kết nối sẵn sàng 100%!', activeThreadId);
                            continue;
                        }
                    } catch (e) {}
                    await new Promise(r => setTimeout(r, 2000));
                    continue;
                }
            }

            const res = await tgApiRaw('getUpdates', { offset: pollOffset, timeout: 8 });
            if (!res.ok) {
                if (res.error_code === 409) {
                    console.warn('[Bridge Polling] 409 Conflict: Đang chờ 4s trước khi thử lại...');
                    await new Promise(r => setTimeout(r, 4000));
                    continue;
                }
                await new Promise(r => setTimeout(r, 2000));
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
                        const cbThreadId = (cb.message && cb.message.message_thread_id) ? cb.message.message_thread_id : null;
                        activeChatId = chatId;
                        activeThreadId = cbThreadId;

                        const isAllowed = allowedList.includes(Number(chatId)) || allowedList.includes(Number(fromId));
                        if (!isAllowed) continue;

                        // XỬ LÝ TOÀN BỘ SỰ KIỆN NÚT BẤM SẢNH LOBBY QUA LIB/LOBBY.CJS
                        const lobbyHandled = await lobby.handleLobbyCallback(cb, {
                            sendMsg,
                            tgApiRaw,
                            forwardToAntigravity,
                            handleDisconnectCloud,
                            conversationId,
                            getPinDisplay,
                            getKeypadMarkup
                        });
                        if (lobbyHandled) continue;

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

                            if (lobby.verifyProjectPin(currentPin, cbThreadId || activeThreadId)) {
                                const verifiedCode = currentPin;
                                pinFailedCount = 0;
                                currentPin = '';
                                currentPhase = 'IDLE';
                                isCloudStandby = false;
                                stopTicker();
                                tempMsgIds = [];
                                promptMsgId = null;
                                activeThreadId = (cb.message && cb.message.message_thread_id) || activeThreadId || 1160;
                                launchOrFocusAntigravity();
                                await tgApiRaw('answerCallbackQuery', { callback_query_id: cb.id, text: '✅ Mã chính xác! Đang kết nối...' });
                                const successText = `⚡ <b>[ĐÃ KẾT NỐI QUA MÃ PIN ${verifiedCode} THÀNH CÔNG!]</b>\n──────────────────────\n🖥️ <b>Cửa sổ Antigravity PC:</b> SẴN SÀNG 100%\n🚀 <b>Kênh làm việc:</b> Topic ${activeThreadId}\n🔗 <b>Mã định danh:</b> <code>GM_${verifiedCode}_Mthu</code>\n✨ Đã cưỡng chế kết nối máy tính thành công! Bro gửi yêu cầu code hoặc ảnh ngay bây giờ nhé!`;
                                await editMsg(chatId, cb.message.message_id, successText, 'HTML', { inline_keyboard: [] }, true);
                                forwardToAntigravity(conversationId, `[LỆNH CƯỠNG CHẾ KẾT NỐI LẠI]: Người dùng đã nhập đúng mã PIN ${verifiedCode} qua bàn phím PIN. Đồng bộ tức thì với cửa sổ Antigravity PC.`);
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

                        continue;
                    }

                    // 2. XỬ LÝ TIN NHẮN MỚI HOẶC TIN NHẮN ĐƯỢC CHỈNH SỬA
                    const msg = update.message || update.edited_message;
                    if (!msg) continue;
                    const isEdit = !!update.edited_message;

                    const chatId = msg.chat.id;
                    const threadId = msg.message_thread_id ? Number(msg.message_thread_id) : null;
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

                    // 👉 NẾU TIN NHẮN TẠI SẢNH LOBBY (threadId === null):
                    // BÀN GIAO 100% CHO LIB/LOBBY.CJS - TUYỆT ĐỐI KHÔNG CHẠY CODE TẠI ĐÂY!
                    if (threadId === null) {
                        await lobby.handleLobbyTextMessage(msg, userText, {
                            sendMsg,
                            tgApiRaw,
                            forwardToAntigravity,
                            conversationId
                        });
                        continue;
                    }

                    // 👉 XỬ LÝ NẾU ĐANG CHỜ SỬA PROMPT TRONG HÀNG ĐỢI (TẠI CÁC TOPIC DỰ ÁN)
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

                    // Xử lý lệnh ngắt kết nối / bàn giao Cloud 24/7
                    if (/^(?:\/disconnect|\/ngatketnoi|\/cloud|ngắt kết nối)$/i.test(userText.trim())) {
                        await handleDisconnectCloud();
                        continue;
                    }

                    // 🛑 LỆNH ƯU TIÊN CAO NHẤT: /CANCEL (HỦY TOÀN BỘ TIẾN TRÌNH & HÀNG ĐỢI)
                    if (/^(?:\/cancel|\/cancel_all|\/stop|\/kill|\/abort|hủy|dừng|dừng lại)(?:\s.*)?$/i.test(userText.trim())) {
                        await handleEmergencyCancel(chatId, threadId, isEdit ? 'Edit message to /cancel' : userText.trim());
                        continue;
                    }

                    // 🖥️ LỆNH BẬT / MỞ CỬA SỔ ANTIGRAVITY TRÊN MÁY TÍNH
                    if (/(?:bật|mở|khởi động|chạy|hiển thị|open|focus|show).*(?:antigravity|ide|app|cửa sổ)|^(\/antigravity|\/open_antigravity|\/open|\/app|\/ide|antigravity)$/i.test(userText.trim())) {
                        const launchResult = launchOrFocusAntigravity();
                        if (launchResult === 'NOT_FOUND') {
                            await sendMsg(
                                chatId,
                                `⚠️ <b>[CHƯA CÀI ANTIGRAVITY TRÊN MÁY TÍNH NÀY]</b>\n──────────────────────\nℹ️ Máy tính hiện tại chưa cài đặt ứng dụng Antigravity IDE (hoặc bro đang dùng ở máy mới / quán net).\n\n💡 <b>Bro có thể làm gì?</b>\n1️⃣ <b>Dùng Remote CMD độc lập:</b> Gõ <code>/cmd &lt;lệnh&gt;</code> để chạy lệnh shell/git trực tiếp trên máy mà không cần mở giao diện IDE!\n2️⃣ <b>Tải Antigravity:</b> Gõ <code>/download_antigravity</code> để mở trang tải chính thức trên PC!`,
                                threadId
                            );
                        } else {
                            const actionDesc = launchResult === 'LAUNCHED' 
                                ? 'Đã khởi chạy ứng dụng Antigravity IDE mới trên PC!' 
                                : launchResult === 'FOCUSED'
                                ? 'Đã khôi phục (restore) và đưa cửa sổ Antigravity lên phía trước màn hình!'
                                : 'Đã kích hoạt và đưa cửa sổ Antigravity lên phía trước màn hình!';
                            await sendMsg(
                                chatId,
                                `🖥️ <b>[ĐÃ MỞ CỬA SỔ ANTIGRAVITY TRÊN PC]</b>\n──────────────────────\n✅ <b>${actionDesc}</b>\n⚡ Cầu nối IPC đã đồng bộ hóa 100% với Antigravity PC.\n🚀 Bro gửi prompt hoặc yêu cầu code là AI nhận ngay lập tức!`,
                                threadId
                            );
                        }
                        continue;
                    }

                    // 🌐 LỆNH TẢI ANTIGRAVITY IDE CHO MÁY MỚI
                    if (/^(?:\/download_antigravity|\/cai_antigravity|tải antigravity|cài antigravity)$/i.test(userText.trim())) {
                        try {
                            const cp = require('child_process');
                            cp.exec('powershell.exe -NoProfile -Command "Start-Process https://antigravity.google"');
                        } catch (e) {}
                        await sendMsg(
                            chatId,
                            `🌐 <b>[ĐANG MỞ TRANG TẢI ANTIGRAVITY TRÊN PC]</b>\n──────────────────────\n✅ Đã mở trình duyệt tải Antigravity IDE tại: https://antigravity.google\n⚡ Sau khi cài xong, bro gõ <code>/app</code> để bot kết nối ngay lập tức!`,
                            threadId
                        );
                        continue;
                    }

                    // 💻 LỆNH ĐIỀU KHIỂN REMOTE CMD / TERMINAL TRÊN MÁY TÍNH (CHO QUÁN NET / PC MỚI)
                    const cmdMatch = userText.trim().match(/^(?:\/cmd|\/sh|\/exec|\/terminal)(?:\s+([\s\S]+))?$/i);
                    if (cmdMatch) {
                        const commandToRun = cmdMatch[1];
                        executeRemoteCmd(chatId, threadId, commandToRun, false);
                        continue;
                    }

                    // ⚡ LỆNH SINH TIẾN TRÌNH CMD CHẠY NGẦM (SPAWN SUB-PROCESS)
                    const spawnMatch = userText.trim().match(/^(?:\/spawn|\/cmd_bg|\/bg)(?:\s+([\s\S]+))?$/i);
                    if (spawnMatch) {
                        const commandToRun = spawnMatch[1];
                        executeRemoteCmd(chatId, threadId, commandToRun, true);
                        continue;
                    }

                    // Kiểm tra nếu đang chờ mã 4 số kết nối lại
                    if ((waitingForPairCode && /^\d{4}$/.test(userText.trim())) || /^(?:2726|6585)$/.test(userText.trim())) {
                        const code = userText.trim();
                        if (lobby.verifyProjectPin(code, threadId)) {
                            waitingForPairCode = false;
                            isCloudStandby = false;
                            launchOrFocusAntigravity();
                            forwardToAntigravity(conversationId, `[LỆNH CƯỠNG CHẾ KẾT NỐI LẠI]: Người dùng đã nhập đúng mã PIN ${code} từ Telegram. Đồng bộ tức thì với cửa sổ Antigravity PC.`);
                            await sendMsg(
                                chatId,
                                `⚡ <b>[ĐÃ KẾT NỐI QUA MÃ PIN ${code} THÀNH CÔNG!]</b>\n──────────────────────\n🖥️ <b>Cửa sổ Antigravity PC:</b> SẴN SÀNG 100%\n🚀 <b>Kênh làm việc:</b> Topic ${threadId || 'Lobby'}\n✨ Cầu nối PC đã thức tỉnh hoàn toàn! Bro gửi yêu cầu code hoặc ảnh ngay bây giờ nhé!`,
                                threadId
                            );
                            continue;
                        } else {
                            const expectedPin = lobby.getProjectPin(threadId);
                            await sendMsg(
                                chatId,
                                `❌ <b>[SAI MÃ ĐỒNG BỘ]</b>\nMã <code>${code}</code> không chính xác! Vui lòng nhập lại mã 4 số (Mã dự án này: <code>${expectedPin}</code>):`,
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
                            const initialScreen = `📟 <b>[BÀN PHÍM XÁC THỰC KẾT NỐI]</b>\n──────────────────────\nMàn hình: <code>${getPinDisplay('')}</code>\n<i>(Nhập mã PIN 4 số của dự án rồi bấm ↵ Enter để kết nối với PC)</i>`;
                            await sendMsg(chatId, initialScreen, threadId, 'HTML', getKeypadMarkup());
                            continue;
                        }

                        if (lobby.verifyProjectPin(providedCode, threadId)) {
                            waitingForPairCode = false;
                            currentPhase = 'IDLE';
                            isCloudStandby = false;
                            stopTicker();
                            tempMsgIds = [];
                            promptMsgId = null;
                            launchOrFocusAntigravity();

                            forwardToAntigravity(conversationId, `[LỆNH CƯỠNG CHẾ KẾT NỐI LẠI]: Người dùng yêu cầu đồng bộ tức thì qua mã PIN ${providedCode}. Cửa sổ Antigravity PC đã kết nối sẵn sàng 100%.`);

                            await sendMsg(
                                chatId,
                                `⚡ <b>[ĐÃ CƯỠNG CHẾ KẾT NỐI LẠI THÀNH CÔNG!]</b>\n──────────────────────\n🖥️ <b>Cửa sổ Antigravity PC:</b> SẴN SÀNG 100%\n🚀 <b>Kênh làm việc:</b> Topic ${threadId || 'Lobby'}\n✨ Cầu nối PC đã thức tỉnh hoàn toàn! Mọi tin nhắn bro gửi tiếp theo sẽ được xử lý ngay lập tức!`,
                                threadId
                            );
                            continue;
                        } else {
                            waitingForPairCode = true;
                            const expectedPin = lobby.getProjectPin(threadId);
                            await sendMsg(
                                chatId,
                                `❌ <b>[MÃ 4 SỐ KHÔNG ĐÚNG]</b>\nMã <code>${providedCode}</code> không khớp. Bro hãy nhập lại mã 4 số chính xác (<code>${expectedPin}</code>):`,
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

                        sendViaBat({
                            action: 'queue',
                            chat_id: chatId,
                            message_thread_id: threadId,
                            preview: userText,
                            queueId: qId,
                            queuePos: promptQueue.length
                        });
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

// --- TỰ ĐỘNG BÀN GIAO CHO CLOUD 24/7 KHI TẮT MÁY / TẮT TIẾN TRÌNH ---
let isShuttingDown = false;
async function restoreCloudOnExit(reason) {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log(`[Bridge Exit] Tiến trình kết thúc (${reason}), tự động chuyển giao cho Hugging Face Cloud 24/7...`);
    try {
        await tgApiRaw('deleteWebhook');
        await setHfMode('cloud');
        console.log('[Bridge Exit] Đã bàn giao Hugging Face Cloud thành công!');
    } catch (e) {
        console.error('[Bridge Exit Error]:', e.message);
    }
}

process.on('SIGINT', async () => { await restoreCloudOnExit('SIGINT'); process.exit(0); });
process.on('SIGTERM', async () => { await restoreCloudOnExit('SIGTERM'); process.exit(0); });
process.on('beforeExit', async () => { await restoreCloudOnExit('beforeExit'); });

// Khởi động: Đặt Hugging Face sang chế độ 'pc' và bắt đầu gửi nhịp tim định kỳ
setHfMode('pc').catch(() => {});

setInterval(async () => {
    if (!isCloudStandby) {
        try {
            await setHfMode('heartbeat');
        } catch (e) {}
    }
}, 25000);

pollUpdates();
