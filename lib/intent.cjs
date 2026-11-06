// lib/intent.cjs - Strict & Deterministic Intent Classifier for QuinloveRin Bridge
// Quy tắc vàng: Phân biệt triệt để Prompt và Lệnh hệ thống.
// Tuyệt đối không để AI đoán bừa gây tắt ứng dụng hoặc chụp ảnh ngoài ý muốn!

const fs = require('fs');
const path = require('path');

function stripQuotesAndCodeBlocks(text) {
    if (!text) return '';
    return text
        .replace(/"""[\s\S]*?"""/g, ' ') // Loại bỏ khối trích dẫn ba nháy """ ... """
        .replace(/```[\s\S]*?```/g, ' ') // Loại bỏ code block
        .replace(/`[^`\r\n]+`/g, ' ')     // Loại bỏ inline code
        .replace(/“[^”]+”/g, ' ')         // Loại bỏ ngoặc kép Việt
        .trim();
}

/**
 * Kiểm tra xem một tin nhắn có phải là Prompt đàm thoại / câu hỏi / giải thích hay không.
 * QUY TẮC BẢO VỆ: Bất kỳ nội dung nào nằm trong """ ... """ đều là trích dẫn, KHÔNG BAO GIỜ coi là lệnh!
 */
function isConversationalPrompt(text) {
    const raw = (text || '').trim();
    if (!raw) return false;

    // 0. Nếu chứa khối trích dẫn ba nháy """ ... """ hoặc code block -> 100% là PROMPT trích dẫn!
    if (/"""[\s\S]*?"""/.test(raw) || /```[\s\S]*?```/.test(raw)) {
        return true;
    }

    const clean = stripQuotesAndCodeBlocks(raw);
    if (!clean) return true; // Toàn bộ tin nhắn nằm trong trích dẫn -> 100% Prompt

    // Các cụm từ lệnh ngắn & câu nói tự nhiên điều khiển hệ thống (không phải conversational prompt):
    const lower = clean.toLowerCase();
    if (/^(?:\/pc|\/connect|\/ketnoi|\/cancel|\/dongtopic|\/dongrepo|\/cloud|ket noi pc|kết nối pc)$/i.test(lower)) return false;
    if (/^(?:\/disconnect|\/ngatketnoi|\/cloud|(?:ngắt|ngat)\s+kết\s+nối|(?:chuyển|chuyen)\s+(?:sang|qua)?\s*cloud|(?:bàn\s+giao|ban\s+giao)\s+(?:cho\s+)?cloud)(?:\s+(?:đi|nhe|nhé|nha|giúp|hộ))?$/i.test(lower)) return false;
    if (/^(?:\/screen|\/screenshot|\/snap|\/chup|chụp màn hình|chup man hinh)$/i.test(lower)) return false;
    if (/^(?:\/antigravity|\/app|\/ide|\/open_antigravity|bật antigravity|mở antigravity|bat antigravity|mo antigravity)$/i.test(lower)) return false;
    if (/^(?:\/close_antigravity|\/tat_antigravity|\/kill_antigravity|(?:tắt|đóng|tat|dong)\s+(?:antigravity|ide|app\s+antigravity))(?:\s+(?:đi|nhe|nhé|nha|giúp|hộ))?$/i.test(lower)) return false;
    if (/^(?:\/shutdown|\/tatmay|\/tat_pc|\/tat_may|(?:tắt|tat)\s+(?:máy|may|máy\s+tính|may\s+tinh|pc|nguồn|nguon)(?:\s+(?:đi|nhe|nhé|nha|thôi|thoi|giúp|giup|hộ|ho)?(?:\s+(?:bro|bạn|ban|ad|em))?)?)$/i.test(lower)) return false;
    if (/^(?:\/cancel_shutdown|\/huy_tat_may|\/huy_shutdown|(?:hủy|huy|đừng|dung)\s+(?:tắt|tat)\s+(?:máy|may)(?:\s+(?:đi|nhe|nhé|nha|bro))?)$/i.test(lower)) return false;

    // 1. Có dấu hỏi hoặc dấu xuống dòng hoặc code markdown -> 100% Prompt
    if (/[?？]/.test(clean)) return true;
    if (clean.includes('\n') || clean.includes('```')) return true;

    // 2. Chứa các từ khóa đàm thoại, hỏi đáp, phàn nàn, lập trình
    const promptKeywords = /(?:sao|tại sao|tai sao|vì sao|vi sao|thế nào|the nao|làm sao|lam sao|lỗi|loi|bị gì|bi gi|sao lại|sao lai|được k|duoc k|được không|duoc khong|vậy|vay|hả|ha|à|nhỉ|nhi|hỏi|hoi|như v|nhu v|như vậy|nhu vay|chưa|chua|không được|khong duoc|k được|k duoc|ko được|ko duoc|chỉ hiện|chi hien|làm gì có|lam gi co|giúp|giup|viết|viet|sửa|sua|chạy|chay|bị|bi|ý tôi là|y toi la|này đang|nay dang|vấn đề|van de|alo|giải thích|giai thich|kiểm tra|kiem tra|tìm hiểu|tim hieu|nếu|neu|tôi kêu|toi keu|nhìn lên|nhin len|tôi vừa|toi vua|test đồ|thành công|thanh cong|mở node|mo node|tắt liên tục|tat lien tuc|không yêu cầu|khong yeu cau|nghiêm trọng|nghiem trong|phân biệt|phan biet|kích hoạt|kich hoat)/i;
    if (promptKeywords.test(clean)) {
        return true;
    }

    // 3. Nếu không bắt đầu bằng '/' và có trên 3 từ -> 100% Prompt
    const words = clean.split(/\s+/);
    if (!clean.startsWith('/') && words.length > 3) {
        return true;
    }

    return false;
}

/**
 * Phân loại ý định người dùng một cách chuẩn xác 100%:
 * - Trả về { type: 'action', action: ..., ... } CHỈ KHI là lệnh rõ ràng, dứt khoát.
 * - Trả về { type: 'prompt' } cho mọi câu chat, câu hỏi, hoặc prompt đàm thoại.
 */
function classifyUserIntent(text) {
    const raw = (text || '').trim();
    if (!raw) return { type: 'prompt' };

    // 0. BẢO VỆ TRÍCH DẪN: Nếu chứa khối """ ... """ thì 100% là Prompt tham khảo, tuyệt đối không coi là Lệnh!
    if (/"""[\s\S]*?"""/.test(raw) || /```[\s\S]*?```/.test(raw) || isConversationalPrompt(raw)) {
        return { type: 'prompt' };
    }

    const lower = raw.toLowerCase();

    // 2. CÁC SLASH COMMAND ĐỘC LẬP DÀNH CHO FLOW KẾT NỐI (Chuyển sang module xử lý /pc riêng)
    if (/^(?:\/pc|\/connect|\/ketnoi|\/cancel|\/dongtopic|\/dongrepo|\/cloud|ket noi pc|kết nối pc)$/i.test(lower)) {
        return { type: 'prompt' };
    }

    // 3. LỆNH MỞ / ĐƯA CỬA SỔ ANTIGRAVITY LÊN TRÊN:
    if (/^\/(?:antigravity|app|ide|open_antigravity)$/i.test(lower) ||
        /^(?:bật|mở|bat|mo)\s+(?:antigravity|ide)$/i.test(lower)) {
        return { type: 'action', action: 'focus_antigravity', name: 'Mở ứng dụng Antigravity trên PC', screenshot: false };
    }

    // 3b. LỆNH NGẮT KẾT NỐI / BÀN GIAO CLOUD 24/7:
    if (/^\/(?:disconnect|ngatketnoi|cloud)$/i.test(lower) ||
        /^(?:ngắt|ngat)\s+kết\s+nối(?:\s+(?:pc|máy|may|đi|nhe|nhé|nha))?$/i.test(lower) ||
        /^(?:chuyển|chuyen)\s+(?:sang|qua)?\s*cloud(?:\s+(?:đi|nhe|nhé|nha))?$/i.test(lower) ||
        /^(?:bàn\s+giao|ban\s+giao)\s+(?:cho\s+)?cloud(?:\s+(?:đi|nhe|nhé|nha))?$/i.test(lower)) {
        return { type: 'action', action: 'disconnect_cloud', name: 'Ngắt kết nối PC & Bàn giao Cloud 24/7' };
    }

    // 4. LỆNH ĐÓNG ANTIGRAVITY (HỎI XÁC NHẬN BẰNG 2 EMOJI):
    if (/^\/(?:close_antigravity|tat_antigravity|kill_antigravity)$/i.test(lower) ||
        /^(?:tắt|đóng|tat|dong)\s+(?:antigravity|ide|app\s+antigravity)(?:\s+(?:đi|nhe|nhé|nha|giúp|hộ))?$/i.test(lower)) {
        return { type: 'action', action: 'close_app', target: 'antigravity', name: 'Đóng ứng dụng Antigravity & Bàn giao Cloud 24/7', screenshot: false };
    }

    // 5. LỆNH ĐÓNG ỨNG DỤNG / TIẾN TRÌNH KHÁC:
    const closeMatch = raw.match(/^\/(?:close|tat|dong|kill)\s+([a-zA-Z0-9_\-\.]+)$/i);
    if (closeMatch) {
        return { type: 'action', action: 'close_app', target: closeMatch[1].trim(), name: `Đóng ứng dụng ${closeMatch[1].trim()}`, screenshot: false };
    }
    const closeAppMatch = raw.match(/^(?:đóng|tắt|dong|tat)\s+(?:ứng\s+dụng|app|tiến\s+trình|cửa\s+sổ)?\s*([a-zA-Z0-9_\-\.]+)(?:\s+(?:đi|nhe|nhé|nha|giúp|hộ))?$/i);
    if (closeAppMatch) {
        const target = closeAppMatch[1].trim();
        const isAntigravity = /^(?:antigravity|agy|ide)$/i.test(target);
        return {
            type: 'action',
            action: 'close_app',
            target: isAntigravity ? 'antigravity' : target,
            name: isAntigravity ? 'Đóng ứng dụng Antigravity & Bàn giao Cloud 24/7' : `Đóng ứng dụng ${target}`,
            screenshot: false
        };
    }

    // 6. LỆNH CHỤP ẢNH MÀN HÌNH:
    if (/^\/(?:screen|screenshot|snap|chup)$/i.test(lower) ||
        /^(?:chụp|chup)\s+(?:màn\s+hình|man\s+hinh)(?:\s+(?:máy|may|máy\s+tính|pc|đi|nhe|nhé|nha|giúp|hộ))?$/i.test(lower)) {
        return { type: 'action', action: 'screenshot', name: 'Chụp ảnh màn hình máy tính' };
    }

    // 7. LỆNH QUAY VIDEO MÀN HÌNH:
    const recMatch = raw.match(/^\/(?:record|quay|video)(?:\s+(\d+))?$/i);
    if (recMatch) {
        return { type: 'action', action: 'record', record_sec: parseInt(recMatch[1] || '4', 10), name: 'Quay video màn hình PC' };
    }
    if (/^(?:quay|quay\s+video)\s+(?:màn\s+hình|man\s+hinh)$/i.test(lower)) {
        return { type: 'action', action: 'record', record_sec: 4, name: 'Quay video màn hình PC' };
    }

    // 8. LỆNH TẮT NGUỒN PC (HỎI XÁC NHẬN BẰNG 2 EMOJI):
    if (/^\/(?:shutdown|tatmay|tat_pc|tat_may)$/i.test(lower) ||
        /^(?:tắt|tat)\s+(?:máy|may|máy\s+tính|may\s+tinh|pc|nguồn|nguon)(?:\s+(?:đi|nhe|nhé|nha|thôi|thoi|giúp|giup|hộ|ho)?(?:\s+(?:bro|bạn|ban|ad|em))?)?$/i.test(lower)) {
        return { type: 'action', action: 'shutdown_pc', name: 'Tắt nguồn máy tính PC (Shutdown)', screenshot: false };
    }

    // 9. LỆNH HỦY TẮT MÁY (THỰC THI NGAY KHÔNG CẦN HỎI):
    if (/^\/(?:cancel_shutdown|huy_tat_may|huy_shutdown)$/i.test(lower) ||
        /^(?:hủy|huy|đừng|dung)\s+(?:tắt\s+máy|tat\s+may|shutdown)$/i.test(lower)) {
        return { type: 'action', action: 'cancel_shutdown', name: 'Hủy lệnh tắt máy', screenshot: false };
    }

    // 10. LỆNH MỞ WEB / TRÌNH DUYỆT:
    // Cú pháp: /open <url>, /web <url>
    const openMatch = raw.match(/^\/(?:open|web|url|browser)\s+([^\s]+)(?:\s+([^\s]+))?$/i);
    if (openMatch) {
        return {
            type: 'action',
            action: 'open_web',
            target: openMatch[1],
            browser: openMatch[2] || 'default',
            record: false,
            screenshot: false
        };
    }

    // Mở web dạng câu ngắn dứt khoát: "mở youtube", "mở facebook", "mở github"
    const webShortMatch = raw.match(/^(?:mở|bật|mo|bat)\s+(youtube|facebook|fb|github|git|chatgpt|drive|docs|sheets|zalo)(?:\s+(?:trên|qua)\s+(chrome|edge|brave|firefox))?$/i);
    if (webShortMatch) {
        return {
            type: 'action',
            action: 'open_web',
            target: webShortMatch[1],
            browser: webShortMatch[2] || 'default',
            record: false,
            screenshot: false
        };
    }

    // MỌI TRƯỜNG HỢP CÒN LẠI ĐỀU LÀ PROMPT AN TOÀN!
    return { type: 'prompt' };
}

module.exports = {
    classifyUserIntent,
    isConversationalPrompt
};
