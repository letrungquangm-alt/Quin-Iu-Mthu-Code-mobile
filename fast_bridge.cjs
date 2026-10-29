/**
 * QuinloveRin Code - Fast Telegram Bridge v2.1 (.cjs)
 * - CHUỖI TIẾN TRÌNH TRÀN DÀI (Stream Log): Không vừa làm vừa xóa.
 * - HIỆN ĐỦ: Đọc prompt -> Đã có cách -> Đang chạy lệnh -> Hoàn tất lệnh.
 * - KHI LÀM XONG VIỆC & CHỜ TRẢ LỜI:
 *   + Bật trạng thái 'typing...' trên thanh tiêu đề Telegram.
 *   + Báo: "⏳ [ĐÃ XONG YÊU CẦU CỦA BẠN, CHỜ CHÚT TÔI ĐANG GỬI PHẢN HỒI YÊU CẦU CỦA BẠN (Xs)...]"
 * - KHI PHÁT ĐÁP ÁN:
 *   + Tiêu đề: "🤖 [MÁY TÍNH ĐÃ PHẢN HỒI XONG TRONG Xs]:"
 *   + Phát nội dung hoàn chỉnh (VĨNH VIỄN, KHÔNG BAO GIỜ XÓA).
 * - ĐẾM NGƯỢC 10S TỰ HỦY:
 *   + Báo "🧹 [ĐANG DỌN DẸP TIẾN TRÌNH TRONG VÒNG 10 GIÂY...]" và đếm ngược 10s.
 *   + Xóa sạch toàn bộ dãy tin nhắn tạm thời ở trên.
 *   + Đổi thành "✨ [ĐÃ DỌN DẸP THÀNH CÔNG!]".
 *   + Sau 2 giây tự xóa chính nó!
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const rootDir = __dirname;
const configPath = path.join(rootDir, 'config.json');

if (!fs.existsSync(configPath)) {
    console.error('[Bridge Error] Không tìm thấy config.json tại:', configPath);
    process.exit(1);
}

const config = JSON.parse(fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/, ''));
const mainBotToken = config.BOT_TOKEN;
const extraBotTokens = Array.isArray(config.EXTRA_BOT_TOKENS) ? config.EXTRA_BOT_TOKENS : [];
const botPool = [mainBotToken, ...extraBotTokens].filter(t => t && t.length > 20);

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

console.log('========================================================');
console.log(' Fast Telegram Bridge v2.1 (Stream Flow, Typing & 10s Countdown)');
console.log(' Bot Pool Size:', botPool.length, 'bots');
console.log(' Conversation ID:', conversationId);
console.log(' Transcript:', transcriptPath);
console.log('========================================================');

// --- TELEGRAM API HELPERS ---

let currentBotIndex = 0;
function getActiveBotToken() {
    return botPool[currentBotIndex % botPool.length];
}

async function tgApi(method, data) {
    const token = getActiveBotToken();
    try {
        const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        const json = await res.json();
        if (!json.ok) {
            if (json.error_code === 429 && json.parameters && json.parameters.retry_after) {
                console.warn(`[429 Rate Limit Bot ${currentBotIndex}] Đổi bot trong pool...`);
                currentBotIndex = (currentBotIndex + 1) % botPool.length;
                return tgApi(method, data);
            }
            if (json.description && !json.description.includes('message to delete not found')) {
                console.warn(`[API ${method} Fail]:`, json.description);
            }
        }
        return json;
    } catch (e) {
        console.error(`[API ${method} Ex]:`, e.message);
        return { ok: false, error: e.message };
    }
}

async function sendTyping(chatId, threadId = null) {
    const payload = { chat_id: chatId, action: 'typing' };
    if (threadId) payload.message_thread_id = threadId;
    await tgApi('sendChatAction', payload);
}

async function sendMsg(chatId, text, threadId = null, parseMode = 'HTML') {
    const payload = {
        chat_id: chatId,
        text: text,
        disable_web_page_preview: true
    };
    if (parseMode) payload.parse_mode = parseMode;
    if (threadId) payload.message_thread_id = threadId;

    const res = await tgApi('sendMessage', payload);
    if (!res.ok && parseMode) {
        delete payload.parse_mode;
        payload.text = text.replace(/<[^>]+>/g, '');
        const fallbackRes = await tgApi('sendMessage', payload);
        return fallbackRes.result ? fallbackRes.result.message_id : null;
    }
    return res.result ? res.result.message_id : null;
}

async function editMsg(chatId, messageId, text, parseMode = 'HTML') {
    if (!messageId) return;
    const payload = {
        chat_id: chatId,
        message_id: messageId,
        text: text,
        disable_web_page_preview: true
    };
    if (parseMode) payload.parse_mode = parseMode;
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

    codeBlocks.forEach((b, i) => { text = text.replace(`___CODE_BLOCK_${i}___`, b); });
    inlineCodes.forEach((b, i) => { text = text.replace(`___INLINE_${i}___`, b); });
    return text;
}

async function sendLongResponse(chatId, answerText, totalSec, threadId = null) {
    if (!answerText) return;

    const maxLen = 3500;
    const headerTitle = `🤖 <b>[MÁY TÍNH ĐÃ PHẢN HỒI XONG TRONG ${totalSec}s]:</b>\n\n`;

    if (answerText.length <= maxLen) {
        const html = mdToTgHtml(answerText);
        await sendMsg(chatId, `${headerTitle}${html}`, threadId);
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
        await sendMsg(chatId, `${header}${html}`, threadId);
        if (i < chunks.length - 1) {
            await new Promise(r => setTimeout(r, 200));
        }
    }
}

// --- CƠ CHẾ ĐẾM NGƯỢC 10S DỌN DẸP TIẾN TRÌNH ---

async function runCountdownCleanup(chatId, threadId, msgIdsToDelete) {
    if (!msgIdsToDelete || msgIdsToDelete.length === 0) return;
    try {
        console.log(`[Countdown Cleanup] Bắt đầu đếm ngược 10s để dọn ${msgIdsToDelete.length} tin nhắn...`);
        const countdownMsgId = await sendMsg(
            chatId,
            `🧹 <b>[ĐANG DỌN DẸP TIẾN TRÌNH TRONG VÒNG 10 GIÂY...]</b>`,
            threadId
        );

        const countdownSteps = [8, 6, 4, 2, 1];
        for (const s of countdownSteps) {
            await new Promise(r => setTimeout(r, 2000));
            if (countdownMsgId) {
                await editMsg(
                    chatId,
                    countdownMsgId,
                    `🧹 <b>[ĐANG DỌN DẸP TIẾN TRÌNH TRONG VÒNG ${s} GIÂY...]</b>`
                );
            }
        }

        console.log('[Countdown Cleanup] Xóa toàn bộ tiến trình tạm...');
        await deleteMsgs(chatId, msgIdsToDelete);

        if (countdownMsgId) {
            await editMsg(chatId, countdownMsgId, `✨ <b>[ĐÃ DỌN DẸP THÀNH CÔNG!]</b>`);

            setTimeout(async () => {
                await tgApi('deleteMessage', { chat_id: chatId, message_id: countdownMsgId });
                console.log('[Countdown Cleanup] Hoàn tất, khung chat sạch bong!');
            }, 2000);
        }
    } catch (e) {
        console.error('[Countdown Cleanup Error]:', e.message);
    }
}

// --- STREAM FLOW STATE MANAGEMENT ---

let activeChatId = allowedChatId || -1004457846636;
let activeThreadId = null;

let promptMsgId = null;
let promptStartTime = null;
let promptTextSaved = '';

let thinkingSent = false;
let currentWorkingMsgId = null;
let currentToolStartTime = null;
let currentToolSummary = '';

let finalPrepMsgId = null;
let isPreparingResponse = false;
let typingInterval = null;

let tempMsgIds = [];

function forwardToAntigravity(text) {
    if (fs.existsSync(langServer)) {
        try {
            const child = spawn(langServer, ['agentapi', 'send-message', conversationId, `[Điện thoại gửi]: ${text}`], {
                detached: true,
                stdio: 'ignore',
                windowsHide: true
            });
            child.unref();
            console.log('[Bridge -> PC] Đã chuyển prompt tới Antigravity:', text.substring(0, 60));
        } catch (e) {
            console.error('[Bridge Error] Lỗi chuyển prompt tới Antigravity:', e.message);
        }
    }
}

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
    try {
        stat = fs.statSync(transcriptPath);
    } catch (e) { return; }

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

            // Giai đoạn: AI bắt đầu suy nghĩ / đã có hướng
            if (entry.thinking && !entry.content && (!entry.tool_calls || entry.tool_calls.length === 0)) {
                if (!thinkingSent) {
                    thinkingSent = true;
                    const elapsed = promptStartTime ? Math.max(1, Math.round((Date.now() - promptStartTime) / 1000)) : 1;
                    const safe = escapeHtml(promptTextSaved);
                    const tid = await sendMsg(
                        activeChatId,
                        `💡 <b>[ĐÃ CÓ CÁCH, ĐỢI MÌNH CHÚT - ${elapsed}s]</b>\n<blockquote><i>${safe}</i></blockquote>`,
                        activeThreadId
                    );
                    if (tid) tempMsgIds.push(tid);
                }
            }

            // Giai đoạn: Thực thi lệnh / công cụ (Tool Call)
            if (entry.tool_calls && entry.tool_calls.length > 0) {
                currentToolStartTime = Date.now();
                const tc = entry.tool_calls[0];
                const toolName = tc.name;
                currentToolSummary = tc.args && tc.args.toolSummary ? tc.args.toolSummary.replace(/^"|"$/g, '') : `Thực thi ${toolName}`;

                const safeSummary = escapeHtml(currentToolSummary);

                currentWorkingMsgId = await sendMsg(
                    activeChatId,
                    `⚡ <b>[MÁY TÍNH ĐANG THỰC HIỆN]</b>\n▶ <code>${safeSummary}</code>`,
                    activeThreadId
                );
                if (currentWorkingMsgId) tempMsgIds.push(currentWorkingMsgId);
            }

            // Giai đoạn: Kết quả lệnh hoàn tất (Tool Output)
            if (entry.type === 'GENERIC' && entry.content) {
                const wSec = currentToolStartTime ? Math.max(1, Math.round((Date.now() - currentToolStartTime) / 1000)) : 1;
                const safeTask = escapeHtml(currentToolSummary || 'Tác vụ');

                if (currentWorkingMsgId) {
                    await editMsg(
                        activeChatId,
                        currentWorkingMsgId,
                        `✅ <b>[ĐÃ HOÀN TẤT TRONG ${wSec}s]</b>: <code>${safeTask}</code>`
                    );
                    currentWorkingMsgId = null;
                }

                // Khi xong tác vụ: Bật trạng thái chuẩn bị phát câu trả lời
                if (!isPreparingResponse) {
                    isPreparingResponse = true;
                    finalPrepMsgId = await sendMsg(
                        activeChatId,
                        `⏳ <b>[ĐÃ XONG YÊU CẦU CỦA BẠN, CHỜ CHÚT TÔI ĐANG GỬI PHẢN HỒI...]</b>`,
                        activeThreadId
                    );
                    if (finalPrepMsgId) tempMsgIds.push(finalPrepMsgId);

                    // Bật typing liên tục
                    sendTyping(activeChatId, activeThreadId);
                    if (!typingInterval) {
                        typingInterval = setInterval(() => {
                            sendTyping(activeChatId, activeThreadId);
                        }, 3000);
                    }
                }
            }

            // Giai đoạn: Phản hồi hoàn chỉnh -> PHÁT CÂU TRẢ LỜI & KÍCH HOẠT ĐẾM NGƯỢC 10S XÓA SẠCH
            if (entry.type === 'PLANNER_RESPONSE' && entry.content && (!entry.tool_calls || entry.tool_calls.length === 0)) {
                const answer = entry.content.toString().trim();
                if (!answer) continue;

                if (typingInterval) {
                    clearInterval(typingInterval);
                    typingInterval = null;
                }
                isPreparingResponse = false;

                const totalSec = promptStartTime ? Math.max(1, Math.round((Date.now() - promptStartTime) / 1000)) : 1;

                // 1. Gửi câu trả lời hoàn chỉnh của Máy tính
                console.log('[Bridge] Gửi câu trả lời hoàn chỉnh tới Telegram...');
                await sendLongResponse(activeChatId, answer, totalSec, activeThreadId);

                // Gom tất cả các tin nhắn tiến trình cần dọn dẹp
                const toClean = [...tempMsgIds];
                tempMsgIds = [];
                promptStartTime = null;
                promptTextSaved = '';
                thinkingSent = false;
                currentWorkingMsgId = null;
                finalPrepMsgId = null;

                // 2. Kích hoạt đếm ngược 10 giây để dọn dẹp
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
    console.log('[Bridge Polling] Bắt đầu lắng nghe tin nhắn Telegram...');
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

                    if (!update.message) continue;
                    const msg = update.message;
                    const chatId = msg.chat.id;
                    const threadId = msg.message_thread_id || null;
                    const fromId = msg.from ? msg.from.id : 0;

                    const isAllowed = allowedList.includes(Number(chatId)) || allowedList.includes(Number(fromId));
                    if (!isAllowed) {
                        console.log(`[Bridge Security] Chặn tin nhắn từ chatId=${chatId}, fromId=${fromId}`);
                        continue;
                    }

                    activeChatId = chatId;
                    activeThreadId = threadId;

                    let userText = '';
                    let isPhoto = false;

                    if (msg.photo && msg.photo.length > 0) {
                        isPhoto = true;
                        userText = msg.caption ? msg.caption.trim() : 'Phân tích hình ảnh này';
                    } else if (msg.text) {
                        userText = msg.text.trim();
                    }

                    if (!userText && !isPhoto) continue;

                    console.log(`[Telegram Nhận Tin] (${chatId}, thread=${threadId}): ${userText.substring(0, 50)}`);

                    promptStartTime = Date.now();
                    promptTextSaved = userText;
                    thinkingSent = false;
                    isPreparingResponse = false;

                    const previewClean = userText.replace(/[<>]/g, '');
                    const previewSafe = escapeHtml(previewClean.length > 50 ? previewClean.substring(0, 50) + '...' : previewClean);
                    const promptLabel = isPhoto
                        ? '📷 <b>[ĐÃ NHẬN ẢNH VÀ ĐANG PHÂN TÍCH, VUI LÒNG ĐỢI (1s)...]</b>'
                        : '📖 <b>[ĐÃ ĐỌC PROMPT VÀ ĐANG XỬ LÝ YÊU CẦU BẠN, VUI LÒNG ĐỢI (1s)...]</b>';

                    promptMsgId = await sendMsg(chatId, `${promptLabel}\n<blockquote><i>${previewSafe}</i></blockquote>`, threadId);
                    if (promptMsgId) tempMsgIds.push(promptMsgId);

                    forwardToAntigravity(userText);
                }
            }
        } catch (e) {
            console.error('[Polling Exception]:', e.message);
            await new Promise(r => setTimeout(r, 2000));
        }
    }
}

pollUpdates();
