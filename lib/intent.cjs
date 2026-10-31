// lib/intent.cjs - Strict & Deterministic Intent Classifier for QuinloveRin Bridge
// Quy tắc vàng: Phân biệt triệt để Prompt và Lệnh hệ thống.
// Tuyệt đối không để AI đoán bừa gây tắt ứng dụng hoặc chụp ảnh ngoài ý muốn!

const fs = require('fs');
const path = require('path');

/**
 * Kiểm tra xem một tin nhắn có phải là Prompt đàm thoại / câu hỏi / giải thích hay không.
 */
function isConversationalPrompt(text) {
    const clean = (text || '').trim();
    if (!clean) return false;

    // Các cụm từ lệnh ngắn chuẩn xác 100% không bao giờ là conversational prompt:
    const lower = clean.toLowerCase();
    if (/^(?:\/pc|\/connect|\/ketnoi|\/cancel|\/dongtopic|\/dongrepo|\/cloud|ket noi pc|kết nối pc)$/i.test(lower)) return false;
    if (/^(?:\/screen|\/screenshot|\/snap|\/chup|chụp màn hình|chup man hinh)$/i.test(lower)) return false;
    if (/^(?:\/antigravity|\/app|\/ide|\/open_antigravity|bật antigravity|mở antigravity|bat antigravity|mo antigravity)$/i.test(lower)) return false;
    if (/^(?:\/close_antigravity|\/tat_antigravity|\/kill_antigravity|tắt antigravity|đóng antigravity|tat antigravity|dong antigravity)$/i.test(lower)) return false;
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

    // 1. NẾU LÀ PROMPT ĐÀM THOẠI -> TRẢ VỀ PROMPT NGAY LẬP TỨC
    if (isConversationalPrompt(raw)) {
        return { type: 'prompt' };
    }

    const lower = raw.toLowerCase();

    // 2. CÁC SLASH COMMAND ĐỘC LẬP DÀNH CHO FLOW KẾT NỐI (Chuyển sang module xử lý /pc riêng)
    if (/^(?:\/pc|\/connect|\/ketnoi|\/cancel|\/dongtopic|\/dongrepo|\/cloud|ket noi pc|kết nối pc)$/i.test(lower)) {
        return { type: 'prompt' };
    }

    // 3. LỆNH MỞ / ĐƯA CỬA SỔ ANTIGRAVITY LÊN TRÊN:
    // Cú pháp: /antigravity, /app, /ide, /open_antigravity HOẶC "bật antigravity", "mở antigravity"
    if (/^\/(?:antigravity|app|ide|open_antigravity)$/i.test(lower) ||
        /^(?:bật|mở|bat|mo)\s+(?:antigravity|ide)$/i.test(lower)) {
        return { type: 'action', action: 'focus_antigravity', screenshot: false };
    }

    // 4. LỆNH ĐÓNG ANTIGRAVITY (AN TOÀN - CHỈ KHI GÕ CHÍNH XÁC):
    // Cú pháp: /tat_antigravity, /close_antigravity HOẶC "tắt antigravity", "đóng antigravity"
    if (/^\/(?:close_antigravity|tat_antigravity|kill_antigravity)$/i.test(lower) ||
        /^(?:tắt|đóng|tat|dong)\s+antigravity$/i.test(lower)) {
        return { type: 'action', action: 'close_app', target: 'antigravity', screenshot: false };
    }

    // 5. LỆNH ĐÓNG ỨNG DỤNG / TIẾN TRÌNH KHÁC:
    // Cú pháp: /close <tên>, /tat <tên>, /kill <tên>
    const closeMatch = raw.match(/^\/(?:close|tat|dong|kill)\s+([a-zA-Z0-9_\-\.]+)$/i);
    if (closeMatch) {
        return { type: 'action', action: 'close_app', target: closeMatch[1].trim(), screenshot: false };
    }

    // 6. LỆNH CHỤP ẢNH MÀN HÌNH (CHỈ KHI CÓ LỆNH RÕ RÀNG):
    // Cú pháp: /screen, /screenshot, /snap, /chup HOẶC "chụp màn hình", "chup man hinh"
    if (/^\/(?:screen|screenshot|snap|chup)$/i.test(lower) ||
        /^(?:chụp|chup)\s+(?:màn\s+hình|man\s+hinh)$/i.test(lower)) {
        return { type: 'action', action: 'screenshot' };
    }

    // 7. LỆNH QUAY VIDEO MÀN HÌNH:
    // Cú pháp: /record <giây>, /quay <giây> HOẶC "quay màn hình"
    const recMatch = raw.match(/^\/(?:record|quay|video)(?:\s+(\d+))?$/i);
    if (recMatch) {
        return { type: 'action', action: 'record', record_sec: parseInt(recMatch[1] || '4', 10) };
    }
    if (/^(?:quay|quay\s+video)\s+(?:màn\s+hình|man\s+hinh)$/i.test(lower)) {
        return { type: 'action', action: 'record', record_sec: 4 };
    }

    // 8. LỆNH TẮT NGUỒN PC (REMOTE SHUTDOWN):
    // Cú pháp: /shutdown, /tatmay, /tat_pc HOẶC "tắt máy", "tat may", "tắt máy tính"
    if (/^\/(?:shutdown|tatmay|tat_pc|tat_may)$/i.test(lower) ||
        /^(?:tắt|tat)\s+(?:máy|may|máy\s+tính|may\s+tinh|pc|nguồn|nguon)(?:\s+(?:đi|nhe|nhé|nha|thôi|thoi|giúp|giup|hộ|ho)?(?:\s+(?:bro|bạn|ban|ad|em))?)?$/i.test(lower)) {
        return { type: 'action', action: 'shutdown_pc', screenshot: false };
    }

    // 9. LỆNH HỦY TẮT MÁY:
    if (/^\/(?:cancel_shutdown|huy_tat_may|huy_shutdown)$/i.test(lower) ||
        /^(?:hủy|huy|đừng|dung)\s+(?:tắt\s+máy|tat\s+may|shutdown)$/i.test(lower)) {
        return { type: 'action', action: 'cancel_shutdown', screenshot: false };
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
