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
    botToken = process.env.BOT_TOKEN || '9295576468:AAEWszGzGSvgYDeNBFh4zZBhuxkOzixfz4o';
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

async function tgApi(method, payload) {
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
                console.warn(`[SendWorker 429] Cho ${waitSec}s truoc khi gui lai...`);
                await new Promise(r => setTimeout(r, (waitSec + 1) * 1000));
                continue;
            }

            // HTML entity parsing failure -> fallback to plain text
            if (json.description && json.description.includes('can\'t parse entities') && payload.parse_mode === 'HTML') {
                delete payload.parse_mode;
                payload.text = payload.text.replace(/<[^>]+>/g, '');
                continue;
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

function updateBridgeState(stateUpdates) {
    const stateFile = path.join(rootDir, 'bridge_state.json');
    let currentState = {};
    if (fs.existsSync(stateFile)) {
        try {
            currentState = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
        } catch (e) {}
    }
    Object.assign(currentState, stateUpdates);
    try {
        fs.writeFileSync(stateFile, JSON.stringify(currentState, null, 2), 'utf8');
    } catch (e) {}
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
    // Case 2: Cờ --ack: Gửi bong bóng bắt thấy prompt ("Đã đọc prompt & đang xử lý")
    else if (firstArg === '--ack') {
        const preview = args[1] || 'Yêu cầu của bro';
        const thread = args[2] ? Number(args[2]) : defaultThreadId;
        payload = {
            action: 'prompt_ack',
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
    const threadId = payload.message_thread_id || defaultThreadId;

    // --- XỬ LÝ ACTION: PROMPT_ACK (BẮT THẤY PROMPT) ---
    if (action === 'prompt_ack') {
        const preview = payload.preview || '';
        const isEdit = !!payload.isEdit;
        const isPhoto = !!payload.isPhoto;

        const promptLabel = isEdit
            ? '✏️ <b>[ĐÃ CẬP NHẬT PROMPT MỚI]</b> • ⏱️ <code>1s</code>'
            : (isPhoto
                ? '📷 <b>[ĐÃ NHẬN ẢNH VÀ ĐANG PHÂN TÍCH]</b> • ⏱️ <code>1s</code>'
                : '📖 <b>[ĐÃ ĐỌC PROMPT &amp; ĐANG XỬ LÝ]</b> • ⏱️ <code>1s</code>');

        const previewClean = preview.replace(/[<>]/g, '');
        const previewSafe = escapeHtml(previewClean.length > 55 ? previewClean.substring(0, 55) + '...' : previewClean);
        const text = `${promptLabel}\n<blockquote><i>${previewSafe}</i></blockquote>\n⏱️ <i>Đang đếm giây xử lý: 1s...</i>`;

        const res = await tgApi('sendMessage', {
            chat_id: chatId,
            message_thread_id: threadId,
            text: text,
            parse_mode: 'HTML',
            disable_web_page_preview: true,
            reply_markup: cancelKeyboard
        });

        if (res && res.ok && res.result) {
            const msgId = res.result.message_id;
            console.log(`[SendWorker PromptAck OK] Msg ID: ${msgId} tai Topic #${threadId}`);
            updateBridgeState({
                lastPromptAckMsgId: msgId,
                lastPromptAckThreadId: threadId,
                lastPromptAckTime: Date.now(),
                previewText: preview
            });
        }
    }
    // --- XỬ LÝ ACTION: CANCEL (HỦY TÁC VỤ) ---
    else if (action === 'cancel') {
        const cancelMsg = `🛑 <b>[ĐÃ HỦY TÁC VỤ THEO YÊU CẦU CỦA BRO!]</b>\n<i>Đã dừng tiến trình và dọn dẹp sạch sẽ.</i>`;
        await tgApi('sendMessage', {
            chat_id: chatId,
            message_thread_id: threadId,
            text: cancelMsg,
            parse_mode: 'HTML',
            disable_web_page_preview: true
        });
        console.log(`[SendWorker Cancel OK] Tai Topic #${threadId}`);
    }
    // --- XỬ LÝ ACTION: RESPONSE HOẶC TEXT (PHẢN HỒI HOÀN TẤT / TIN NHẮN DÀI) ---
    else {
        const rawText = payload.text || '';
        const totalSec = payload.totalSec;

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
    }

    if (isFile) {
        try {
            fs.unlinkSync(firstArg);
        } catch (e) {}
    }
}

run();
