/**
 * QuinloveRin Code - Fast Telegram Bridge v2.5 (.cjs)
 * - TÍCH HỢP ĐẦY ĐỦ 2 CHẾ ĐỘ:
 *   1. Chế độ Điều khiển từ xa (Remote Control): Nhận lệnh từ Telegram -> Gemini AI xử lý -> Chạy code trên máy tính -> Phản hồi.
 *   2. Chế độ Phản chiếu máy tính (PC Mirror): Khi chat trực tiếp trên Antigravity PC -> Tự động stream toàn bộ tiến trình lên Telegram.
 * - GIAO DIỆN CHUẨN XÁC:
 *   + 📖 [ĐÃ ĐỌC PROMPT VÀ ĐANG XỬ LÝ YÊU CẦU BẠN, VUI LÒNG ĐỢI (Xs)...]
 *   + 💡 [ĐÃ CÓ CÁCH, ĐỢI MÌNH CHÚT - Xs]
 *   + ⚡ [MÁY TÍNH ĐANG THỰC HIỆN] ▶ <tên tác vụ> (Không gắn tổng thời gian thừa thãi)
 *   + ✅ [ĐÃ HOÀN TẤT TRONG Xs]: <tên tác vụ>
 *   + Typing trạng thái trên thanh tiêu đề khi chuẩn bị đáp án
 *   + 🤖 [MÁY TÍNH ĐÃ PHẢN HỒI XONG TRONG Xs]: <nội dung> (VĨNH VIỄN, KHÔNG BAO GIỜ XÓA)
 *   + Đếm ngược 10s tự hủy: 🧹 [ĐANG DỌN DẸP TIẾN TRÌNH TRONG VÒNG 10 GIÂY...] -> ✨ [ĐÃ DỌN DẸP THÀNH CÔNG!] -> tự xóa sau 2s.
 */

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const rootDir = __dirname;
const configPath = path.join(rootDir, 'config.json');

if (!fs.existsSync(configPath)) {
    console.error('[Bridge Error] Không tìm thấy config.json tại:', configPath);
    process.exit(1);
}

const config = JSON.parse(fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/, ''));
const botToken = config.BOT_TOKEN;
const geminiApiKey = config.GEMINI_API_KEY || '';
const allowedChatId = config.ALLOWED_CHAT_ID;
const projectsRootDir = config.PROJECTS_ROOT_DIR || path.join(process.env.USERPROFILE, '.gemini', 'antigravity', 'scratch', 'model');
const currentProject = config.CURRENT_PROJECT || 'Quin-Iu-Mthu';
const currentProjectPath = config.CURRENT_PROJECT_PATH || path.join(projectsRootDir, currentProject);

if (!fs.existsSync(currentProjectPath)) {
    fs.mkdirSync(currentProjectPath, { recursive: true });
}

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

console.log('========================================================');
console.log(' Fast Telegram Bridge v2.5 (Dual Mode: Remote & PC Mirror)');
console.log(' Bot Token:', botToken ? botToken.substring(0, 10) + '...' : 'NONE');
console.log(' Project Path:', currentProjectPath);
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

// --- REMOTE EXECUTION ENGINE (KHI NHẬN LỆNH TỪ TELEGRAM) ---

const chatHistory = [];

function executePowerShell(cmd, workDir) {
    return new Promise(resolve => {
        exec(cmd, { cwd: workDir, shell: 'powershell.exe', maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
            let out = (stdout || '') + (stderr || '');
            if (!out && err) out = err.message;
            resolve(out.trim());
        });
    });
}

async function callGeminiApi(promptText) {
    const sysInstruction = `Bạn là trợ lý lập trình AI thông minh cao cấp cho QuinloveRin Code.
Bạn đang điều khiển máy tính từ xa qua Telegram của người dùng.
Thư mục dự án hiện tại: ${currentProjectPath}.
Khi cần tạo hoặc sửa file, hãy xuất khối lệnh PowerShell trong khối \`\`\`run:
Ví dụ:
\`\`\`run
Set-Content -Path "index.html" -Value @"
<!DOCTYPE html>
... nội dung ...
"@ -Encoding UTF8
\`\`\`
QUY TẮC:
- Trả lời bằng tiếng Việt chuẩn, súc tích, chuyên nghiệp. Xưng hô: 'tôi - bro'.
- Luôn hoàn thành đúng yêu cầu, tạo mã nguồn chuẩn và lưu vào đúng thư mục dự án.`;

    const contents = [
        ...chatHistory.slice(-10),
        { role: 'user', parts: [{ text: promptText }] }
    ];

    const modelsToTry = ['gemini-3.5-flash-lite', 'gemini-3.8-flash', 'gemini-3.5-flash'];

    for (const m of modelsToTry) {
        try {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${geminiApiKey}`;
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    systemInstruction: { parts: [{ text: sysInstruction }] },
                    contents: contents
                })
            });
            const data = await res.json();
            if (data.candidates && data.candidates[0].content && data.candidates[0].content.parts[0].text) {
                const text = data.candidates[0].content.parts[0].text;
                chatHistory.push({ role: 'user', parts: [{ text: promptText }] });
                chatHistory.push({ role: 'model', parts: [{ text: text }] });
                return text;
            }
        } catch (e) {
            console.warn(`[Gemini Error ${m}]:`, e.message);
        }
    }
    return 'Hệ thống AI đang tạm thời bận, bro vui lòng thử lại sau vài giây nhé!';
}

let isExecutingFromTelegram = false;

async function handleTelegramMessage(chatId, threadId, userText, isPhoto) {
    if (isExecutingFromTelegram) {
        await sendMsg(chatId, '⏳ <i>Máy tính đang xử lý một tác vụ trước đó, bro đợi vài giây nhé...</i>', threadId);
        return;
    }

    isExecutingFromTelegram = true;
    const localTempIds = [];
    const startTime = Date.now();

    try {
        const previewClean = userText.replace(/[<>]/g, '');
        const previewSafe = escapeHtml(previewClean.length > 55 ? previewClean.substring(0, 55) + '...' : previewClean);

        // 1. Bóng đọc Prompt
        const promptLabel = isPhoto
            ? '📷 <b>[ĐÃ NHẬN ẢNH VÀ ĐANG PHÂN TÍCH, VUI LÒNG ĐỢI (1s)...]</b>'
            : '📖 <b>[ĐÃ ĐỌC PROMPT VÀ ĐANG XỬ LÝ YÊU CẦU BẠN, VUI LÒNG ĐỢI (1s)...]</b>';
        const pMid = await sendMsg(chatId, `${promptLabel}\n<blockquote><i>${previewSafe}</i></blockquote>`, threadId);
        if (pMid) localTempIds.push(pMid);

        await new Promise(r => setTimeout(r, 600));

        // 2. Bóng Đã Có Cách
        const elapsedThink = Math.max(1, Math.round((Date.now() - startTime) / 1000));
        const tMid = await sendMsg(chatId, `💡 <b>[ĐÃ CÓ CÁCH, ĐỢI MÌNH CHÚT - ${elapsedThink}s]</b>\n<blockquote><i>${previewSafe}</i></blockquote>`, threadId);
        if (tMid) localTempIds.push(tMid);

        // 3. Xử lý lệnh Terminal nhanh (/cmd hoặc $)
        if (/^(?:\/cmd|\$|ps)\s+(.+)$/i.test(userText)) {
            const cmd = userText.replace(/^(?:\/cmd|\$|ps)\s+/i, '').trim();
            const safeCmd = escapeHtml(cmd);

            const toolStart = Date.now();
            const wMid = await sendMsg(chatId, `⚡ <b>[MÁY TÍNH ĐANG THỰC HIỆN]</b>\n▶ <code>${safeCmd}</code>`, threadId);
            if (wMid) localTempIds.push(wMid);

            const out = await executePowerShell(cmd, currentProjectPath);
            const toolSec = Math.max(1, Math.round((Date.now() - toolStart) / 1000));

            if (wMid) {
                await editMsg(chatId, wMid, `✅ <b>[ĐÃ HOÀN TẤT TRONG ${toolSec}s]</b>: <code>${safeCmd}</code>`);
            }

            sendTyping(chatId, threadId);
            const totalSec = Math.max(1, Math.round((Date.now() - startTime) / 1000));
            const formattedOut = out ? `<pre><code>${escapeHtml(out)}</code></pre>` : '<i>(Lệnh đã thực thi xong, không có output)</i>';
            await sendMsg(chatId, `🤖 <b>[MÁY TÍNH ĐÃ PHẢN HỒI XONG TRONG ${totalSec}s]:</b>\n\n${formattedOut}`, threadId);

            runCountdownCleanup(chatId, threadId, localTempIds);
            return;
        }

        // 4. Gọi Gemini AI xử lý yêu cầu lập trình
        const aiAnswer = await callGeminiApi(userText);

        // 5. Kiểm tra và thực thi code khối ```run nếu có
        let cleanText = aiAnswer;
        const runMatch = aiAnswer.match(/```(?:run|powershell|ps1|cmd|sh)\s*([\s\S]*?)```/);
        if (runMatch) {
            const scriptToRun = runMatch[1].trim();
            cleanText = aiAnswer.replace(/```(?:run|powershell|ps1|cmd|sh)[\s\S]*?```/g, '').trim();

            const toolStart = Date.now();
            const wMid = await sendMsg(chatId, `⚡ <b>[MÁY TÍNH ĐANG THỰC HIỆN]</b>\n▶ <code>Cập nhật mã nguồn dự án</code>`, threadId);
            if (wMid) localTempIds.push(wMid);

            await executePowerShell(scriptToRun, currentProjectPath);
            const toolSec = Math.max(1, Math.round((Date.now() - toolStart) / 1000));

            if (wMid) {
                await editMsg(chatId, wMid, `✅ <b>[ĐÃ HOÀN TẤT TRONG ${toolSec}s]</b>: <code>Cập nhật mã nguồn dự án</code>`);
            }
        }

        // 6. Phát câu trả lời hoàn chỉnh
        sendTyping(chatId, threadId);
        const totalSec = Math.max(1, Math.round((Date.now() - startTime) / 1000));
        await sendLongResponse(chatId, cleanText || aiAnswer, totalSec, threadId);

        // 7. Kích hoạt đếm ngược 10 giây dọn dẹp tiến trình
        runCountdownCleanup(chatId, threadId, localTempIds);

    } catch (err) {
        console.error('[Execute Exception]:', err.message);
        await sendMsg(chatId, `❌ Lỗi thực thi: ${escapeHtml(err.message)}`, threadId);
    } finally {
        isExecutingFromTelegram = false;
    }
}

// --- PC MIRROR WATCHER (KHI CHAT TRỰC TIẾP TRÊN ANTIGRAVITY PC) ---

let activeChatId = allowedChatId || -1004457846636;
let activeThreadId = null;

let mirrorPromptStartTime = null;
let mirrorPromptSaved = '';
let mirrorThinkingSent = false;
let mirrorWorkingMsgId = null;
let mirrorToolStartTime = null;
let mirrorToolSummary = '';
let mirrorTypingInterval = null;
let mirrorTempMsgIds = [];

let lastOffset = 0;
if (fs.existsSync(transcriptPath)) {
    try {
        lastOffset = fs.statSync(transcriptPath).size;
        console.log('[Bridge PC Mirror] Theo dõi transcript từ byte offset:', lastOffset);
    } catch (e) {}
}

async function processTranscript() {
    if (isExecutingFromTelegram) return;
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

            // Bắt Prompt từ PC nếu có
            if (entry.type === 'USER_INPUT' && entry.content) {
                mirrorPromptStartTime = Date.now();
                mirrorPromptSaved = entry.content.toString().trim();
                mirrorThinkingSent = false;

                const pClean = mirrorPromptSaved.replace(/[<>]/g, '');
                const pSafe = escapeHtml(pClean.length > 55 ? pClean.substring(0, 55) + '...' : pClean);
                const pid = await sendMsg(
                    activeChatId,
                    `📖 <b>[ĐÃ ĐỌC PROMPT VÀ ĐANG XỬ LÝ YÊU CẦU BẠN, VUI LÒNG ĐỢI (1s)...]</b>\n<blockquote><i>${pSafe}</i></blockquote>`,
                    activeThreadId
                );
                if (pid) mirrorTempMsgIds.push(pid);
            }

            // Giai đoạn: Đã có cách
            if (entry.thinking && !entry.content && (!entry.tool_calls || entry.tool_calls.length === 0)) {
                if (!mirrorThinkingSent) {
                    mirrorThinkingSent = true;
                    const elapsed = mirrorPromptStartTime ? Math.max(1, Math.round((Date.now() - mirrorPromptStartTime) / 1000)) : 1;
                    const safe = escapeHtml(mirrorPromptSaved);
                    const tid = await sendMsg(
                        activeChatId,
                        `💡 <b>[ĐÃ CÓ CÁCH, ĐỢI MÌNH CHÚT - ${elapsed}s]</b>\n<blockquote><i>${safe}</i></blockquote>`,
                        activeThreadId
                    );
                    if (tid) mirrorTempMsgIds.push(tid);
                }
            }

            // Giai đoạn: Tool Call
            if (entry.tool_calls && entry.tool_calls.length > 0) {
                mirrorToolStartTime = Date.now();
                const tc = entry.tool_calls[0];
                const toolName = tc.name;
                mirrorToolSummary = tc.args && tc.args.toolSummary ? tc.args.toolSummary.replace(/^"|"$/g, '') : `Thực thi ${toolName}`;

                const safeSummary = escapeHtml(mirrorToolSummary);
                mirrorWorkingMsgId = await sendMsg(
                    activeChatId,
                    `⚡ <b>[MÁY TÍNH ĐANG THỰC HIỆN]</b>\n▶ <code>${safeSummary}</code>`,
                    activeThreadId
                );
                if (mirrorWorkingMsgId) mirrorTempMsgIds.push(mirrorWorkingMsgId);
            }

            // Giai đoạn: Tool Output
            if (entry.type === 'GENERIC' && entry.content) {
                const wSec = mirrorToolStartTime ? Math.max(1, Math.round((Date.now() - mirrorToolStartTime) / 1000)) : 1;
                const safeTask = escapeHtml(mirrorToolSummary || 'Tác vụ');

                if (mirrorWorkingMsgId) {
                    await editMsg(
                        activeChatId,
                        mirrorWorkingMsgId,
                        `✅ <b>[ĐÃ HOÀN TẤT TRONG ${wSec}s]</b>: <code>${safeTask}</code>`
                    );
                    mirrorWorkingMsgId = null;
                }

                sendTyping(activeChatId, activeThreadId);
                if (!mirrorTypingInterval) {
                    mirrorTypingInterval = setInterval(() => {
                        sendTyping(activeChatId, activeThreadId);
                    }, 3000);
                }
            }

            // Giai đoạn: Final Response
            if (entry.type === 'PLANNER_RESPONSE' && entry.content && (!entry.tool_calls || entry.tool_calls.length === 0)) {
                const answer = entry.content.toString().trim();
                if (!answer) continue;

                if (mirrorTypingInterval) {
                    clearInterval(mirrorTypingInterval);
                    mirrorTypingInterval = null;
                }

                const totalSec = mirrorPromptStartTime ? Math.max(1, Math.round((Date.now() - mirrorPromptStartTime) / 1000)) : 1;
                console.log('[Bridge PC Mirror] Gửi câu trả lời hoàn chỉnh tới Telegram...');
                await sendLongResponse(activeChatId, answer, totalSec, activeThreadId);

                const toClean = [...mirrorTempMsgIds];
                mirrorTempMsgIds = [];
                mirrorPromptStartTime = null;
                mirrorPromptSaved = '';
                mirrorThinkingSent = false;
                mirrorWorkingMsgId = null;

                if (toClean.length > 0) {
                    runCountdownCleanup(activeChatId, activeThreadId, toClean);
                }
            }
        } catch (e) {
            console.error('[Mirror Parse Error]:', e.message);
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

                    // Không xử lý tin nhắn của Bot
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
                    handleTelegramMessage(chatId, threadId, userText, isPhoto);
                }
            }
        } catch (e) {
            console.error('[Polling Exception]:', e.message);
            await new Promise(r => setTimeout(r, 2000));
        }
    }
}

pollUpdates();
