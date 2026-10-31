// lib/intent.cjs - Intelligent AI Intent Classifier for QuinloveRin Bridge
const fs = require('fs');
const path = require('path');

function getGeminiApiKey() {
    if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
    const keysPath = path.join(__dirname, '..', 'keys.json');
    if (fs.existsSync(keysPath)) {
        try {
            const data = JSON.parse(fs.readFileSync(keysPath, 'utf8'));
            if (data.gemini_api_key) return data.gemini_api_key;
        } catch (e) {}
    }
    return null;
}

const SYSTEM_CLASSIFIER_PROMPT = `Ban la he thong AI phan loai y dinh nguoi dung cho Telegram Bot.
Nhiem vu: Phan loai tin nhan nguoi dung thanh 1 trong 2 loai:
1. "prompt": Khi nguoi dung noi chuyen, hoi dap, lap trinh, giai thich, tam su, phan nan, thac mac, hoi ve loi, yeu cau code, hoac ke chuyen.
   DAC BIET LUU Y: Neu nguoi dung co tu hoi (sao, tai sao, loi, k bat dc, bi gi, sao tat, ...), hoac phan nan ve ung dung thi 100% LA "prompt", TUYET DOI KHONG DUOC phan loai thanh "action"!
   Vi du:
   - "nhung hoi nay toi bat k dc antigravity toi phai xoa di tai" -> {"type":"prompt"}
   - "sao ma antigraviti toi no tat lien tuc vay voi cai may toi dang bi cai gi a?" -> {"type":"prompt"}
   - "loi kha nghiem trong trong tele day toi gui prompt khac khong phai mo antigraviti" -> {"type":"prompt"}
   - "y ban noi bo loc tu khoa qua long leo ma? sao k dung AI de quan?" -> {"type":"prompt"}
   - "alo?", "viet code giup toi", "tai sao loi nay xay ra?", "mo file index.js xem thu" -> {"type":"prompt"}

2. "action": CHI KHI nguoi dung ra menh lenh truc tiep, dut khoat cho bot thuc hien hanh dong tren may tinh (khong co y hoi hay phan nan):
   - "mo youtube" -> {"type":"action", "action":"open_web", "target":"youtube", "browser":"default", "record":false, "screenshot":false}
   - "mo youtube va quay lai" -> {"type":"action", "action":"open_web", "target":"youtube", "browser":"default", "record":true, "record_sec":4, "screenshot":false}
   - "bat antigravity" -> {"type":"action", "action":"focus_antigravity", "screenshot":false}
   - "tat antigravity" / "dong antigravity" -> {"type":"action", "action":"close_app", "target":"antigravity", "screenshot":false}
   - "tat chrome" / "dong trinh duyet" -> {"type":"action", "action":"close_app", "target":"chrome", "screenshot":false}
   - "tat tab youtube" / "dong youtube" -> {"type":"action", "action":"close_app", "target":"youtube", "screenshot":false}
   - "tat discord" / "dong zalo" -> {"type":"action", "action":"close_app", "target":"discord", "screenshot":false}
   - "chup man hinh" -> {"type":"action", "action":"screenshot"}
   - "quay man hinh 5s" -> {"type":"action", "action":"record", "record_sec":5}

QUY TAC AN TOAN:
- "screenshot" CHI DUOC true khi nguoi dung co noi ro tu "chup" hoac "screenshot". Mac dinh luon luon la false!
- "record" CHI DUOC true khi nguoi dung co noi tu "quay". Mac dinh luon luon la false!

Chi tra ve JSON duy nhat hop le:
{
  "type": "prompt" | "action",
  "action": "open_web" | "focus_antigravity" | "close_app" | "screenshot" | "record" | null,
  "target": string | null,
  "browser": "chrome" | "edge" | "brave" | "firefox" | "default" | null,
  "record": boolean,
  "record_sec": number,
  "screenshot": boolean
}`;

function extractJson(str) {
    if (!str) return null;
    const trimmed = str.trim();
    try {
        return JSON.parse(trimmed);
    } catch (e) {}
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (match) {
        try {
            return JSON.parse(match[0]);
        } catch (e) {}
    }
    return null;
}

async function callGeminiClassifier(userText) {
    const key = getGeminiApiKey();
    if (!key) throw new Error("No Gemini API Key available");

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`;
    const payload = {
        system_instruction: {
            parts: [{ text: SYSTEM_CLASSIFIER_PROMPT }]
        },
        contents: [
            {
                role: "user",
                parts: [{ text: userText }]
            }
        ],
        generationConfig: {
            responseMimeType: "application/json",
            maxOutputTokens: 1024,
            temperature: 0.1
        }
    };

    const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(2500)
    });

    if (!resp.ok) throw new Error(`Gemini HTTP ${resp.status}`);
    const data = await resp.json();
    const raw = data.candidates?.[0]?.content?.parts?.[0]?.text;
    const parsed = extractJson(raw);
    if (!parsed) throw new Error("Could not parse JSON from: " + raw);
    return parsed;
}

/**
 * Phan loai y dinh nguoi dung:
 * - Tra ve { type: 'action', ... } neu thuc su la lenh dieu khien PC.
 * - Tra ve { type: 'prompt' } neu la hoi dap / code / tro chuyen.
 */
async function classifyUserIntent(text) {
    const raw = text.trim();
    if (!raw) return { type: 'prompt' };

    // 1. FAST PATH: Slash Commands ro rang 100% (Khong can ton thoi gian goi AI)
    if (/^(?:\/pc|\/connect|\/ketnoi|\/cancel|\/dongtopic|\/dongrepo|\/cloud|ket noi pc|kết nối pc)$/i.test(raw)) {
        return { type: 'prompt' };
    }
    if (/^\/(?:antigravity|app|ide|open_antigravity)$/i.test(raw)) {
        return { type: 'action', action: 'focus_antigravity', screenshot: false };
    }
    if (/^\/(?:close_antigravity|tat_antigravity|kill_antigravity)$/i.test(raw)) {
        return { type: 'action', action: 'close_app', target: 'antigravity', screenshot: false };
    }
    const closeSlash = raw.match(/^\/(?:close|tat|dong|kill|exit)(?:\s+(.+))?$/i);
    if (closeSlash) {
        return { type: 'action', action: 'close_app', target: closeSlash[1] ? closeSlash[1].trim() : 'antigravity', screenshot: false };
    }
    if (/^\/(?:screen|screenshot|snap|chup)$/i.test(raw)) {
        return { type: 'action', action: 'screenshot' };
    }
    const recSlash = raw.match(/^\/(?:record|quay|video)(?:\s+(\d+))?$/i);
    if (recSlash) {
        return { type: 'action', action: 'record', record_sec: parseInt(recSlash[1] || '4', 10) };
    }
    const openSlash = raw.match(/^\/(?:open|web|url|browser)\s+([^\s]+)(?:\s+([^\s]+))?$/i);
    if (openSlash) {
        return {
            type: 'action',
            action: 'open_web',
            target: openSlash[1],
            browser: openSlash[2] || 'default',
            record: false,
            screenshot: false
        };
    }

    // 2. FAST PATH: Chan toan bo cau hoi, phan nan, thac mac hoac prompt dai (> 10 tu hoac co markdown code hoac dau hoi)
    const isQuestionOrComplaint = /[?？]|\b(?:tại sao|sao|vì sao|lỗi|bị gì|thế nào|sao lại|làm sao|không được|k được|ko được|chưa được|không|chưa|k|ko|alo|giải thích|hãy viết|viết code|sửa lỗi|review|kiểm tra|tìm hiểu)\b/i.test(raw);
    if (isQuestionOrComplaint || raw.split(/\s+/).length > 10 || raw.includes('```')) {
        return { type: 'prompt' };
    }

    // 3. AI CLASSIFIER: Nho Gemini Flash phan tich y dinh ngu canh
    try {
        const aiRes = await callGeminiClassifier(raw);
        if (aiRes && (aiRes.type === 'action' || aiRes.type === 'prompt')) {
            // Bao ve chat che: Khong bao gio screenshot/record neu tin nhan khong chua tu khoa chup/quay
            const hasScreenshotWord = /(?:chụp|screenshot|snap|ảnh)/i.test(raw);
            const hasRecordWord = /(?:quay|record|video)/i.test(raw);
            if (!hasScreenshotWord) aiRes.screenshot = false;
            if (!hasRecordWord) aiRes.record = false;

            console.log(`[AI Intent] "${raw}" -> ${aiRes.type} (${aiRes.action || 'chat'})`);
            return aiRes;
        }
    } catch (e) {
        console.warn('[AI Classifier Fallback]:', e.message);
    }

    // 4. FALLBACK AN TOAN (Neu AI classifier mat mang/timeout):
    const isExplicitWeb = raw.match(/^(?:mở|bật)\s+(?:trang\s+|web\s+)?(youtube|facebook|fb|drive|docs|sheets|github|git|chatgpt|zalo)(?:\s+(?:trên|qua)\s+(chrome|edge|brave|firefox))?$/i);
    if (isExplicitWeb) {
        return {
            type: 'action',
            action: 'open_web',
            target: isExplicitWeb[1],
            browser: isExplicitWeb[2] || 'default',
            record: false,
            screenshot: false
        };
    }

    const isExplicitAgy = /^(?:bật|mở|khôi phục)\s+(?:cửa sổ\s+)?(?:antigravity|ide)$/i.test(raw);
    if (isExplicitAgy) {
        return { type: 'action', action: 'focus_antigravity', screenshot: false };
    }

    const isExplicitClose = raw.match(/^(?:tắt|đóng|kill|thoát|dừng)\s+(?:cửa sổ\s+|ứng dụng\s+|app\s+|phần mềm\s+|tab\s+|trang\s+)?(.+)$/i);
    if (isExplicitClose && !isQuestionOrComplaint) {
        return { type: 'action', action: 'close_app', target: isExplicitClose[1].trim(), screenshot: false };
    }

    return { type: 'prompt' };
}

module.exports = {
    classifyUserIntent,
    callGeminiClassifier
};
