const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const configPath = path.join(rootDir, 'config.json');

let botToken = '';
let allowedChatId = '';

if (fs.existsSync(configPath)) {
    try {
        const raw = fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/, '');
        const cfg = JSON.parse(raw);
        botToken = cfg.BOT_TOKEN || '';
        allowedChatId = cfg.ALLOWED_CHAT_ID ? cfg.ALLOWED_CHAT_ID.toString() : '';
    } catch (e) {
        console.error('[Config Error]:', e.message);
    }
}

if (!botToken) {
    botToken = process.env.BOT_TOKEN || '9295576468:AAEDkx2sZBzfxGSnOMFprvhwHIOQ4pD_xmQ';
}

const cancelKeyboard = {
    inline_keyboard: [
        [{ text: '🛑 Dừng tác vụ (Cancel)', callback_data: 'cancel_task' }]
    ]
};

// --- RATE LIMIT DEFENDER ---
let rateLimitedUntil = 0;

function isRateLimited() {
    return Date.now() < rateLimitedUntil;
}

// --- DIRECT RAW CALL (For getUpdates, getWebhookInfo, setWebhook, deleteWebhook) ---
async function tgApiRaw(method, data = {}) {
    try {
        const res = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        return await res.json();
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

// --- QUEUED OUTGOING CALL (For sendMessage, editMessageText, deleteMessage) ---
let apiQueue = Promise.resolve();

function tgApi(method, data) {
    const nextCall = () => tgApiDirect(method, data);
    apiQueue = apiQueue.then(nextCall, nextCall);
    return apiQueue;
}

async function tgApiDirect(method, data) {
    // Nếu đang trong thời gian 429 penalty, bỏ qua các lệnh phụ (edit ticker, chatAction)
    if (isRateLimited()) {
        if (method === 'sendChatAction' || method === 'editMessageText') {
            return { ok: false, skippedRateLimit: true };
        }
    }

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
                rateLimitedUntil = Date.now() + (waitSec + 2) * 1000;
                console.warn(`[429 Rate Limit - ${method}] Bị giới hạn ${waitSec}s. Tự động tạm hoãn các request phụ...`);
                
                // Nếu là bong bóng tool call hoặc edit phụ, bỏ qua ngay để không làm nghẽn tin nhắn phản hồi chính!
                const isMinor = method === 'editMessageText' || method === 'sendChatAction' || 
                                (data && data.text && (data.text.includes('Đang thực thi') || data.text.includes('ĐÃ HOÀN TẤT') || data.text.includes('Đang suy nghĩ')));
                if (isMinor) {
                    return { ok: false, skippedRateLimit: true };
                }

                await new Promise(r => setTimeout(r, (waitSec + 1) * 1000));
                return tgApiDirect(method, data);
            }
            if (json.description &&
                !json.description.includes('message to delete not found') &&
                !json.description.includes('message to edit not found') &&
                !json.description.includes('message is not modified')) {
                console.warn(`[API ${method} Fail]:`, json.description);
            }
        }
        await new Promise(r => setTimeout(r, 80)); // Giãn cách 80ms an toàn
        return json;
    } catch (e) {
        console.error(`[API ${method} Ex]:`, e.message);
        return { ok: false, error: e.message };
    }
}

async function sendMsg(chatId, text, threadId = null, parseMode = 'HTML', replyMarkup = null) {
    const payload = {
        chat_id: chatId,
        text: text,
        disable_web_page_preview: true
    };
    if (threadId && threadId !== 'general' && Number(threadId) > 0) {
        payload.message_thread_id = Number(threadId);
    }
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

const lastEditTimeMap = {};

async function editMsg(chatId, messageId, text, parseMode = 'HTML', replyMarkup = null, force = false) {
    if (!messageId) return { ok: false, notFound: true };

    const now = Date.now();
    const lastTime = lastEditTimeMap[messageId] || 0;
    // Giãn cách ít nhất 2200ms giữa các lần edit cùng 1 tin nhắn để tránh 429
    if (!force && (now - lastTime < 2200 || isRateLimited())) {
        return { ok: true, skipped: true };
    }
    lastEditTimeMap[messageId] = now;

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
    if (!res.ok) {
        if (res.description && (
            res.description.includes('message to edit not found') ||
            res.description.includes('chat not found') ||
            res.description.includes('message can\'t be edited')
        )) {
            return { ok: false, notFound: true, description: res.description };
        }
        if (parseMode) {
            delete payload.parse_mode;
            payload.text = text.replace(/<[^>]+>/g, '');
            const fallbackRes = await tgApi('editMessageText', payload);
            return fallbackRes;
        }
    }
    return res;
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
                await new Promise(r => setTimeout(r, 50));
            }
        }
    }
}

async function downloadTelegramPhoto(fileId, savePath) {
    try {
        const fileRes = await tgApiRaw('getFile', { file_id: fileId });
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

let lastTypingTime = 0;
async function sendTyping(chatId, threadId = 1160) {
    const now = Date.now();
    // Giãn cách ít nhất 7000ms cho sendChatAction
    if (now - lastTypingTime < 7000 || isRateLimited()) return;
    lastTypingTime = now;
    const payload = { chat_id: chatId, action: 'typing' };
    if (threadId) payload.message_thread_id = threadId;
    await tgApi('sendChatAction', payload);
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
    text = text.replace(/(?<!\w)__([^_\r\n]+)__(?!\w)/g, '<u>$1</u>');
    text = text.replace(/~~([^~\r\n]+)~~/g, '<s>$1</s>');

    for (let i = 0; i < inlineCodes.length; i++) {
        text = text.replace(`___INLINE_${i}___`, inlineCodes[i]);
    }
    for (let i = 0; i < codeBlocks.length; i++) {
        text = text.replace(`___CODE_BLOCK_${i}___`, codeBlocks[i]);
    }
    return text;
}

// --- STRICT SINGLE CANCEL BUTTON CONTROLLER ---
let activeCancelMsgId = null;
const bubbleTextMap = {};

function recordBubbleText(msgId, text) {
    if (msgId && text) {
        bubbleTextMap[msgId] = text;
    }
}

async function moveCancelButtonTo(chatId, newMsgId, newText) {
    if (activeCancelMsgId && activeCancelMsgId !== newMsgId) {
        const prevText = bubbleTextMap[activeCancelMsgId];
        if (prevText) {
            await editMsg(chatId, activeCancelMsgId, prevText, 'HTML', { inline_keyboard: [] }, true);
        }
    }
    activeCancelMsgId = newMsgId;
    if (newMsgId && newText) {
        bubbleTextMap[newMsgId] = newText;
    }
}

async function removeCancelButtonFrom(chatId, msgId, newText = null) {
    if (!msgId) return;
    const textToUse = newText || bubbleTextMap[msgId];
    if (textToUse) {
        await editMsg(chatId, msgId, textToUse, 'HTML', { inline_keyboard: [] }, true);
    }
    if (activeCancelMsgId === msgId) {
        activeCancelMsgId = null;
    }
}

async function clearAllCancelButtons(chatId, extraMsgIds = []) {
    if (activeCancelMsgId) {
        await removeCancelButtonFrom(chatId, activeCancelMsgId);
        activeCancelMsgId = null;
    }
    if (Array.isArray(extraMsgIds)) {
        for (const mid of extraMsgIds) {
            if (mid && bubbleTextMap[mid]) {
                await editMsg(chatId, mid, bubbleTextMap[mid], 'HTML', { inline_keyboard: [] }, true);
            }
        }
    }
}

module.exports = {
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
    getActiveCancelMsgId: () => activeCancelMsgId,
    setActiveCancelMsgId: (id) => { activeCancelMsgId = id; }
};
