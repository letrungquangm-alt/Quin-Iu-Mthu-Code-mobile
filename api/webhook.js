// Vercel Serverless Function: Telegram Webhook 24/7 Cloud Fallback
// Hoat dong ngay ca khi may tinh chinh bi cup dien hoac tat nguon

const BOT_TOKEN = process.env.BOT_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const ALLOWED_CHAT_ID = process.env.ALLOWED_CHAT_ID ? String(process.env.ALLOWED_CHAT_ID) : '';

function splitTelegramText(text, maxLen = 3500) {
    const chunks = [];
    if (!text) return chunks;

    while (text.length > maxLen) {
        let splitIdx = text.lastIndexOf('\n\n', maxLen);
        if (splitIdx < maxLen / 2) {
            splitIdx = text.lastIndexOf('\n', maxLen);
        }
        if (splitIdx < maxLen / 2) {
            splitIdx = text.lastIndexOf('. ', maxLen);
        }
        if (splitIdx < maxLen / 2) {
            splitIdx = maxLen;
        } else {
            splitIdx += 1;
        }

        const chunk = text.substring(0, splitIdx).trim();
        if (chunk) chunks.push(chunk);
        text = text.substring(splitIdx).trim();
    }
    if (text) chunks.push(text);
    return chunks;
}

function convertMdToTgHtml(text) {
    if (!text) return '';
    // Basic markdown to Telegram HTML conversion
    let s = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

    // Code blocks ```lang\ncode```
    s = s.replace(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g, (match, lang, code) => {
        return `<pre><code>${code}</code></pre>`;
    });

    // Inline code `code`
    s = s.replace(/`([^`]+)`/g, '<code>$1</code>');

    // Bold **text**
    s = s.replace(/\*\*([^\*\r\n]+)\*\*/g, '<b>$1</b>');

    // Italic *text*
    s = s.replace(/(?<!\w)\*([^\*\r\n]+)\*(?!\w)/g, '<i>$1</i>');

    // Blockquote > text
    s = s.replace(/^&gt;\s*([^\r\n]+)/gm, '<blockquote>$1</blockquote>');

    return s;
}

async function sendTelegramMessage(chatId, text, parseMode = 'HTML') {
    if (!text) return null;
    const chunks = splitTelegramText(text, 3500);
    const totalParts = chunks.length;

    for (let i = 0; i < totalParts; i++) {
        let chunkText = chunks[i];
        if (totalParts > 1) {
            chunkText = `<b>[Phần ${i + 1}/${totalParts}]</b>\n` + chunkText;
        }

        const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
        const bodyObj = {
            chat_id: chatId,
            text: chunkText,
            disable_web_page_preview: true
        };
        if (parseMode) bodyObj.parse_mode = parseMode;

        try {
            const resp = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(bodyObj)
            });
            const data = await resp.json();
            if (!data.ok && parseMode) {
                // Fallback to plain text if HTML parsing failed
                delete bodyObj.parse_mode;
                await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(bodyObj)
                });
            }
        } catch (err) {
            console.error('Error sending Telegram message:', err);
        }

        if (totalParts > 1 && i < totalParts - 1) {
            await new Promise(r => setTimeout(r, 150));
        }
    }
}

async function askGeminiText(userText) {
    const sysPrompt = "Bạn là trợ lý lập trình AI siêu cấp QuinloveRin Code trên Telegram hoạt động 24/7 trên Vercel Cloud khi máy tính chính cúp điện hoặc tắt máy. Hãy trả lời chi tiết, chuẩn xác bằng Tiếng Việt có dấu, định dạng Markdown rõ ràng, có tâm và thực chiến. Luôn xưng hô 'tôi - bro', tuyệt đối không dùng 'anh - em'.";
    const models = ['gemini-2.5-flash', 'gemini-flash-latest', 'gemini-flash-lite-latest'];

    for (const model of models) {
        try {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
            const payload = {
                systemInstruction: { parts: [{ text: sysPrompt }] },
                contents: [{ role: 'user', parts: [{ text: userText }] }]
            };

            const resp = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await resp.json();
            if (data.candidates && data.candidates[0]?.content?.parts?.[0]?.text) {
                return data.candidates[0].content.parts[0].text;
            }
        } catch (e) {
            console.error(`Gemini model ${model} error:`, e);
        }
    }
    return 'Cloud AI đang tạm thời bận, bro hãy gửi lại tin nhắn nhé!';
}

async function askGeminiVision(userText, base64Image, mimeType = 'image/jpeg') {
    const sysPrompt = "Bạn là trợ lý lập trình AI siêu cấp QuinloveRin Code có thị giác máy tính (Vision) hoạt động 24/7 trên Vercel Cloud. Hãy quan sát ảnh kỹ lưỡng và giải thích, hướng dẫn bằng Tiếng Việt có dấu chuẩn xác. Xưng hô 'tôi - bro'.";
    const models = ['gemini-2.5-flash', 'gemini-flash-latest', 'gemini-flash-lite-latest'];

    for (const model of models) {
        try {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
            const payload = {
                systemInstruction: { parts: [{ text: sysPrompt }] },
                contents: [{
                    role: 'user',
                    parts: [
                        { text: userText || 'Hãy quan sát bức ảnh này và phân tích chi tiết giúp tôi.' },
                        { inlineData: { mimeType, data: base64Image } }
                    ]
                }]
            };

            const resp = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await resp.json();
            if (data.candidates && data.candidates[0]?.content?.parts?.[0]?.text) {
                return data.candidates[0].content.parts[0].text;
            }
        } catch (e) {
            console.error(`Gemini Vision model ${model} error:`, e);
        }
    }
    return 'Cloud Vision AI đang tạm thời bận, bro hãy gửi lại ảnh nhé!';
}

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(200).send('QuinloveRin Code Telegram Webhook is active 24/7 on Vercel.');
    }

    try {
        const update = req.body;
        if (!update || !update.message) {
            return res.status(200).json({ ok: true });
        }

        const msg = update.message;
        const chatId = String(msg.chat.id);

        // Security check
        if (ALLOWED_CHAT_ID && chatId !== ALLOWED_CHAT_ID) {
            await sendTelegramMessage(chatId, 'Xin lỗi, bạn không có quyền sử dụng Bot này!');
            return res.status(200).json({ ok: true });
        }

        // 1. Xu ly tin nhan /pc -> Chuyen quyen ve may tinh
        if (msg.text === '/pc' || msg.text === '/local') {
            await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/deleteWebhook`);
            await sendTelegramMessage(chatId, '💻 <b>[ĐÃ BÀN GIAO CHO MÁY TÍNH]</b>\nĐã gỡ Webhook Cloud! Máy tính của bro (nếu đang bật) sẽ tiếp nhận tin nhắn trực tiếp qua Long Polling.');
            return res.status(200).json({ ok: true });
        }

        // 2. Xu ly tin nhan /status
        if (msg.text === '/status') {
            const statusMsg = `☁️ <b>[QUINLOVERIN CLOUD 24/7]</b>\n──────────────────────\n• <b>Hạ tầng</b>: Vercel Serverless Global Edge\n• <b>AI Model</b>: Gemini 2.5 Flash\n• <b>Trạng thái</b>: Đang trực tuyến 24/7\n\n<i>Bro có thể chat, sinh code hoặc gửi ảnh thoải mái ngay cả khi máy tính chính tắt hoặc cúp điện!</i>\n\n👉 Khi máy tính chính bật, gõ <code>/pc</code> để chuyển quyền điều khiển máy tính.`;
            await sendTelegramMessage(chatId, statusMsg);
            return res.status(200).json({ ok: true });
        }

        // 3. Xu ly anh (Vision)
        if (msg.photo && msg.photo.length > 0) {
            const largest = msg.photo[msg.photo.length - 1];
            const fileId = largest.file_id;
            const caption = msg.caption ? msg.caption.trim() : 'Hãy quan sát bức ảnh này và phân tích chi tiết giúp tôi.';

            // Bao tin nhan dang xu ly
            await sendTelegramMessage(chatId, `📷 <b>[CLOUD VISION - ĐANG PHÂN TÍCH ẢNH...]</b>\n<blockquote><i>"${caption.slice(0, 100)}"</i></blockquote>`);

            // Lay file path tu Telegram
            const fInfoResp = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${fileId}`);
            const fInfo = await fInfoResp.json();

            if (fInfo.ok && fInfo.result?.file_path) {
                const dlResp = await fetch(`https://api.telegram.org/file/bot${BOT_TOKEN}/${fInfo.result.file_path}`);
                const arrayBuffer = await dlResp.arrayBuffer();
                const base64 = Buffer.from(arrayBuffer).toString('base64');

                const answer = await askGeminiVision(caption, base64, 'image/jpeg');
                const htmlAnswer = convertMdToTgHtml(answer) + '\n\n☁️ <i>[Phản hồi từ QuinloveRin Cloud 24/7]</i>';
                await sendTelegramMessage(chatId, htmlAnswer);
            } else {
                await sendTelegramMessage(chatId, '❌ Không thể tải ảnh từ máy chủ Telegram.');
            }
            return res.status(200).json({ ok: true });
        }

        // 4. Xu ly tin nhan van ban
        if (msg.text) {
            const text = msg.text.trim();

            // Neu la lenh Terminal tren may tinh
            if (text.startsWith('/cmd ') || text.startsWith('/read ') || text === '/ls' || text === '/dir') {
                const notice = `💻 <b>[CHẾ ĐỘ CLOUD 24/7 - MÁY TÍNH ĐANG TẮT]</b>\n──────────────────────\nLệnh Terminal <code>${text}</code> yêu cầu máy tính Windows chính đang bật.\n\nHiện tại bro đang kết nối qua Cloud AI trên Vercel. Khi máy tính chính có điện và bật lại, bro hãy gõ <code>/pc</code> để thực thi trực tiếp trên máy tính nhé!`;
                await sendTelegramMessage(chatId, notice);
                return res.status(200).json({ ok: true });
            }

            // Goi Gemini AI
            const rawAnswer = await askGeminiText(text);
            const formatted = convertMdToTgHtml(rawAnswer) + '\n\n☁️ <i>[Phản hồi từ QuinloveRin Cloud 24/7]</i>';
            await sendTelegramMessage(chatId, formatted);
            return res.status(200).json({ ok: true });
        }

        return res.status(200).json({ ok: true });
    } catch (err) {
        console.error('Webhook error:', err);
        return res.status(200).json({ ok: true, error: err.message });
    }
}
