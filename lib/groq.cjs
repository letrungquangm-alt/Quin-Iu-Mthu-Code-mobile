// lib/groq.cjs - Groq LPU Super-Fast AI Engine (Qwen 3.8 27B / GPT-OSS 120B)
const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const keysFile = path.join(rootDir, 'keys.json');

let groqKeys = [];

function loadGroqKeys() {
    if (fs.existsSync(keysFile)) {
        try {
            const raw = fs.readFileSync(keysFile, 'utf8');
            const data = JSON.parse(raw);
            if (Array.isArray(data.groq_api_keys) && data.groq_api_keys.length > 0) {
                groqKeys = data.groq_api_keys;
            }
        } catch (e) {}
    }
    if (groqKeys.length === 0 && process.env.GROQ_API_KEY) {
        groqKeys = [process.env.GROQ_API_KEY];
    }
}

loadGroqKeys();

let keyIndex = 0;
function getNextKey() {
    if (groqKeys.length === 0) loadGroqKeys();
    if (groqKeys.length === 0) return null;
    const key = groqKeys[keyIndex % groqKeys.length];
    keyIndex++;
    return key;
}

const SYSTEM_INSTRUCTION = `Bạn là QuinloveRin 3.8, trợ lý lập trình AI siêu cấp và người bạn đồng hành công nghệ của bro (Xưng hô chuẩn mực: "tôi - bro", phong cách tự tin, nhạy bén, chuyên môn cao, thân thiện).
Bạn được hỗ trợ bởi chip Groq LPU siêu tốc với khả năng phản hồi hơn 500 từ/giây.

QUY TẮC BẮT BUỘC:
1. XƯNG HÔ: "tôi - bro" trong mọi trường hợp. Tuyệt đối không dùng "anh - em" hay "anh yêu".
2. TÁC VỤ BẠN TỰ XỬ LÝ (MIỄN PHÍ TRỰC TIẾP TRÊN GROQ LPU):
   - Mở website, ứng dụng, YouTube, Facebook, Drive, Docs...
   - Quay video màn hình PC thực tế, chụp ảnh màn hình desktop.
   - Cài đặt trình duyệt (Chrome, Brave, Firefox...) vào ổ đĩa bất kỳ (ổ D, C...) qua winget.
   - Giải đáp lập trình, viết mã nguồn, gỡ lỗi, tối ưu giải thuật.
   - Khi có yêu cầu tạo file / commit code lên GitHub:
     Bọc toàn bộ mã nguồn hoàn chỉnh vào cú pháp commit:
     \`\`\`commit:<đường_dẫn_file>
     <toàn bộ mã nguồn code không lược bớt>
     \`\`\`
   - Khi có yêu cầu thực thi trên PC, xuất thẻ ACTION tương ứng ở cuối câu trả lời:
     [ACTION: {"action": "open_web", "target": "https://www.youtube.com", "browser": "default", "record": 4}]
     [ACTION: {"action": "focus_antigravity"}]
     [ACTION: {"action": "screenshot"}]
     [ACTION: {"action": "record", "sec": 5}]
     [ACTION: {"action": "install_browser", "target": "chrome", "drive": "D"}]

3. TỰ ĐỘNG CHUYỂN GIAO THÔNG MINH (AUTONOMOUS ESCALATION):
   - Nếu phát hiện bài toán toán học/thuật toán tiến sĩ hoặc tái cấu trúc enterprise đa repo vượt ngưỡng, hãy xuất dòng sau:
     [ESCALATE_TO_GEMINI]
`;

/**
 * Gọi Groq API với cơ chế tự động xoay vòng key khi gặp 429
 */
async function askGroq(userPrompt, conversationHistory = []) {
    if (groqKeys.length === 0) loadGroqKeys();
    if (groqKeys.length === 0) {
        return { ok: false, error: 'Chưa cấu hình GROQ API KEY' };
    }

    const models = ['qwen/qwen3.8-27b', 'openai/gpt-oss-120b'];
    const messages = [{ role: 'system', content: SYSTEM_INSTRUCTION }];

    if (Array.isArray(conversationHistory)) {
        for (const turn of conversationHistory.slice(-6)) {
            if (turn.role && turn.content) {
                messages.push({
                    role: turn.role === 'model' ? 'assistant' : turn.role,
                    content: turn.content
                });
            }
        }
    }

    messages.push({ role: 'user', content: userPrompt });

    let attempts = 0;
    const maxAttempts = groqKeys.length * models.length;

    for (const model of models) {
        for (let i = 0; i < groqKeys.length; i++) {
            attempts++;
            const apiKey = getNextKey();
            const startTime = Date.now();

            try {
                const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Authorization': 'Bearer ' + apiKey,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        model: model,
                        messages: messages,
                        temperature: 0.7,
                        max_tokens: 2048
                    })
                });

                if (res.status === 429) {
                    console.warn(`[Groq Rate Limit] Key ${apiKey.substring(0, 10)}... chạm giới hạn, tự xoay key tiếp theo...`);
                    continue;
                }

                if (res.status === 200) {
                    const data = await res.json();
                    if (data.choices && data.choices[0]) {
                        const content = data.choices[0].message.content.trim();
                        const durationMs = Date.now() - startTime;
                        const tps = data.usage ? Math.round(data.usage.completion_tokens / (durationMs / 1000)) : 500;
                        return {
                            ok: true,
                            content: content,
                            model: model,
                            durationMs: durationMs,
                            tps: tps,
                            escalate: content.includes('[ESCALATE_TO_GEMINI]')
                        };
                    }
                }
            } catch (e) {
                console.error(`[Groq Error]:`, e.message);
            }
        }
    }

    return { ok: false, error: 'Toàn bộ Groq keys đều bận hoặc hết hạn mức' };
}

module.exports = {
    askGroq,
    loadGroqKeys
};
