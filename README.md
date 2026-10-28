# Telegram Remote Coder

Công cụ điều khiển và chạy lệnh code từ xa trên máy tính thông qua Telegram (sử dụng điện thoại).

---

## 🚀 Hướng dẫn kích hoạt cực nhanh (3 bước)

### Bước 1: Tạo Bot Telegram
1. Mở ứng dụng Telegram trên điện thoại, tìm bot `@BotFather`.
2. Gửi lệnh `/newbot` và đặt tên cho bot.
3. `@BotFather` sẽ gửi cho bạn một chuỗi **HTTP API Token** (dạng: `123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ`).

### Bước 2: Điền Token vào file cấu hình
1. Mở file [config.json](file:///C:/Users/Administrator/.gemini/antigravity/scratch/telegram-remote-coder/config.json).
2. Dán token của bạn vào `BOT_TOKEN`.
*(Mục `ALLOWED_CHAT_ID` bạn có thể để nguyên là `0`, bot sẽ tự động nhận diện và khóa bảo mật theo tài khoản Telegram đầu tiên nhắn tin vào).*

### Bước 3: Chạy bot
- Nhấp đúp chuột vào file [start.bat](file:///C:/Users/Administrator/.gemini/antigravity/scratch/telegram-remote-coder/start.bat).
- Mở Telegram trên điện thoại, tìm bot của bạn và bấm `/start`!

---

## 📱 Các lệnh điều khiển từ điện thoại

| Lệnh | Ý nghĩa | Ví dụ |
| :--- | :--- | :--- |
| `/pwd` | Xem thư mục hiện tại | `/pwd` |
| `/cd <thư mục>` | Đổi thư mục làm việc | `/cd D:\Projects\MyProject` |
| `/ls` hoặc `/dir` | Xem danh sách file | `/ls` |
| `/read <tên file>` | Đọc nội dung file code | `/read server.py` |
| `/cmd <câu lệnh>` | Chạy lệnh Terminal bất kỳ | `/cmd git status` hoặc `/cmd python test.py` |
| `<câu lệnh>` | Gõ trực tiếp không cần `/cmd` | `git pull origin main` |

---

## 🔒 Bảo mật
- Bot có cơ chế bảo vệ danh tính: chỉ duy nhất tài khoản Telegram của bạn mới có quyền thực thi lệnh trên máy tính. Bất kỳ ai khác nhắn tin vào bot sẽ bị từ chối truy cập ngay lập tức.
