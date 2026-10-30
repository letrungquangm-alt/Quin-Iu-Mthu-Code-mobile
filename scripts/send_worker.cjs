const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const configPath = path.join(rootDir, 'config.json');

let botToken = '';
let supergroupId = -1004457846636;
let defaultThreadId = 1160;

if (fs.existsSync(configPath)) {
    try {
        const raw = fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/, '');
        const cfg = JSON.parse(raw);
        botToken = cfg.BOT_TOKEN || '';
    } catch (e) {}
}

if (!botToken) {
    botToken = process.env.BOT_TOKEN || '9295576468:AAEDkx2sZBzfxGSnOMFprvhwHIOQ4pD_xmQ';
}

const syncBridgePath = path.join(rootDir, 'sync_bridge.json');
if (fs.existsSync(syncBridgePath)) {
    try {
        const raw = fs.readFileSync(syncBridgePath, 'utf8').replace(/^\uFEFF/, '');
        const br = JSON.parse(raw);
        if (br.chatId && String(br.chatId).startsWith('-100')) supergroupId = Number(br.chatId);
        if (br.threadId) defaultThreadId = Number(br.threadId);
    } catch (e) {}
}

const cancelKeyboard = {
    inline_keyboard: [
        [{ text: '🛑 Dừng tác vụ (Cancel)', callback_data: 'cancel_task' }]
    ]
};

function getQueueButtons(targetId) {
    return {
        inline_keyboard: [
            [{ text: '⚡ Ưu tiên dùng prompt này (Send now)', callback_data: `q_now:${targetId}` }],
            [{ text: '✏️ Sửa prompt đang chờ đó', callback_data: `q_edit:${targetId}` }],
            [{ text: '🗑️ Xóa prompt này', callback_data: `q_del:${targetId}` }],
            [{ text: '➕ Gửi thêm vào hàng chờ', callback_data: 'q_add' }]
        ]
    };
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

function formatStopwatch(sec) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m > 0 ? m + 'm ' : ''}${s}s`;
}

async function tgApi(method, payload) {
    if (payload.message_thread_id === null || payload.message_thread_id === undefined) {
        delete payload.message_thread_id;
    }
    const url = `https://api.telegram.org/bot${botToken}/${method}`;
    let attempts = 0;

    while (attempts < 5) {
        attempts++;
        try {
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const json = await res.json();
            if (json.ok) return json;

            // Handle 429 Rate Limit
            if (json.error_code === 429 && json.parameters && json.parameters.retry_after) {
                const waitSec = json.parameters.retry_after;
                console.warn(`[SendWorker 429] Chờ ${waitSec}s trước khi gửi tiếp...`);
                await new Promise(r => setTimeout(r, (waitSec + 1) * 1000));
                continue;
            }

            // HTML entity parsing failure -> fallback to plain text
            if (json.description && json.description.includes('can\'t parse entities') && payload.parse_mode === 'HTML') {
                delete payload.parse_mode;
                payload.text = payload.text.replace(/<[^>]+>/g, '');
                continue;
            }

            if (json.description && (
                json.description.includes('message to edit not found') ||
                json.description.includes('message is not modified')
            )) {
                return json;
            }

            console.error(`[SendWorker Fail]:`, json.description);
            return json;
        } catch (e) {
            console.error(`[SendWorker Ex]:`, e.message);
            await new Promise(r => setTimeout(r, 1000));
        }
    }
    return { ok: false };
}

function chunkText(text, maxLen = 3500) {
    if (!text || text.length <= maxLen) return [text];

    const paragraphs = text.split(/\r?\n\r?\n/);
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
    return chunks;
}

const stateFile = path.join(rootDir, 'bridge_state.json');

function getBridgeState() {
    if (fs.existsSync(stateFile)) {
        try {
            return JSON.parse(fs.readFileSync(stateFile, 'utf8'));
        } catch (e) {}
    }
    return {};
}

function updateBridgeState(patch) {
    const st = Object.assign(getBridgeState(), patch);
    try {
        fs.writeFileSync(stateFile, JSON.stringify(st, null, 2), 'utf8');
    } catch (e) {}
    return st;
}

async function run() {
    const args = process.argv.slice(2);
    if (args.length === 0) {
        console.log('Usage: node send_worker.cjs <payload.json | --ack <preview> | --cancel | text>');
        process.exit(0);
    }

    let payload = null;
    let isFile = false;
    const firstArg = args[0];

    // Case 1: Đọc từ file JSON Outbox
    if (fs.existsSync(firstArg) && firstArg.endsWith('.json')) {
        isFile = true;
        try {
            const raw = fs.readFileSync(firstArg, 'utf8').replace(/^\uFEFF/, '');
            payload = JSON.parse(raw);
        } catch (e) {
            console.error('[SendWorker] Khong the doc file payload:', e.message);
            process.exit(1);
        }
    }
    // Case 2: Cờ --ack: Gửi bong bóng bắt thấy prompt
    else if (firstArg === '--ack') {
        const preview = args[1] || 'Yêu cầu của bro';
        const thread = args[2] ? Number(args[2]) : defaultThreadId;
        payload = {
            action: 'prompt_start',
            chat_id: supergroupId,
            message_thread_id: thread,
            preview: preview,
            isEdit: false,
            isPhoto: false
        };
    }
    // Case 3: Cờ --cancel: Gửi thông báo hủy tác vụ
    else if (firstArg === '--cancel') {
        const thread = args[1] ? Number(args[1]) : defaultThreadId;
        payload = {
            action: 'cancel',
            chat_id: supergroupId,
            message_thread_id: thread
        };
    }
    // Case 4: Tin nhắn văn bản thuần
    else {
        payload = {
            action: 'text',
            chat_id: supergroupId,
            message_thread_id: defaultThreadId,
            text: args.join(' ')
        };
    }

    const action = payload.action || (payload.text ? 'response' : 'text');
    const chatId = payload.chat_id || supergroupId;
    const threadId = (payload.message_thread_id !== undefined) ? payload.message_thread_id : null;

    // --- 1. ACTION: PROMPT_START (BẮT ĐẦU NHẬN PROMPT & LIVE TICKING STOPWATCH) ---
    if (action === 'prompt_start' || action === 'prompt_ack') {
        const preview = payload.preview || '';
        const isEdit = !!payload.isEdit;
        const isPhoto = !!payload.isPhoto;
        const startTime = Date.now();
        const workerSessionId = 'sess_' + startTime;

        updateBridgeState({
            isWorking: true,
            currentSessionId: workerSessionId,
            promptStartTime: startTime,
            promptMsgId: null,
            preview: preview
        });

        const promptLabel = isEdit
            ? '✏️ <b>[ĐÃ CẬP NHẬT PROMPT MỚI]</b> • ⏱️ <code>1s</code>'
            : (isPhoto
                ? '📷 <b>[ĐÃ NHẬN ẢNH VÀ ĐANG PHÂN TÍCH]</b> • ⏱️ <code>1s</code>'
                : '📖 <b>[ĐÃ ĐỌC PROMPT &amp; ĐANG XỬ LÝ]</b> • ⏱️ <code>1s</code>');

        const previewClean = preview.replace(/[<>]/g, '');
        const previewSafe = escapeHtml(previewClean.length > 55 ? previewClean.substring(0, 55) + '...' : previewClean);
        const initialText = `${promptLabel}\n<blockquote><i>${previewSafe}</i></blockquote>\n⏱️ <i>Đang đếm giây xử lý: 1s...</i>`;

        const res = await tgApi('sendMessage', {
            chat_id: chatId,
            message_thread_id: threadId,
            text: initialText,
            parse_mode: 'HTML',
            disable_web_page_preview: true,
            reply_markup: cancelKeyboard
        });

        if (isFile) {
            try { fs.unlinkSync(firstArg); } catch (e) {}
        }

        if (!res || !res.ok || !res.result) {
            console.error('[SendWorker] Khong the gui bong bong ban dau');
            process.exit(1);
        }

        const promptMsgId = res.result.message_id;
        console.log(`[SendWorker PromptStart OK] Msg ID: ${promptMsgId} tại Topic #${threadId}`);
        updateBridgeState({ promptMsgId: promptMsgId });

        // 👉 VÒNG LẶP ĐẾM GIÂY STOPWATCH NGẦM TẠI ĐÂY (3.5s / lần)
        let lastText = initialText;

        while (true) {
            await new Promise(r => setTimeout(r, 3500));
            const currentState = getBridgeState();

            // Nếu tác vụ đã kết thúc hoặc phiên mới đã đè lên -> Dừng đếm giây
            if (!currentState.isWorking || currentState.currentSessionId !== workerSessionId) {
                console.log(`[SendWorker Ticker Stopped] Phien ${workerSessionId} da hoan tat.`);
                break;
            }

            const elapsed = Math.max(1, Math.round((Date.now() - startTime) / 1000));
            const timeStr = formatStopwatch(elapsed);

            const updatedPromptLabel = isEdit
                ? `✏️ <b>[ĐÃ CẬP NHẬT PROMPT MỚI]</b> • ⏱️ <code>${timeStr}</code>`
                : (isPhoto
                    ? `📷 <b>[ĐÃ NHẬN ẢNH VÀ ĐANG PHÂN TÍCH]</b> • ⏱️ <code>${timeStr}</code>`
                    : `📖 <b>[ĐÃ ĐỌC PROMPT &amp; ĐANG XỬ LÝ]</b> • ⏱️ <code>${timeStr}</code>`);

            const newText = `${updatedPromptLabel}\n<blockquote><i>${previewSafe}</i></blockquote>\n⏱️ <i>Đang đếm giây xử lý: ${timeStr}...</i>`;

            if (newText !== lastText) {
                lastText = newText;
                const editRes = await tgApi('editMessageText', {
                    chat_id: chatId,
                    message_id: promptMsgId,
                    text: newText,
                    parse_mode: 'HTML',
                    disable_web_page_preview: true,
                    reply_markup: cancelKeyboard
                });

                if (editRes && !editRes.ok && editRes.description && editRes.description.includes('message to edit not found')) {
                    console.log('[SendWorker] Tin nhan da bi xoa, dung ticker.');
                    break;
                }
            }
        }
        process.exit(0);
    }

    // --- 2. ACTION: QUEUE (NẠP PROMPT VÀO HÀNG ĐỢI) ---
    else if (action === 'queue') {
        const preview = payload.preview || '';
        const queueId = payload.queueId || 'q_' + Date.now();
        const queuePos = payload.queuePos || 1;

        const previewClean = preview.replace(/[<>]/g, '');
        const previewSafe = escapeHtml(previewClean.length > 55 ? previewClean.substring(0, 55) + '...' : previewClean);
        const qNotice = `📥 <b>[ĐÃ NẠP VÀO HÀNG ĐỢI PC]</b>\n<blockquote><i>${previewSafe}</i></blockquote>\n<i>Máy tính đang xử lý tác vụ trước đó. Prompt này đã được xếp vị trí <b>#${queuePos}</b> trong hàng chờ!</i>`;

        await tgApi('sendMessage', {
            chat_id: chatId,
            message_thread_id: threadId,
            text: qNotice,
            parse_mode: 'HTML',
            disable_web_page_preview: true,
            reply_markup: getQueueButtons(queueId)
        });
        console.log(`[SendWorker Queue OK] Da nap vao hang cho #${queuePos}`);
    }

    // --- 3. ACTION: CANCEL (HỦY TÁC VỤ & DỌN DẸP) ---
    else if (action === 'cancel') {
        const st = updateBridgeState({ isWorking: false });
        const oldMsgId = st.promptMsgId;

        const cancelMsg = `🛑 <b>[ĐÃ HỦY TÁC VỤ THEO YÊU CẦU CỦA BRO!]</b>\n<i>Đã dừng tiến trình và dọn dẹp sạch sẽ.</i>`;

        if (oldMsgId) {
            await tgApi('editMessageText', {
                chat_id: chatId,
                message_id: oldMsgId,
                text: cancelMsg,
                parse_mode: 'HTML',
                disable_web_page_preview: true,
                reply_markup: { inline_keyboard: [] }
            });

            // Tự động dọn dẹp bong bóng sau 1.5s
            setTimeout(async () => {
                await tgApi('deleteMessage', { chat_id: chatId, message_id: oldMsgId });
            }, 1500);
        } else {
            const res = await tgApi('sendMessage', {
                chat_id: chatId,
                message_thread_id: threadId,
                text: cancelMsg,
                parse_mode: 'HTML',
                disable_web_page_preview: true
            });
            if (res && res.result) {
                setTimeout(async () => {
                    await tgApi('deleteMessage', { chat_id: chatId, message_id: res.result.message_id });
                }, 1500);
            }
        }
        console.log(`[SendWorker Cancel OK] Đã dừng và dọn dẹp`);
    }

    // --- 4. ACTION: RESPONSE (GỬI KẾT QUẢ HOÀN TẤT & TỰ ĐỘNG DỌN BUBBLE) ---
    else {
        const rawText = payload.text || '';
        const totalSec = payload.totalSec;
        const st = updateBridgeState({ isWorking: false });
        const oldMsgId = st.promptMsgId;

        if (rawText.trim()) {
            const header = totalSec
                ? `🤖 <b>[MÁY TÍNH ĐÃ PHẢN HỒI (Hoàn tất trong ${totalSec}s)]:</b>\n\n`
                : '';

            const chunks = chunkText(rawText, 3500);

            for (let i = 0; i < chunks.length; i++) {
                const html = mdToTgHtml(chunks[i]);
                const chunkHeader = (i === 0)
                    ? header
                    : `<i>(Phần ${i + 1}/${chunks.length})</i>\n\n`;

                await tgApi('sendMessage', {
                    chat_id: chatId,
                    message_thread_id: threadId,
                    text: `${chunkHeader}${html}`,
                    parse_mode: 'HTML',
                    disable_web_page_preview: true
                });

                if (i < chunks.length - 1) {
                    await new Promise(r => setTimeout(r, 200));
                }
            }
            console.log(`[SendWorker Response OK] Da gui ${chunks.length} phan toi Topic #${threadId}!`);
        }

        // Tự động xóa bong bóng đếm giây cũ sau khi đã gửi xong kết quả
        if (oldMsgId) {
            setTimeout(async () => {
                await tgApi('deleteMessage', { chat_id: chatId, message_id: oldMsgId });
            }, 1500);
        }
    }

    if (isFile) {
        try {
            fs.unlinkSync(firstArg);
        } catch (e) {}
    }
}

run();
