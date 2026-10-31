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

const { takeScreenshot, sendScreenshot } = require('./lib/screen.cjs');
const { sendScreenVideo, recordScreen } = require('./lib/recorder.cjs');
const { checkInstalledBrowsers, getBrowserInstallMarkup, installBrowserAsync } = require('./lib/installer.cjs');
const { openWebOrApp, closeAppOrProcess, normalizeStr, getActiveWindowsSummary, URL_SHORTCUTS, APP_SHORTCUTS } = require('./lib/launcher.cjs');
const { classifyUserIntent } = require('./lib/intent.cjs');

function isConversationalPrompt(text) {
    const clean = (text || '').trim();
    if (!clean) return false;
    if (/[?？]/.test(clean)) return true;
    if (clean.includes('\n') || clean.includes('```')) return true;
    const words = clean.split(/\s+/);
    if (words.length > 3) {
        if (/\b(?:sao|tại sao|vì sao|thế nào|làm sao|lỗi|thấy|bảo|ghi|làm gì|được k|được không|vậy|hả|à|nhỉ|hỏi|như v|như vậy|chưa|không được|k được|chỉ hiện|làm gì có|giúp|viết|sửa|chạy)\b/i.test(clean)) {
            return true;
        }
    }
    return false;
}

const { askGroq } = require('./lib/groq.cjs');

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

// --- CLOUDFLARE WORKER 24/7 CLOUD HANDOVER HELPERS ---
const CLOUD_WORKER_URL = 'https://quin-iu-mthu-code-mobile.letrungquangm.workers.dev';

async function setCloudWebhook(enable = true) {
    try {
        if (enable) {
            const res = await tgApiRaw('setWebhook', { url: CLOUD_WORKER_URL, ip_address: '172.67.144.228', drop_pending_updates: false });
            console.log('[Cloud Handover] Đã kích hoạt Webhook tới Cloudflare Worker 24/7:', res && res.ok ? 'OK' : JSON.stringify(res));
            return res && res.ok;
        } else {
            const res = await tgApiRaw('deleteWebhook');
            console.log('[PC Local] Đã gỡ Webhook, PC tiếp quản Telegram trực tiếp:', res && res.ok ? 'OK' : JSON.stringify(res));
            return res && res.ok;
        }
    } catch (e) {
        console.error('[Cloud Handover Error]:', e.message);
        return false;
    }
}

// --- HANDLE DISCONNECT & CLOUD HANDOVER ---

async function handleDisconnectCloud(targetChatId = null, targetThreadId = null) {
    const chatId = targetChatId || activeChatId;
    console.log('[Bridge Disconnect] Bàn giao cho Cloudflare Worker 24/7...');
    isCloudStandby = true;
    stopTicker();
    await clearAllCancelButtons(chatId, tempMsgIds);
    tempMsgIds = [];
    promptMsgId = null;
    currentWorkingMsgId = null;

    let cloudTopicId = null;

    // 1. TẠO TOPIC RIÊNG BIỆT CHO CLOUD ĐỂ KHÔNG BAO GIỜ CODE BÊN SẢNH LOBBY
    try {
        const topicRes = await tgApiRaw('createForumTopic', {
            chat_id: chatId,
            name: '☁️ Cloud 24/7 (Groq LPU)',
            icon_color: 7322096 // Màu xanh da trời Cloud
        });
        if (topicRes && topicRes.ok && topicRes.result) {
            cloudTopicId = topicRes.result.message_thread_id;
            console.log(`[Bridge Disconnect] Đã sinh Topic riêng cho Cloud: #${cloudTopicId}`);
        }
    } catch (e) {
        console.error('[Create Cloud Topic Error]:', e.message);
    }

    const destinationThread = cloudTopicId || (!lobby.isLobby(targetThreadId) ? targetThreadId : null);

    const handoverText = `☁️ <b>[CỬA SỔ CLOUDFLARE 24/7 ĐÃ SẴN SÀNG PHỤC VỤ]</b>\n──────────────────────\n🖥️ <b>Máy tính:</b> Đã ngưng tiếp nhận lệnh trực tiếp (Chế độ Chờ)\n🌐 <b>Cloudflare Worker (Groq LPU):</b> ĐÃ TIẾP QUẢN TOÀN DIỆN!\n🔒 <b>Topic độc lập:</b> #${destinationThread || 'Cloud'}\n\n✨ Bro hãy chat, yêu cầu code qua Groq LPU siêu tốc ngay tại đây, kể cả khi máy tính tắt nguồn!\n\n👉 <b>Lệnh hữu ích:</b>\n• <code>/pc</code> hoặc <code>ket noi pc</code>: Gọi máy tính ở nhà tiếp quản lại.\n• <code>/dongtopic</code>: Đóng topic Cloud này khi hoàn tất.`;

    // Tuyệt đối CHỈ gửi tin nhắn này vào Topic riêng của Cloud, KHÔNG BAO GIỜ gửi vào Sảnh Lobby!
    if (destinationThread && !lobby.isLobby(destinationThread)) {
        await sendMsg(chatId, handoverText, destinationThread, 'HTML', { inline_keyboard: [] });
    }

    await setCloudWebhook(true);

    return cloudTopicId;
}

// --- HANDLE CANCEL ACTION ---

async function handleEmergencyCancel(chatId, threadId, source = '/cancel') {
    console.log(`[Bridge Action] 🛑 KÍCH HOẠT LỆNH HỦY KHẨN CẤP /CANCEL (${source})`);
    
    // 0. Xóa bộ giám sát watchdog
    clearWatchdog();

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
    if (!lobby.isSuperAdmin()) {
        return sendMsg(
            chatId,
            `👑 <b>[YÊU CẦU MẬT KHẨU QUẢN TRỊ]</b>\n──────────────────────\n⚠️ <b>Nghiêm cấm thực thi lệnh terminal hoặc chỉnh sửa repo Mthu Code Mobile khi chưa có quyền quản trị!</b>\n\n👉 Bro hãy vào Sảnh dùng cách bạn bảo tôi nhé!`,
            threadId,
            'HTML'
        );
    }
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

// --- AUTONOMOUS CLOUD FALLBACK & RATE LIMIT WATCHDOG ---

let antigravityWatchdogTimer = null;
let currentPromptRaw = '';
let currentPromptChatId = null;
let currentPromptThreadId = null;

function clearWatchdog() {
    if (antigravityWatchdogTimer) {
        clearTimeout(antigravityWatchdogTimer);
        antigravityWatchdogTimer = null;
    }
}

function startWatchdog(chatId, threadId, rawPrompt) {
    clearWatchdog();
    currentPromptRaw = rawPrompt;
    currentPromptChatId = chatId;
    currentPromptThreadId = threadId;

    // Đặt hạn ngạch chờ: 65 giây không phản hồi => Kích hoạt Autonomous Cloud Continuation
    antigravityWatchdogTimer = setTimeout(async () => {
        if (currentPhase !== 'IDLE' && currentPhase !== 'CANCELED') {
            console.warn(`[Watchdog Alert] ⚠️ Antigravity PC không phản hồi sau 65s (Báo Đỏ / Quota Limit). Tự động tiếp nối qua Groq LPU!`);
            await triggerAutonomousCloudFallback('timeout');
        }
    }, 65000);
}

function resetWatchdog() {
    if (antigravityWatchdogTimer) {
        clearTimeout(antigravityWatchdogTimer);
        antigravityWatchdogTimer = setTimeout(async () => {
            if (currentPhase !== 'IDLE' && currentPhase !== 'CANCELED') {
                console.warn(`[Watchdog Alert] ⚠️ Antigravity PC không phản hồi sau 65s (Báo Đỏ / Quota Limit). Tự động tiếp nối qua Groq LPU!`);
                await triggerAutonomousCloudFallback('timeout');
            }
        }, 65000);
    }
}

async function triggerAutonomousCloudFallback(reason = 'timeout') {
    clearWatchdog();
    if (currentPhase === 'IDLE' || currentPhase === 'CANCELED') return;

    const chatId = currentPromptChatId || activeChatId;
    const threadId = currentPromptThreadId || activeThreadId;
    const promptToSolve = promptTextSaved || currentPromptRaw || 'Yêu cầu lập trình';

    console.log(`[Cloud Fallback] Đang kích hoạt tiếp nối cho prompt "${promptToSolve.substring(0, 50)}..."`);

    // 1. Dừng ticker và dọn nút hủy cũ
    stopTicker();
    sendViaBat({
        action: 'cancel',
        chat_id: chatId,
        message_thread_id: threadId
    });
    await clearAllCancelButtons(chatId, tempMsgIds);

    // 2. Gửi thông báo BÁO ĐỎ cho người dùng trên Telegram
    const redAlertNotice = `⚠️ <b>[ANTIGRAVITY PC BÁO ĐỎ / CHẠM TRẦN LIMIT]</b>\n──────────────────────\n⏱️ <b>Trạng thái:</b> Antigravity PC đã chạm trần Rate Limit / Hết Quota tạm thời.\n⚡ <b>Tự động tiếp nối:</b> Máy PC đang kích hoạt <b>Groq LPU (Cloud AI 24/7)</b> để giải quyết ngay lập tức cho bro!`;
    await sendMsg(chatId, redAlertNotice, threadId);

    sendTyping(chatId, threadId);

    // 3. Gọi Groq LPU tiếp nối
    const groqStart = Date.now();
    let groqRes = null;
    try {
        groqRes = await askGroq(promptToSolve);
    } catch (e) {
        console.error('[Groq Fallback Error]:', e.message);
    }

    const elapsed = ((Date.now() - groqStart) / 1000).toFixed(1);

    if (groqRes && groqRes.ok && groqRes.content) {
        let answerText = groqRes.content;

        // Kiểm tra xem Groq có tạo ACTION không
        const actionMatch = answerText.match(/\[ACTION:\s*({.*?})\]/s);
        let executedActionDesc = '';
        if (actionMatch) {
            try {
                const actionData = JSON.parse(actionMatch[1]);
                answerText = answerText.replace(actionMatch[0], '').trim();
                if (actionData.action === 'open_web' && actionData.target) {
                    openWebOrApp(actionData.target, actionData.browser || 'default');
                    executedActionDesc = `\n🌐 <i>(Đã tự động mở: ${actionData.target})</i>`;
                } else if (actionData.action === 'screenshot') {
                    setTimeout(() => sendScreenshot(botToken, chatId, threadId, '📸 [ẢNH CHỤP MÀN HÌNH TỪ GROQ FALLBACK]'), 1500);
                }
            } catch (e) {}
        }

        const formattedAnswer = mdToTgHtml(answerText);
        const header = `🤖 <b>[KẾT QUẢ TIẾP NỐI TỪ GROQ LPU (CLOUD ENGINE)]</b>\n──────────────────────\n⚡ <i>Phản hồi siêu tốc trong ${elapsed}s qua chip Groq LPU (Qwen 3.8 / GPT-OSS):</i>\n\n`;

        await sendLongResponse(chatId, header + formattedAnswer + executedActionDesc, Math.round(elapsed), threadId);
    } else {
        await sendMsg(
            chatId,
            `⚠️ <b>[HỆ THỐNG AI ĐANG QUÁ TẢI]</b>\n──────────────────────\nAntigravity PC đang chạm ngưỡng Rate Limit và Groq LPU cũng bận.\nBro hãy chờ khoảng 10-15 phút để quota hồi phục nhé!`,
            threadId
        );
    }

    // 4. Dọn dẹp trạng thái về IDLE
    currentPhase = 'IDLE';
    promptStartTime = null;
    promptTextSaved = '';
    currentWorkingMsgId = null;
    tempMsgIds = [];

    // 5. Nếu còn hàng đợi, tiếp tục chạy prompt tiếp theo
    if (promptQueue.length > 0) {
        const nextItem = getNextPrompt();
        if (nextItem) {
            await sendMsg(
                chatId,
                `🚀 <b>[ĐANG THỰC THI PROMPT TIẾP THEO TỪ HÀNG ĐỢI]:</b>\n<blockquote><i>${escapeHtml(nextItem.preview)}</i></blockquote>`,
                nextItem.threadId || threadId
            );
            await executePromptImmediately(nextItem.chatId, nextItem.threadId || threadId, nextItem.text, nextItem.preview);
        }
    }
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

    // Kích hoạt Watchdog giám sát phản hồi PC
    startWatchdog(chatId, threadId, promptText);

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
        resetWatchdog();
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
        resetWatchdog();
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
        clearWatchdog();
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
    },
    onError: async (entry) => {
        const errText = ((entry && (entry.error || entry.content)) || '').toString().toLowerCase();
        if (errText.includes('quota') || errText.includes('rate limit') || errText.includes('exhausted') || errText.includes('429') || errText.includes('resource has been exhausted')) {
            console.warn('[Transcript Watcher] ⚠️ Phát hiện lỗi Rate Limit / Quota Exhausted từ Antigravity! Kích hoạt fallback tiếp nối ngay!');
            await triggerAutonomousCloudFallback('rate_limit_error');
        }
    }
});

// --- TELEGRAM RAW POLLING & STANDBY DISPATCHER ---

async function pollUpdates() {
    let pollOffset = 0;
    console.log('[Bridge Polling] Khởi động vòng lặp lắng nghe Telegram...');

    // Kiểm tra trạng thái Webhook hiện tại: Nếu Cloud đang giữ Webhook thì PC KHÔNG tự ý gỡ!
    // Thay vào đó, PC giữ chế độ Standby để Cloudflare Worker 24/7 đón nhận lệnh /pc và xác thực mã PIN.
    try {
        const whInfo = await tgApiRaw('getWebhookInfo');
        if (whInfo && whInfo.result && whInfo.result.url) {
            console.log('[Bridge Startup] Cloudflare Webhook dang hoat dong (' + whInfo.result.url + '). Chuyen PC vao che do Standby cho lenh /pc tu Telegram!');
            isCloudStandby = true;
        } else {
            console.log('[Bridge Startup] Chưa có Webhook, PC tiếp quản điều khiển trực tiếp!');
            isCloudStandby = false;
        }
    } catch (e) {
        console.warn('[Bridge Startup] Không kiểm tra được WebhookInfo:', e.message);
    }

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
                    await setCloudWebhook(false);
                    console.log('[Bridge Wakeup] ⚡ Đã nhận tín hiệu cưỡng chế kết nối lại từ PC! Tiếp quản Telegram ngay lập tức!');
                    await sendMsg(activeChatId, '🖥️ <b>[PC LOCAL BRIDGE - SẴN SÀNG]</b>\n──────────────────────\nPC đã thức tỉnh và tiếp quản kết nối Telegram thành công!', activeThreadId);
                } else {
                    try {
                        const whInfo = await tgApiRaw('getWebhookInfo');
                        if (whInfo && whInfo.result && !whInfo.result.url) {
                            isCloudStandby = false;
                            console.log('[Bridge Wakeup] ⚡ Cloudflare da nhuong quyen cho PC! Tiep quan Telegram & khoi chay Antigravity IDE...');
                            const proj = lobby.getProjectInfo(activeThreadId);
                            launchOrFocusAntigravity(proj.path);
                            await sendMsg(
                                activeChatId,
                                `🖥️ <b>[PC LOCAL BRIDGE - ĐÃ TIẾP QUẢN & MỞ DỰ ÁN]</b>\n──────────────────────\n📂 <b>Dự án:</b> <code>${proj.name}</code> (<code>${proj.path}</code>)\n🚀 <b>Antigravity:</b> ĐÃ TỰ ĐỘNG BẬT VÀ TRỎ VÀO WORKSPACE!\n✨ PC đã sẵn sàng phục vụ bro!`,
                                activeThreadId
                            );
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

                        // K. XỬ LÝ CÀI ĐẶT TRÌNH DUYỆT TỰ ĐỘNG
                        if (cbData.startsWith('inst_br:')) {
                            const parts = cbData.split(':');
                            const brName = parts[1] || 'chrome';
                            const drive = parts[2] || 'D';
                            await tgApiRaw('answerCallbackQuery', { callback_query_id: cb.id, text: `⏳ Đang cài ${brName} vào ổ ${drive}:...` });
                            await editMsg(
                                chatId,
                                cb.message.message_id,
                                `⏳ <b>[ĐANG TỰ ĐỘNG CÀI ĐẶT ${brName.toUpperCase()}]</b>\n──────────────────────\n📁 Nơi cài: <b>Ổ ${drive}: (D:\\Browsers\\${brName})</b>\n⚡ Hệ thống đang chạy trình cài đặt ngầm qua winget...\n<i>(Quá trình mất 30s - 1 phút, bot sẽ thông báo ngay khi hoàn tất!)</i>`,
                                'HTML',
                                { inline_keyboard: [] },
                                true
                            );

                            installBrowserAsync(brName, drive).then(async (res) => {
                                if (res.ok) {
                                    await sendMsg(
                                        chatId,
                                        `✅ <b>[CÀI ĐẶT ${brName.toUpperCase()} THÀNH CÔNG!]</b>\n──────────────────────\n🚀 Trình duyệt đã được cài vào <b>${drive}:\\Browsers\\${brName}</b> an toàn!\n👉 Giờ bro có thể gõ <code>mở ${brName}</code> hoặc <code>mở youtube</code> là mở ngay lập tức!\n📸 <i>Đang mở trình duyệt mới và chụp lại màn hình...</i>`,
                                        cbThreadId
                                    );
                                    openWebOrApp('https://www.google.com', brName);
                                    setTimeout(async () => {
                                        try {
                                            await sendScreenshot(botToken, chatId, cbThreadId, `📸 <b>[MÀN HÌNH SAU KHI CÀI ${brName.toUpperCase()}]</b>`);
                                        } catch (e) {}
                                    }, 3000);
                                } else {
                                    await sendMsg(
                                        chatId,
                                        `⚠️ <b>[CÀI ĐẶT ${brName.toUpperCase()} THẤT BẠI]</b>\nLỗi: <code>${escapeHtml(res.error || 'winget failed')}</code>\nBro có thể dùng lệnh <code>/cmd winget install ${brName}</code> để kiểm tra thêm!`,
                                        cbThreadId
                                    );
                                }
                            });
                            continue;
                        }

                        if (cbData === 'inst_cancel') {
                            await tgApiRaw('answerCallbackQuery', { callback_query_id: cb.id, text: 'Đã hủy cài đặt trình duyệt' });
                            await editMsg(chatId, cb.message.message_id, `❌ <i>Đã hủy cài đặt trình duyệt.</i>`, 'HTML', { inline_keyboard: [] }, true);
                            continue;
                        }
                        activeThreadId = cbThreadId;

                        const isAllowed = allowedList.includes(Number(chatId)) || allowedList.includes(Number(fromId));
                        if (!isAllowed) continue;

                        // XỬ LÝ TOÀN BỘ SỰ KIỆN NÚT BẤM SẢNH LOBBY QUA LIB/LOBBY.CJS
                        const lobbyHandled = await lobby.handleLobbyCallback(cb, {
                            sendMsg,
                            editMsg,
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
                            if (cbThreadId === null || lobby.isLobby(cbThreadId)) {
                                await editMsg(chatId, cb.message.message_id, lobby.getMainMenuText(), 'HTML', lobby.getMainMenuMarkup(), true);
                            } else {
                                const cancelText = `☁️ <b>[ĐÃ HỦY NHẬP MÃ ĐỒNG BỘ]</b>\n──────────────────────\nBro đã hủy bàn phím nhập mã. Hệ thống duy trì chế độ Vercel Cloud 24/7 bình thường.\n\n👉 Khi cần kết nối lại, gõ <code>/pc</code> hoặc <code>/ketnoi</code>.`;
                                await editMsg(chatId, cb.message.message_id, cancelText, 'HTML', { inline_keyboard: [] }, true);
                            }
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
                                const successMarkup = (cbThreadId === null || lobby.isLobby(cbThreadId)) ? { inline_keyboard: [[{ text: '🏛️ Trở về Menu Sảnh', callback_data: 'hub_refresh_menu' }]] } : { inline_keyboard: [] };
                                await editMsg(chatId, cb.message.message_id, successText, 'HTML', successMarkup, true);
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

                    // 🏛️ NẾU TIN NHẮN TẠI SẢNH LOBBY (threadId === null || lobby.isLobby(threadId)):
                    // 1. NGAY LẬP TỨC XÓA BẤT KỲ TIN NHẮN NÀO XUẤT HIỆN TẠI SẢNH (chữ, ảnh, sticker, voice, file...)
                    // 2. TUYỆT ĐỐI KHÔNG COI ĐÓ LÀ PROMPT ĐỂ THỰC HIỆN CODE!
                    if (threadId === null || lobby.isLobby(threadId)) {
                        if (msg.message_id) {
                            try {
                                await tgApiRaw('deleteMessage', { chat_id: chatId, message_id: msg.message_id });
                            } catch (e) {}
                        }
                        const lobbyText = (msg.text || msg.caption || '').trim();
                        await lobby.handleLobbyTextMessage(msg, lobbyText, {
                            sendMsg,
                            editMsg,
                            tgApiRaw,
                            forwardToAntigravity,
                            conversationId
                        });
                        continue;
                    }

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

                    // 🛑 LỆNH ƯU TIÊN CAO NHẤT: /CANCEL (CHỈ KHI LÀ LỆNH THUẦN TÚY, KHÔNG PHẢI PROMPT)
                    if (!isConversationalPrompt(userText) && /^(?:\/cancel|\/cancel_all|\/stop|\/kill|\/abort)$/i.test(userText.trim())) {
                        await handleEmergencyCancel(chatId, threadId, isEdit ? 'Edit message to /cancel' : userText.trim());
                        continue;
                    }

                    // 🔒 LỆNH KẾT THÚC QUYỀN QUẢN TRỊ REPO: /ketthucrepo
                    if (/^(?:\/ketthucrepo|\/endrepo|\/dongrepo)$/i.test(userText.trim())) {
                        if (threadId !== null && lobby.isRegisteredTopic(threadId)) {
                            lobby.revokeAdminState();
                            await lobby.updateControlBoard(
                                { tgApiRaw, editMsg },
                                chatId,
                                lobby.getMainMenuText(),
                                lobby.getMainMenuMarkup()
                            );
                            await sendMsg(
                                chatId,
                                `🔒 <b>[ĐÃ KẾT THÚC QUYỀN QUẢN TRỊ REPO]</b>\n──────────────────────\n✅ Đã khóa lại quyền hạn quản trị repo thành công!\n🏛️ Bảng điều khiển Sảnh Lobby đã trở về trạng thái chuẩn (đã ẩn dòng Quyền hạn).\n\n👉 Khi cần mở lại toàn quyền, bro hãy vào Sảnh dùng cách bạn bảo tôi nhé!`,
                                threadId,
                                'HTML'
                            );
                            forwardToAntigravity(conversationId, `[KẾT THÚC QUYỀN REPO]: Người dùng đã phát lệnh /ketthucrepo tại Topic #${threadId}. Quyền quản trị repo đã được thu hồi và khóa lại.`);
                        } else {
                            await sendMsg(
                                chatId,
                                `⚠️ <b>[LỆNH KHÔNG HỢP LỆ TẠI ĐÂY]</b>\n──────────────────────\nLệnh <code>/ketthucrepo</code> chỉ có hiệu lực khi gửi trong chính Topic dự án được sinh ra!`,
                                threadId,
                                'HTML'
                            );
                        }
                        continue;
                    }

                    // 🔒 LỆNH ĐÓNG TOPIC: /dongtopic (SẢNH TUYỆT ĐỐI KHÔNG ĐƯỢC ĐÓNG)
                    if (/^(?:\/dongtopic|\/closetopic|\/dong_topic)$/i.test(userText.trim())) {
                        if (threadId === null || lobby.isLobby(threadId)) {
                            await sendMsg(
                                chatId,
                                `⚠️ <b>[KHÔNG THỂ ĐÓNG SẢNH LOBBY]</b>\n──────────────────────\nSảnh Lobby là kênh điều khiển trung tâm, tuyệt đối không thể đóng!`,
                                threadId,
                                'HTML'
                            );
                        } else {
                            await sendMsg(
                                chatId,
                                `🔒 <b>[TOPIC ĐÃ ĐƯỢC ĐÓNG]</b>\n──────────────────────\nTopic #${threadId} này đã được đóng lại theo lệnh <code>/dongtopic</code>.\n👉 Bro có thể quay lại Sảnh Lobby bất cứ lúc nào!`,
                                threadId,
                                'HTML'
                            );
                            try {
                                await tgApiRaw('closeForumTopic', {
                                    chat_id: chatId,
                                    message_thread_id: threadId
                                });
                            } catch (e) {
                                console.error('[closeForumTopic Error]:', e.message);
                            }
                            forwardToAntigravity(conversationId, `[ĐÓNG TOPIC]: Người dùng đã phát lệnh /dongtopic đóng Topic #${threadId}.`);
                        }
                        continue;
                    }

                    // 🖥️ LỆNH KẾT NỐI / TIẾP QUẢN PC: /pc, /ketnoi, ket noi pc (CHỈ CHẠY KHI KHÔNG PHẢI PROMPT ĐÀM THOẠI)
                    if (!isConversationalPrompt(userText) && /^(?:\/ketnoi|\/ketnoilai|\/reconnect|\/pc|\/local|kết nối lại|kết nối pc|ket noi pc|connect pc)(?:\s+(\d{3,4}))?$/i.test(userText.trim())) {
                        const match = userText.trim().match(/^(?:\/ketnoi|\/ketnoilai|\/reconnect|\/pc|\/local|kết nối lại|kết nối pc|ket noi pc|connect pc)(?:\s+(\d{3,4}))?$/i);
                        const providedCode = match ? match[1] : null;

                        if (providedCode && lobby.verifyProjectPin(providedCode, threadId)) {
                            waitingForPairCode = false;
                            currentPhase = 'IDLE';
                            isCloudStandby = false;
                            stopTicker();
                            tempMsgIds = [];
                            promptMsgId = null;

                            const proj = lobby.getProjectInfo(providedCode || threadId);
                            launchOrFocusAntigravity(proj.path);
                            forwardToAntigravity(conversationId, `[LỆNH KẾT NỐI PC]: Người dùng đã nhập đúng mã PIN ${providedCode} và kết nối lại PC thành công từ Topic #${threadId || 1160}. Dự án ${proj.name} (${proj.path}) đã được nạp tự động!`);
                            await sendMsg(
                                chatId,
                                `🖥️ <b>[ĐÃ KẾT NỐI PC & MỞ DỰ ÁN THÀNH CÔNG!]</b>\n──────────────────────\n📂 <b>Dự án:</b> <code>${proj.name}</code> (<code>${proj.path}</code>)\n🚀 <b>Cửa sổ Antigravity:</b> ĐÃ TỰ ĐỘNG BẬT VÀ TRỎ VÀO DỰ ÁN!\n✨ Cầu nối PC đã sẵn sàng phục vụ bro!`,
                                threadId
                            );
                            continue;
                        }

                        // Chưa có mã PIN: BẮT BUỘC HỎI MÃ PIN DỰ ÁN THEO ĐÚNG YÊU CẦU CỦA BRO
                        waitingForPairCode = true;
                        const initialScreen = `📟 <b>[XÁC THỰC KẾT NỐI MÁY PC - QUINLOVERIN]</b>\n──────────────────────\n🔑 <b>Dự án:</b> Topic #${threadId || 1160}\n👉 Bro hãy nhập <b>Mã PIN (Mã cửa sổ repo)</b> của dự án để đánh thức PC:`;
                        await sendMsg(chatId, initialScreen, threadId, 'HTML');
                        continue;
                    }

                    // 🧠 BỘ PHÂN LOẠI Ý ĐỊNH BẰNG AI (CHỈ KHI KHÔNG PHẢI PROMPT ĐÀM THOẠI)
                    if (!isConversationalPrompt(userText)) {
                        const intent = await classifyUserIntent(userText);

                        if (intent.type === 'action') {
                            // 1. Mở Antigravity
                            if (intent.action === 'focus_antigravity') {
                                const launchResult = launchOrFocusAntigravity();
                                if (launchResult === 'NOT_FOUND') {
                                    await sendMsg(chatId, `⚠️ <b>[CHƯA CÀI ANTIGRAVITY TRÊN MÁY TÍNH NÀY]</b>\n──────────────────────\nℹ️ Gõ <code>/download_antigravity</code> để tải chính thức!`, threadId);
                                } else {
                                    const actionDesc = launchResult === 'LAUNCHED'
                                        ? 'Đã khởi chạy ứng dụng Antigravity IDE mới trên PC!'
                                        : launchResult === 'FOCUSED'
                                        ? 'Đã khôi phục (restore) và đưa cửa sổ Antigravity lên phía trước màn hình!'
                                        : 'Đã kích hoạt và đưa cửa sổ Antigravity lên phía trước màn hình!';
                                    await sendMsg(chatId, `🖥️ <b>[ĐÃ MỞ CỬA SỔ ANTIGRAVITY TRÊN PC]</b>\n──────────────────────\n✅ <b>${actionDesc}</b>\n⚡ Cầu nối IPC đã đồng bộ hóa 100% với Antigravity PC.`, threadId);
                                    if (intent.screenshot) {
                                        setTimeout(async () => {
                                            try {
                                                await sendScreenshot(botToken, chatId, threadId, `📸 <b>[ẢNH CHỤP CỬA SỔ ANTIGRAVITY TRÊN PC]</b>\n──────────────────────\n✅ ${actionDesc}`);
                                            } catch (e) {}
                                        }, 2500);
                                    }
                                }
                                continue;
                            }

                            // 2. Chụp màn hình
                            if (intent.action === 'screenshot') {
                                await sendMsg(chatId, `📸 <b>[ĐANG CHỤP MÀN HÌNH MÁY TÍNH...]</b>\n<i>Đang chụp ảnh thực tế từ màn hình PC của bro...</i>`, threadId);
                                const winSummary = getActiveWindowsSummary();
                                const caption = `🖥️ <b>[ẢNH CHỤP MÀN HÌNH MÁY TÍNH THỰC TẾ]</b>\n──────────────────────\n⏱️ <b>Thời gian:</b> ${new Date().toLocaleTimeString('vi-VN')}\n\n📋 <b>Các cửa sổ đang mở:</b>\n${winSummary}`;
                                await sendScreenshot(botToken, chatId, threadId, caption);
                                continue;
                            }

                            // 3. Quay video màn hình
                            if (intent.action === 'record') {
                                const sec = Math.min(10, Math.max(2, intent.record_sec || 4));
                                await sendMsg(chatId, `🎥 <b>[ĐANG QUAY VIDEO MÀN HÌNH PC ${sec}s...]</b>\n<i>Đang chụp chuỗi khung hình thực tế & ghép thành video MP4 H.264...</i>`, threadId);
                                const winSummary = getActiveWindowsSummary();
                                const caption = `🎥 <b>[VIDEO QUAY MÀN HÌNH MÁY TÍNH THỰC TẾ]</b>\n──────────────────────\n⏱️ <b>Thời lượng:</b> ${sec} giây\n🕒 <b>Thời gian:</b> ${new Date().toLocaleTimeString('vi-VN')}\n📋 <b>Cửa sổ:</b> ${winSummary}`;
                                await sendScreenVideo(botToken, chatId, threadId, caption, sec);
                                continue;
                            }

                            // 4. Cài đặt trình duyệt
                            if (intent.action === 'install_browser') {
                                const br = (intent.target || 'chrome').toLowerCase();
                                const drive = (intent.drive || 'D').toUpperCase();
                                await sendMsg(chatId, `⏳ <b>[BẮT ĐẦU CÀI ĐẶT ${br.toUpperCase()}]</b>\n──────────────────────\n📁 Nơi cài: <b>Ổ ${drive}: (D:\\Browsers\\${br})</b>\n⚡ Đang thực thi cài đặt ngầm qua winget...`, threadId);
                                installBrowserAsync(br, drive).then(async (res) => {
                                    if (res.ok) {
                                        await sendMsg(chatId, `✅ <b>[CÀI ĐẶT ${br.toUpperCase()} THÀNH CÔNG!]</b>\n🚀 Đã cài vào <b>${drive}:\\Browsers\\${br}</b> an toàn!`, threadId);
                                        openWebOrApp('https://www.google.com', br);
                                    } else {
                                        await sendMsg(chatId, `⚠️ <b>[CÀI ĐẶT ${br.toUpperCase()} THẤT BẠI]</b>\nLỗi: <code>${escapeHtml(res.error || 'winget error')}</code>`, threadId);
                                    }
                                });
                                continue;
                            }

                            // 5. Mở Web / Ứng dụng
                            if (intent.action === 'open_web') {
                                const rawTarget = intent.target || 'google';
                                const browser = intent.browser || 'default';
                                const profile = intent.profile || null;

                                const brInstalled = checkInstalledBrowsers();
                                if (browser !== 'default' && !brInstalled[browser]) {
                                    await sendMsg(chatId, `⚠️ <b>[CHƯA CÓ TRÌNH DUYỆT ${browser.toUpperCase()} TRÊN MÁY]</b>\n──────────────────────\nℹ️ Chưa cài đặt trình duyệt <b>${browser}</b>.\n\n👉 <b>Bro có muốn tự động cài không?</b>`, threadId, 'HTML', getBrowserInstallMarkup(browser));
                                    continue;
                                }

                                const result = openWebOrApp(rawTarget, browser, profile);
                                await sendMsg(chatId, `🌐 <b>[ĐÃ MỞ YÊU CẦU TRÊN MÁY TÍNH]</b>\n──────────────────────\n✅ ${result.desc}`, threadId);

                                if (intent.record) {
                                    const sec = Math.min(10, Math.max(2, intent.record_sec || 4));
                                    setTimeout(async () => {
                                        try {
                                            await sendScreenVideo(botToken, chatId, threadId, `🎥 <b>[VIDEO QUAY MÀN HÌNH SAU KHI MỞ]</b>\n──────────────────────\n👉 Đã mở: <b>${rawTarget}</b>`, sec);
                                        } catch (e) {}
                                    }, 3500);
                                } else if (intent.screenshot) {
                                    setTimeout(async () => {
                                        try {
                                            await sendScreenshot(botToken, chatId, threadId, `📸 <b>[KẾT QUẢ MÀN HÌNH SAU KHI MỞ]</b>\n──────────────────────\n👉 Đã mở: <b>${rawTarget}</b>`);
                                        } catch (e) {}
                                    }, 3500);
                                }
                                continue;
                            }
                            // 6. Tắt / Đóng ứng dụng, phần mềm, tab hoặc Antigravity
                            if (intent.action === 'close_app') {
                                const rawTarget = intent.target || 'antigravity';
                                const isAntigravity = /^(?:antigravity|agy|ide)$/i.test(rawTarget.trim()) ||
                                    normalizeStr(rawTarget) === 'antigravity';

                                const res = closeAppOrProcess(rawTarget);
                                if (res.ok) {
                                    if (isAntigravity) {
                                        await sendMsg(
                                            chatId,
                                            `🛑 <b>[ĐÃ ĐÓNG ANTIGRAVITY & BÀN GIAO CHO CLOUD 24/7]</b>\n──────────────────────\n✅ <b>Đã tắt ứng dụng Antigravity IDE trên PC an toàn!</b>\n⚡ Đã giải phóng hoàn toàn tài nguyên CPU & RAM trên PC.\n☁️ <b>Quyền điều hành AI đã bàn giao cho Cloudflare Worker 24/7!</b>\n\n💡 <i>Bro có thể tiếp tục chat/code trên Cloud. Khi cần mở lại Antigravity PC, chỉ cần gõ <code>/pc</code> hoặc <code>bật antigravity</code> nhé!</i>`,
                                            threadId
                                        );
                                        await setCloudWebhook(true);
                                        isCloudStandby = true;
                                        continue;
                                    } else {
                                        await sendMsg(
                                            chatId,
                                            `🛑 <b>[ĐÃ ĐÓNG TIẾN TRÌNH / CỬA SỔ TRÊN PC]</b>\n──────────────────────\n✅ <b>${res.desc}</b>\n⚡ Tiến trình đã được giải phóng khỏi máy tính.`,
                                            threadId
                                        );
                                    }
                                } else {
                                    await sendMsg(
                                        chatId,
                                        `ℹ️ <b>[KHÔNG TÌM THẤY TIẾN TRÌNH ĐỂ ĐÓNG]</b>\n──────────────────────\n${res.desc}`,
                                        threadId
                                    );
                                }
                                continue;
                            }
                    }
                            // 7. Tắt nguồn máy tính PC (Remote Shutdown)
                            if (intent.action === 'shutdown_pc') {
                                await sendMsg(
                                    chatId,
                                    `🔌 <b>[ĐÃ TIẾP NHẬN LỆNH TẮT NGUỒN PC]</b>\n──────────────────────\n✅ <b>Đã bàn giao quyền trực chiến 100% cho Cloudflare Worker 24/7!</b>\n⚡ Máy tính PC sẽ tự động ngắt nguồn hoàn toàn (Shut down) trong 5 giây.\n\n💤 <i>Chúc bro nghỉ ngơi! Khi nào bro mở lại máy tính, chỉ cần vào Telegram gõ <code>/pc</code> và nhập mã PIN để mở lại Antigravity nhé!</i>`,
                                    threadId
                                );

                                // Chuyển giao ngay Webhook cho Cloudflare Worker 24/7
                                await setCloudWebhook(true);
                                isCloudStandby = true;

                                // Thực thi lệnh tắt máy Windows
                                setTimeout(() => {
                                    try {
                                        const cp = require('child_process');
                                        cp.exec('shutdown.exe /s /t 5 /c "QuinloveRin Remote Shutdown from Telegram"');
                                    } catch (e) {}
                                }, 1500);
                                continue;
                            }
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
                            const proj = lobby.getProjectInfo(code || threadId);
                            launchOrFocusAntigravity(proj.path);
                            forwardToAntigravity(conversationId, `[LỆNH KẾT NỐI PC]: Người dùng đã nhập đúng mã PIN ${code} từ Telegram. Đã mở và nạp dự án ${proj.name} (${proj.path}) vào Antigravity IDE.`);
                            await sendMsg(
                                chatId,
                                `🖥️ <b>[ĐÃ KẾT NỐI PC & MỞ DỰ ÁN THÀNH CÔNG!]</b>\n──────────────────────\n📂 <b>Dự án:</b> <code>${proj.name}</code> (<code>${proj.path}</code>)\n🚀 <b>Cửa sổ Antigravity:</b> ĐÃ TỰ ĐỘNG BẬT VÀ TRỎ VÀO DỰ ÁN!\n✨ Cầu nối PC đã sẵn sàng phục vụ bro!`,
                                threadId
                            );
                            continue;
                        } else {
                            const expectedPin = lobby.getProjectPin(threadId);
                            await sendMsg(
                                chatId,
                                `❌ <b>[SAI MÃ PIN DỰ ÁN]</b>\nMã <code>${code}</code> không chính xác! Vui lòng nhập lại mã 4 số (Mã dự án này: <code>${expectedPin}</code>):`,
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

                    // 🔒 BẢO VỆ REPO: Nghiêm cấm tạo cửa sổ code / bypass hoặc chỉnh sửa repo Mthu Code Mobile nếu chưa có mật khẩu quản trị
                    const isProtectedRepoAction = /(?:sửa|edit|thay đổi|update|chỉnh sửa|commit|push|pull|tạo file|xóa file|ghi đè)\s+(?:code|file|repo|mã nguồn)?\s*(?:mthu|fast_bridge|lobby|worker|config\.json|của bot|của hệ thống|máy chủ)/i.test(userText);
                    if (isProtectedRepoAction && !lobby.isSuperAdmin()) {
                        await sendMsg(
                            chatId,
                            `👑 <b>[YÊU CẦU MẬT KHẨU QUẢN TRỊ]</b>\n──────────────────────\n⚠️ <b>Nghiêm cấm hành vi tạo cửa sổ để code / bypass hoặc chỉnh sửa repo Mthu Code Mobile khi chưa có quyền quản trị!</b>\n\n👉 Để mở khóa toàn quyền, bro hãy vào Sảnh dùng cách bạn bảo tôi nhé!`,
                            threadId,
                            'HTML'
                        );
                        continue;
                    }

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

// --- TỰ ĐỘNG BÀN GIAO CHO CLOUDFLARE WORKER 24/7 KHI TẮT MÁY / TẮT TIẾN TRÌNH ---
let isShuttingDown = false;
async function restoreCloudOnExit(reason) {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log(`[Bridge Exit] Tiến trình kết thúc (${reason}), tự động chuyển giao cho Cloudflare Worker 24/7...`);
    try {
        await setCloudWebhook(true);
        console.log('[Bridge Exit] Đã bàn giao Cloudflare Worker 24/7 thành công!');
    } catch (e) {
        console.error('[Bridge Exit Error]:', e.message);
    }
}

process.on('SIGINT', async () => { await restoreCloudOnExit('SIGINT'); process.exit(0); });
process.on('SIGTERM', async () => { await restoreCloudOnExit('SIGTERM'); process.exit(0); });
process.on('beforeExit', async () => { await restoreCloudOnExit('beforeExit'); });

// Khởi động: Gỡ Webhook để PC tiếp quản trực tiếp
// PC giu che do standby kiem tra webhook

pollUpdates();
