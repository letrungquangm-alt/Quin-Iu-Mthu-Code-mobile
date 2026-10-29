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

async function run() {
    const inputArg = process.argv[2];
    if (!inputArg) {
        console.log('Usage: node send_worker.cjs <payload.json | message_text>');
        process.exit(0);
    }

    let payload = null;
    let isFile = false;

    if (fs.existsSync(inputArg)) {
        isFile = true;
        try {
            const raw = fs.readFileSync(inputArg, 'utf8').replace(/^\uFEFF/, '');
            payload = JSON.parse(raw);
        } catch (e) {
            console.error('[SendWorker] Khong the doc file payload:', e.message);
            process.exit(1);
        }
    } else {
        payload = {
            chat_id: supergroupId,
            message_thread_id: defaultThreadId,
            text: inputArg,
            totalSec: null
        };
    }

    const chatId = payload.chat_id || supergroupId;
    const threadId = payload.message_thread_id || defaultThreadId;
    const rawText = payload.text || '';
    const totalSec = payload.totalSec;

    if (!rawText.trim()) {
        if (isFile) try { fs.unlinkSync(inputArg); } catch(e){}
        process.exit(0);
    }

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

    console.log(`[SendWorker OK] Da gui thanh cong ${chunks.length} phan toi Telegram #${threadId}!`);

    if (isFile) {
        try {
            fs.unlinkSync(inputArg);
        } catch (e) {}
    }
}

run();
