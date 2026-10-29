/**
 * QuinloveRin Code - Fast Telegram Bridge v1.1 (.cjs)
 * Tốc độ cao, không trễ, tự động dọn dẹp bóng tiến trình khi AI trả lời xong.
 * Hỗ trợ Supergroup, Forum Topics, tiếng Việt UTF-8 chuẩn.
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

console.log('========================================================');
console.log(' Fast Telegram Bridge v1.1 (.cjs) khởi động');
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
            console.warn(`[API ${method} Fail]:`, json.description);
        }
        return json;
    } catch (e) {
        console.error(`[API ${method} Ex]:`, e.message);
        return { ok: false, error: e.message };
    }
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
        // Fallback gửi plain text nếu Telegram không parse được HTML
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

    // Chia nhóm tối đa 80 IDs mỗi đợt theo chuẩn Telegram (tối đa 100)
    for (let i = 0; i < validIds.length; i += 80) {
        const batch = validIds.slice(i, i + 80);
        const res = await tgApi('deleteMessages', { chat_id: chatId, message_ids: batch });
        if (!res.ok) {
            for (const mid of batch) {
                await tgApi('deleteMessage', { chat_id: chatId, message_id: mid });
                await new Promise(r => setTimeout(r, 30));
            }
        }
    }
}

// Chuyển Markdown sang HTML an toàn cho Telegram
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

// Gửi câu trả lời dài an toàn (chia nhỏ nếu vượt quá 3800 ký tự)
async function sendLongResponse(chatId, answerText, threadId = null) {
    if (!answerText) return;

    const maxLen = 3500;
    if (answerText.length <= maxLen) {
        const html = mdToTgHtml(answerText);
        await sendMsg(chatId, `🤖 <b>[MÁY TÍNH PHẢN HỒI XONG]:</b>\n\n${html}`, threadId);
        return;
    }

    const paragraphs = answerText.split(/\r?\n\r?\n/);
    const chunks = [];
    let currentChunk = '';

    for (const p of paragraphs) {
        if ((currentChunk + '\n\n' + p).length > maxLen) {
            if (currentChunk) chunks.push(currentChunk.trim());
            if (p.length > maxLen) {
                // Đoạn quá dài -> cắt từng dòng
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
        const header = (i === 0) ? '🤖 <b>[MÁY TÍNH PHẢN HỒI XONG]:</b>\n\n' : `<i>(Phần ${i + 1}/${chunks.length})</i>\n\n`;
        await sendMsg(chatId, `${header}${html}`, threadId);
        if (i < chunks.length - 1) {
            await new Promise(r => setTimeout(r, 200));
        }
    }
}

// --- STATE MANAGEMENT ---

let activeChatId = allowedChatId || -1004457846636;
let activeThreadId = null;
let tempMsgIds = [];

let promptReadingMsgId = null;
let promptReadingStart = null;
let promptReadingText = '';

let mirrorThinkingMsgId = null;
let mirrorThinkingStart = null;

let activeWorkingMsgId = null;
let activeWorkingTitle = '';
let activeWorkingStart = null;

let planningMsgId = null;
let planningStart = null;

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
    } else {
        console.warn('[Bridge Warning] Không tìm thấy language_server.exe tại:', langServer);
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

            // 1. AI bắt đầu suy nghĩ (chưa gọi tool và chưa có content trả về)
            if (entry.thinking && !entry.content && (!entry.tool_calls || entry.tool_calls.length === 0)) {
                if (promptReadingMsgId && promptReadingStart) {
                    const rSec = Math.max(1, Math.round((Date.now() - promptReadingStart) / 1000));
                    const safe = escapeHtml(promptReadingText);
                    await editMsg(activeChatId, promptReadingMsgId, `📖 <b>[ĐÃ ĐỌC XONG PROMPT - ${rSec}s]</b>\n<blockquote><i>${safe}</i></blockquote>`);
                    promptReadingMsgId = null;
                }

                if (!mirrorThinkingStart) {
                    mirrorThinkingStart = Date.now();
                    mirrorThinkingMsgId = await sendMsg(activeChatId, `🧠 <b>[AI ĐANG SUY NGHĨ (1s)...]</b>`, activeThreadId);
                    if (mirrorThinkingMsgId) tempMsgIds.push(mirrorThinkingMsgId);
                }
            }

            // 2. AI gọi tool thực thi
            if (entry.tool_calls && entry.tool_calls.length > 0) {
                if (promptReadingMsgId && promptReadingStart) {
                    const rSec = Math.max(1, Math.round((Date.now() - promptReadingStart) / 1000));
                    const safe = escapeHtml(promptReadingText);
                    await editMsg(activeChatId, promptReadingMsgId, `📖 <b>[ĐÃ ĐỌC XONG PROMPT - ${rSec}s]</b>\n<blockquote><i>${safe}</i></blockquote>`);
                    promptReadingMsgId = null;
                }

                if (mirrorThinkingMsgId && mirrorThinkingStart) {
                    const tSec = Math.max(1, Math.round((Date.now() - mirrorThinkingStart) / 1000));
                    await editMsg(activeChatId, mirrorThinkingMsgId, `🧠 <b>[AI ĐÃ SUY NGHĨ XONG - ${tSec}s]</b>`);
                    mirrorThinkingMsgId = null;
                    mirrorThinkingStart = null;
                }

                if (planningMsgId && planningStart) {
                    const pSec = Math.max(1, Math.round((Date.now() - planningStart) / 1000));
                    await editMsg(activeChatId, planningMsgId, `🧠 <b>[AI ĐÃ XỬ LÝ XONG - ${pSec}s]</b>`);
                    planningMsgId = null;
                    planningStart = null;
                }

                const tc = entry.tool_calls[0];
                const toolName = tc.name;
                const summary = tc.args && tc.args.toolSummary ? tc.args.toolSummary.replace(/^"|"$/g, '') : `Thực thi ${toolName}`;

                activeWorkingStart = Date.now();
                activeWorkingTitle = summary;
                activeWorkingMsgId = await sendMsg(activeChatId, `⚡ <b>[MÁY TÍNH ĐANG THỰC HIỆN (1s)...]</b>\n${summary}`, activeThreadId);
                if (activeWorkingMsgId) tempMsgIds.push(activeWorkingMsgId);
            }

            // 3. Output kết quả lệnh máy tính
            if (entry.type === 'GENERIC' && entry.content) {
                if (activeWorkingMsgId && activeWorkingStart) {
                    const wSec = Math.max(1, Math.round((Date.now() - activeWorkingStart) / 1000));
                    await editMsg(activeChatId, activeWorkingMsgId, `✅ <b>[MÁY TÍNH ĐÃ HOÀN TẤT - ${wSec}s]</b>\n${activeWorkingTitle}`);
                    activeWorkingMsgId = null;
                    activeWorkingStart = null;
                }

                const cStr = entry.content.toString();
                const mOut = cStr.match(/Command output:\s*([\s\S]*)/);
                if (mOut && mOut[1].trim().length > 5) {
                    const outLines = mOut[1].trim().split(/\r?\n/);
                    let shortOut = outLines.slice(0, 4).join('\n');
                    if (outLines.length > 4) shortOut += `\n... [còn ${outLines.length - 4} dòng]`;
                    const safeOut = escapeHtml(shortOut);
                    const mid = await sendMsg(activeChatId, `📤 <b>[KẾT QUẢ OUTPUT]:</b>\n<pre><code class="language-powershell">${safeOut}</code></pre>`, activeThreadId);
                    if (mid) tempMsgIds.push(mid);

                    planningStart = Date.now();
                    planningMsgId = await sendMsg(activeChatId, `🧠 <b>[AI ĐANG XỬ LÝ BƯỚC TIẾP THEO (1s)...]</b>`, activeThreadId);
                    if (planningMsgId) tempMsgIds.push(planningMsgId);
                }
            }

            // 4. MODEL PHẢN HỒI XONG -> GỬI ĐÁP ÁN & DỌN DẸP SẠCH TOÀN BỘ TIN NHẮN TẠM THỜI
            if (entry.type === 'PLANNER_RESPONSE' && entry.content && (!entry.tool_calls || entry.tool_calls.length === 0)) {
                const answer = entry.content.toString().trim();
                if (!answer) continue;

                if (planningMsgId && planningStart) {
                    const pSec = Math.max(1, Math.round((Date.now() - planningStart) / 1000));
                    await editMsg(activeChatId, planningMsgId, `🧠 <b>[AI ĐÃ XỬ LÝ XONG - ${pSec}s]</b>`);
                    planningMsgId = null;
                    planningStart = null;
                }
                if (activeWorkingMsgId && activeWorkingStart) {
                    const wSec = Math.max(1, Math.round((Date.now() - activeWorkingStart) / 1000));
                    await editMsg(activeChatId, activeWorkingMsgId, `✅ <b>[MÁY TÍNH ĐÃ HOÀN TẤT - ${wSec}s]</b>\n${activeWorkingTitle}`);
                    activeWorkingMsgId = null;
                    activeWorkingStart = null;
                }

                console.log('[Bridge] Gửi câu trả lời hoàn chỉnh tới Telegram...');
                await sendLongResponse(activeChatId, answer, activeThreadId);

                // Gom nốt bóng đọc prompt nếu còn sót
                if (promptReadingMsgId) {
                    tempMsgIds.push(promptReadingMsgId);
                    promptReadingMsgId = null;
                }

                // DỌN SẠCH TẤT CẢ TIẾN TRÌNH TẠM THỜI (chỉ giữ lại câu trả lời sạch đẹp)
                if (tempMsgIds.length > 0) {
                    console.log(`[Bridge] Đang dọn dẹp ${tempMsgIds.length} tin nhắn tạm thời...`);
                    const toDelete = [...tempMsgIds];
                    tempMsgIds = [];
                    setTimeout(async () => {
                        await deleteMsgs(activeChatId, toDelete);
                        console.log('[Bridge] Đã dọn sạch bong tin nhắn tạm thời!');
                    }, 350);
                }
            }
        } catch (e) {
            console.error('[Bridge Error] Lỗi parse dòng transcript:', e.message);
        }
    }
}

// Quét transcript mỗi 150ms
setInterval(processTranscript, 150);

// --- TELEGRAM POLLING LOOP ---

let pollOffset = 0;

async function pollUpdates() {
    console.log('[Bridge Polling] Bắt đầu lắng nghe tin nhắn Telegram...');
    const allowedList = [2029333412, -1004457846636];
    if (allowedChatId) allowedList.push(Number(allowedChatId));

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

                    // Kiểm tra bảo mật
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

                    // 1. Phản hồi tức thì bằng bóng đọc prompt (< 0.2s)
                    promptReadingStart = Date.now();
                    promptReadingText = userText;

                    const previewClean = userText.replace(/[<>]/g, '');
                    const previewSafe = escapeHtml(previewClean.length > 50 ? previewClean.substring(0, 50) + '...' : previewClean);
                    const promptLabel = isPhoto
                        ? '📷 <b>[ĐÃ NHẬN ẢNH - ĐANG PHÂN TÍCH (1s)...]</b>'
                        : '📖 <b>[ĐÃ NHẬN & ĐANG ĐỌC PROMPT (1s)...]</b>';

                    promptReadingMsgId = await sendMsg(chatId, `${promptLabel}\n<blockquote><i>${previewSafe}</i></blockquote>`, threadId);
                    if (promptReadingMsgId) tempMsgIds.push(promptReadingMsgId);

                    // 2. Chuyển prompt tới máy tính (Antigravity PC)
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
