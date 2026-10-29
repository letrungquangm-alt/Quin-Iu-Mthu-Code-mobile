/**
 * QuinloveRin Code - Fast Telegram Bridge v2.7 (.cjs)
 * - TỰ ĐỘNG GỠ WEBHOOK CLOUD KHI MÁY TÍNH BẬT (CHUYỂN GIAO MƯỢT MÀ VỀ PC).
 * - MÀU SẮC TRỰC QUAN CHO CÔNG CỤ (Diff Syntax Highlighting):
 *   + 🟢 [TẠO FILE MỚI] (+ X dòng mã nguồn mới - Xanh lá)
 *   + 🟠 [SỬA FILE] (+ X dòng thêm, - Y dòng sửa, ! Ghi đè - Cam)
 *   + 🔴 [XÓA FILE / THƯ MỤC] (- Lệnh xóa - Đỏ)
 *   + 📄 [ĐỌC FILE] (Kèm phạm vi dòng)
 *   + ⚡ [MÁY TÍNH ĐANG THỰC HIỆN] (Chạy lệnh terminal)
 * - PHẢN CHIẾU 100% TIẾN TRÌNH VÀO BOX CHAT ANTIGRAVITY PC:
 *   + Pop-up nổi Toast trên màn hình máy tính (show_notification.ps1).
 *   + Nạp tin nhắn vào box chat máy tính qua agentapi send-message.
 *   + Đếm ngược 10s tự hủy tiến trình tạm thời, giữ câu trả lời vĩnh viễn.
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

console.log('========================================================');
console.log(' Fast Telegram Bridge v2.7 (Color-Coded Diff & Auto-PC Reconnect)');
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
    text = text.replace(/^&gt;\s*([^\r\n]+)/gm, '<blockquote>$1</blockquote>');

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
            bubbleText = `⚡ <b>[MÁY TÍNH ĐANG THỰC HIỆN]</b>\n▶ <code>${escapeHtml(summary)}</code>\n<pre><code class="language-powershell">${safeCmd}</code></pre>`;
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
            bubbleText = `🟠 <b>[SỬA FILE]:</b> <code>${fileName}</code>\n<pre><code class="language-diff">+ ${contentLines} dòng thêm/ghi đè\n! Cập nhật nội dung mã nguồn</code></pre>`;
        } else {
            summary = rawSummary || `Tạo mới file ${fileName}`;
            bubbleText = `🟢 <b>[TẠO FILE MỚI]:</b> <code>${fileName}</code>\n<pre><code class="language-diff">+ ${contentLines} dòng mã nguồn mới</code></pre>`;
        }
    } else if (toolName === 'edit_file') {
        const rawPath = args.Path ? args.Path.toString().replace(/^"|"$/g, '') : 'file';
        const fileName = path.basename(rawPath);
        const linesRemoved = args.Target ? args.Target.toString().split(/\r?\n/).length : 1;
        const linesAdded = args.Replacement ? args.Replacement.toString().split(/\r?\n/).length : 0;
        summary = rawSummary || `Chỉnh sửa code ${fileName}`;
        bubbleText = `🟠 <b>[SỬA FILE]:</b> <code>${fileName}</code>\n<pre><code class="language-diff">+ ${linesAdded} dòng thêm\n- ${linesRemoved} dòng sửa</code></pre>`;
    } else if (toolName === 'read_file') {
        const rawPath = args.Path ? args.Path.toString().replace(/^"|"$/g, '') : 'file';
        const fileName = path.basename(rawPath);
        const sLine = args.StartLine || '';
        const eLine = args.EndLine || '';
        let rangeInfo = '(Đọc toàn bộ file)';
        if (sLine && eLine) rangeInfo = `(Dòng ${sLine} - ${eLine})`;
        else if (sLine) rangeInfo = `(Từ dòng ${sLine})`;
        else if (eLine) rangeInfo = `(Đến dòng ${eLine})`;
        summary = rawSummary || `Đọc nội dung ${fileName}`;
        bubbleText = `📄 <b>[ĐỌC FILE]:</b> <code>${fileName}</code> <i>${rangeInfo}</i>`;
    } else if (toolName === 'manage_task') {
        const action = args.Action || '';
        const taskId = args.TaskId ? path.basename(args.TaskId) : '';
        summary = rawSummary || `Quản lý tiến trình (${action})`;
        bubbleText = `⚙️ <b>[TIẾN TRÌNH NGẦM]:</b> <code>${action} ${taskId}</code>`.trim();
    } else {
        summary = rawSummary || `Thực thi ${toolName}`;
        bubbleText = `⚡ <b>[MÁY TÍNH ĐANG THỰC HIỆN]</b>\n▶ <code>${escapeHtml(summary)}</code>`;
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
        execFile(langServer, ['agentapi', 'send-message', conversationId, `[Điện thoại gửi]: ${text}`], (err, stdout) => {
            if (err) {
                console.error('[Bridge IPC Error] Không thể chuyển prompt tới Antigravity:', err.message);
            } else {
                console.log('[Bridge IPC OK] Đã nạp prompt vào Box Chat Antigravity PC:', text.substring(0, 50));
            }
        });
    } else {
        console.warn('[Bridge Warning] Không tìm thấy language_server.exe tại:', langServer);
    }
}

// --- STATE MANAGEMENT ---

let activeChatId = allowedChatId || -1004457846636;
let activeThreadId = null;

let promptStartTime = null;
let promptTextSaved = '';
let thinkingSent = false;
let currentWorkingMsgId = null;
let currentToolStartTime = null;
let currentToolSummary = '';
let typingInterval = null;
let tempMsgIds = [];

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
                thinkingSent = false;

                const previewClean = uText.replace(/[<>]/g, '');
                const previewSafe = escapeHtml(previewClean.length > 55 ? previewClean.substring(0, 55) + '...' : previewClean);
                const pid = await sendMsg(
                    activeChatId,
                    `📖 <b>[ĐÃ ĐỌC PROMPT VÀ ĐANG XỬ LÝ YÊU CẦU BẠN, VUI LÒNG ĐỢI (1s)...]</b>\n<blockquote><i>${previewSafe}</i></blockquote>`,
                    activeThreadId
                );
                if (pid) tempMsgIds.push(pid);
            }

            // Giai đoạn: AI đã có cách / đang suy nghĩ
            if (entry.thinking && !entry.content && (!entry.tool_calls || entry.tool_calls.length === 0)) {
                if (!thinkingSent) {
                    thinkingSent = true;
                    const elapsed = promptStartTime ? Math.max(1, Math.round((Date.now() - promptStartTime) / 1000)) : 1;
                    const safe = escapeHtml(promptTextSaved || 'Yêu cầu của bạn');
                    const tid = await sendMsg(
                        activeChatId,
                        `💡 <b>[ĐÃ CÓ CÁCH, ĐỢI MÌNH CHÚT - ${elapsed}s]</b>\n<blockquote><i>${safe}</i></blockquote>`,
                        activeThreadId
                    );
                    if (tid) tempMsgIds.push(tid);
                }
            }

            // Giai đoạn: Tool Call (Phân loại màu sắc)
            if (entry.tool_calls && entry.tool_calls.length > 0) {
                currentToolStartTime = Date.now();
                const tc = entry.tool_calls[0];
                const { summary, bubbleText } = formatToolCall(tc);
                currentToolSummary = summary;

                currentWorkingMsgId = await sendMsg(activeChatId, bubbleText, activeThreadId);
                if (currentWorkingMsgId) tempMsgIds.push(currentWorkingMsgId);
            }

            // Giai đoạn: Hoàn tất Tool Call
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

                if (typingInterval) {
                    clearInterval(typingInterval);
                    typingInterval = null;
                }

                const totalSec = promptStartTime ? Math.max(1, Math.round((Date.now() - promptStartTime) / 1000)) : 1;
                console.log('[Bridge] Gửi câu trả lời hoàn chỉnh từ PC tới Telegram...');
                await sendLongResponse(activeChatId, answer, totalSec, activeThreadId);

                const toClean = [...tempMsgIds];
                tempMsgIds = [];
                promptStartTime = null;
                promptTextSaved = '';
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

                    if (!update.message) continue;
                    const msg = update.message;
                    const chatId = msg.chat.id;
                    const threadId = msg.message_thread_id || null;
                    const fromId = msg.from ? msg.from.id : 0;

                    // Bỏ qua tin nhắn từ Bot
                    if (msg.from && msg.from.is_bot) continue;

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

                    // Xử lý lệnh nhanh /pc hoặc /local
                    if (/^(?:\/pc|\/local|kết nối lại máy tính)$/i.test(userText)) {
                        await sendMsg(chatId, `💻 <b>[MÁY TÍNH ĐANG TIẾP QUẢN TRỰC TIẾP]</b>\n──────────────────────\n🔗 <b>Mã đồng bộ:</b> <code>GM_6585_Mthu</code>\n🖥️ <b>Trạng thái:</b> SẴN SÀNG 100%\n✨ Toàn bộ lệnh gửi từ đây sẽ hiện trực tiếp trên màn hình máy tính!`, threadId);
                        continue;
                    }

                    promptStartTime = Date.now();
                    promptTextSaved = userText;
                    thinkingSent = false;

                    const previewClean = userText.replace(/[<>]/g, '');
                    const previewSafe = escapeHtml(previewClean.length > 55 ? previewClean.substring(0, 55) + '...' : previewClean);

                    // 1. Phản hồi tức thì bằng bóng đọc prompt
                    const promptLabel = isPhoto
                        ? '📷 <b>[ĐÃ NHẬN ẢNH VÀ ĐANG PHÂN TÍCH, VUI LÒNG ĐỢI (1s)...]</b>'
                        : '📖 <b>[ĐÃ ĐỌC PROMPT VÀ ĐANG XỬ LÝ YÊU CẦU BẠN, VUI LÒNG ĐỢI (1s)...]</b>';

                    const promptMid = await sendMsg(chatId, `${promptLabel}\n<blockquote><i>${previewSafe}</i></blockquote>`, threadId);
                    if (promptMid) tempMsgIds.push(promptMid);

                    // 2. Bật Popup Toast trên màn hình PC
                    showScreenToast('📱 Telegram -> PC Sync', previewClean);

                    // 3. Ghi vào sync_bridge.json
                    recordSyncMessage(userText);

                    // 4. Đẩy thẳng Prompt vào Box Chat Antigravity PC
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
