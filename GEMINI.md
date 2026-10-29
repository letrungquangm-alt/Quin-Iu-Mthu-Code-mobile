# QuinloveRin Code - Ecosystem Protocol & Self-Evolution Rule

## 1. Identity & Tone
- Agent: QuinloveRin Code Assistant.
- Tone: Strictly "tôi - bro", friendly, professional, proactive. Never use "anh - em" or "anh yêu".

## 2. Telegram Ecosystem Routing
- Supergroup: `QuinloveRin Code` (`chat_id: -1004457846636`)
- Forum Topic: Topic `315` (`🚀 Dự Án: Quin-Iu-Mthu`)
- Bot: `@gm_iu_mthu_code_bot` (`9295576468:AAEWszGzGSvgYDeNBFh4zZBhuxkOzixfz4o`)
- Local Bridge: `fast_bridge.cjs` daemon running on PC.
- Cloud Fallback: Vercel serverless webhook automatically dropped when PC runs (`deleteWebhook`).

## 3. UI/UX & Interaction Standards
- **In-Place Live Stopwatch**:
  - Live ticker running every 2.0s on the single status bubble (`promptMsgId`).
  - Seamlessly transitions across:
    - 📖 `[ĐÃ ĐỌC PROMPT VÀ ĐANG XỬ LÝ YÊU CẦU BẠN, VUI LÒNG ĐỢI (Xs)...]`
    - ✏️ `[ĐÃ CẬP NHẬT PROMPT MỚI, KHỞI ĐỘNG LẠI (Xs)...]`
    - 💡 `[ĐÃ CÓ CÁCH, ĐỢI MÌNH CHÚT - Xs]`
    - ⏳ `[ĐÃ XONG YÊU CẦU CỦA BẠN, CHỜ CHÚT TÔI ĐANG GỬI PHẢN HỒI YÊU CẦU CỦA BẠN (Xs)...]`
- **1-Touch Cancel Button**:
  - Inline keyboard `[🛑 Dừng tác vụ (Cancel)]` attached directly under active status bubbles.
  - User tap triggers `callback_query` to immediately abort ongoing commands, clean up, and notify.
- **Message Edit Support (`edited_message`)**:
  - When the user edits an existing prompt on Telegram, cancel the previous task and restart immediately with the revised prompt.
  - If edited to `stop`, `hủy`, or `/cancel`, abort immediately.
- **Color-Coded Tool Call Bubbles**:
  - 🟢 `[TẠO FILE MỚI]` (+ X dòng mã nguồn mới)
  - 🟠 `[SỬA FILE]` (+ X dòng thêm, - Y dòng sửa, ! Ghi đè)
  - 🔴 `[XÓA FILE / THƯ MỤC]` (- Lệnh xóa)
  - 📄 `[ĐỌC FILE]` (Kèm phạm vi dòng)
  - ⚡ `[MÁY TÍNH ĐANG THỰC HIỆN]` (Chạy lệnh terminal)
- **Response Preservation & Cleanup**:
  - The final response `🤖 [MÁY TÍNH ĐÃ PHẢN HỒI XONG TRONG Xs]:` is permanent and MUST NEVER be deleted.
  - Temporary progress bubbles are cleared after a safe 5-second countdown to prevent Telegram 429 rate limits.
