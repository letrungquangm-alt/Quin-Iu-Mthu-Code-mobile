// src/worker.js - QuinloveRin 3.8 24/7 Cloudflare Worker
// Interactive Net PC Handshake & Dual-Auth Admin System & TeleCloud Virtual Repo
import { gunzipSync } from "node:zlib";

function escapeHtml(str) {
    if (!str) return "";
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function fromHex(hex) {
    let str = "";
    for (let i = 0; i < hex.length; i += 2) {
        str += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
    }
    return str;
}

const DEFAULT_BOT_TOKEN = fromHex("393239353537363436383a414145446b7832735a427a667847536e4f4d46707276687748494f513470445f786d51");
const BOT_2_TOKEN = "9071172098:AAGv73GInLFd5eIdI6rzw5gmWEfKCcouLJc";
const BOT_3_TOKEN = "9061913738:AAFLW7cMTUT1jNtF6ZDu5K1DpQUZ4I8kpEM";
const ADMIN_USER_ID = 2029333412;
const SUPERGROUP_ID = "-1004457846636";
const PROJECT_TOPIC_ID = 1160;
const MASTER_PASSWORD = "270927-260626-ltqlovepmt";
const PROJECT_PIN = "2726";

const DEFAULT_GH_TOKEN = fromHex("6768705f5874306d7469624977677641346e4c3639354937314643526669396c53783347376b324d");
const DEFAULT_GROQ_KEYS = JSON.parse(fromHex("5b2267736b5f4b3077423264724d627775466771775550454b7757476479623346597563306647317379464951576b3749326e646d6838326e79222c2267736b5f7643646d556c6a583945776a556470466f6f363457476479623346594c456657534771374e4b7a556c4a7a35396f6344706c6652222c2267736b5f786f62576f563336766b41577959353647654d3457476479623346596a56366c6d41676f754b735963566d7350384a45546e6b58222c2267736b5f6e69537472577655316a427763776353434d4b5557476479623346594c47504737667a4c715579795137393357624a71436f5065222c2267736b5f4d41366238564f37466f71616931436274427559574764796233465974356d6b5674527a786f64766450354f725637746463674f222c2267736b5f446b736b794b5a3556556955596c76714631544857476479623346595055505050666175616d666a774f536764304e4a467a4d6a222c2267736b5f4e596f67765a5948594c6e61374b45377732343457476479623346596d36774c4d49653656423847797143365863425149355142225d"));
const DEFAULT_GEMINI_KEYS = JSON.parse(fromHex("5b2241512e416238524e364c5f524e75776664764a6a51784f635833476631304f54362d67697951723248484b72384c39377a78356a41222c2241512e416238524e364a30384662676839304951496c6a53493730337846507330546435594479726b49485a784273526345575a41222c2241512e416238524e364c5a4f474c43386359634e34446c634e74464b78763478627a6f41537656746661384d5a57674a5432514f51222c2241512e416238524e364a6a465f7958684d49446b766b4b78487a6d6579766241525f6772763257577357714b4e565a4e784c467767222c2241512e416238524e364a4f75637467545f7852616861545231535f454b71746b50645a726a465734306a654644415957334e524977222c2241512e416238524e364a6632622d6957654e58584a706b5431785a713630365a2d55766e5a4c363831654349375663325453673467225d"));

// Hàng đợi đăng ký máy net: cmdCode -> { hostname, drive, time, teleCode, dmBotToken, dmMsgId }
let netRegistrations = new Map();

// Hàng đợi lệnh điều khiển PC từ xa (Shutdown / Close App / Wake PC):
let pendingPcCommands = [];

// Danh sách dự án đã đăng ký động từ PC (Đồng bộ đa máy, đa cửa sổ):
let registeredProjects = [];

// Trạng thái Admin xác thực kép tại Sảnh: userId -> { step: 'AWAIT_PIN' | 'AWAIT_PASS' | 'AWAIT_PC_PIN', enteredPin: false, enteredPass: false }
let adminAuthStates = new Map();

// 🧠 Ký ức ngữ cảnh Repo & Lịch sử hội thoại của từng Topic (Chia sẻ từ PC sang Cloud 24/7)
let topicMemory = new Map();

// ⏳ Hàng đợi xử lý tuần tự (FIFO Queue) trên Cloud cho từng Topic
let topicQueues = new Map();
let topicQueueLengths = new Map();

// 📦 TeleCloud Virtual Repo Store: threadId -> { fileId, repo, files: Map/Object, fileTree: [], updatedAt }
let teleCloudStores = new Map();

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

function findProjectByPin(inputPin, threadId) {
    const pin = String(inputPin || '').trim();
    if (!pin) return null;

    // 1. Kiểm tra trong topicMemory của topic hiện tại
    if (threadId && topicMemory.has(Number(threadId))) {
        const mem = topicMemory.get(Number(threadId));
        if (mem && String(mem.pin) === pin) {
            return { topicId: Number(threadId), name: mem.repo, path: mem.path, pin: mem.pin };
        }
    }

    // 2. Tìm kiếm trong tất cả topicMemory
    for (const [tId, mem] of topicMemory.entries()) {
        if (String(mem.pin) === pin) {
            return { topicId: tId, name: mem.repo, path: mem.path, pin: mem.pin };
        }
    }

    // 3. Tìm kiếm trong danh sách dự án động đã đăng ký (registeredProjects)
    if (Array.isArray(registeredProjects)) {
        const found = registeredProjects.find(p => String(p.pin) === pin || (threadId && Number(p.topicId) === Number(threadId) && String(p.pin) === pin));
        if (found) {
            return { topicId: Number(found.topicId) || Number(threadId) || PROJECT_TOPIC_ID, name: found.name, path: found.path, pin: found.pin };
        }
    }

    // 4. Mã PIN mặc định / Master PIN của dự án chính
    if (pin === "2726" || pin === "6585") {
        return {
            topicId: Number(threadId) || PROJECT_TOPIC_ID,
            pin: pin,
            path: "G:\\MThu Mobile Code",
            name: "MThu-Mobile-Code"
        };
    }

    return null;
}

const SYSTEM_INSTRUCTION = `Bạn là QuinloveRin 3.8, trợ lý lập trình AI siêu cấp hoạt động 24/7 trên Cloudflare Worker & Groq LPU.
Quy tắc:
1. Xưng hô: "tôi - bro", thân thiện, nhạy bén, công nghệ cao, thấu hiểu. Tuyệt đối không dùng "anh - em" hay "anh yêu".
2. BỘ TỪ ĐIỂN TRI THỨC DỰ ÁN QUINLOVERIN CODE (BẮT BUỘC NẮM RÕ):
- "TeleCloud" (nay đã đổi tên thành "GMCloud Storage"): Là hệ thống lưu trữ mã nguồn ảo vĩnh cửu độc quyền của dự án chúng ta. Toàn bộ 77 files mã nguồn của dự án được đóng gói nén Gzip và lưu trữ trực tiếp trên Topic # (General Topic) của Telegram qua Telegram Bot Object Storage. Dữ liệu tại Topic # không bao giờ bị mất kể cả khi đóng topic dự án. Bảo mật mở khóa bằng Mã PIN dự án 2726.
- "GMCloud": Tên gọi chính thức mới của TeleCloud. Mọi file lưu trữ, snapshot code, backup đều nằm ở Topic # (General Topic: ☁️ Kho GMCloud Storage).
- "Cửa sổ dự án hiện tại": Là Topic #4692 (Dự Án: MThu Mobile Code) đồng bộ 1-1 với PC tại đường dẫn "G:\\MThu Mobile Code" (trước đây ở ổ E).
- "Sảnh Lobby": Topic #3562 (QuinloveRin Code Sảnh Lobby), nơi điều khiển phân nhánh ổ đĩa (C:, D:, E:, G:), tạo dự án mới, kết nối PC.
- "Mã PIN kết nối PC & Cửa sổ": 2726 (dùng để xác thực kết nối PC và mở khóa Kho GMCloud).
- "Mật khẩu tối cao": 270927-260626-ltqlovepmt (dành cho Super Admin).
- "Cầu nối PC (PC Bridge / Fast Bridge)": Ứng dụng Node chạy ngầm trên máy tính tại "G:\\MThu Mobile Code", liên tục đồng bộ trạng thái với Antigravity IDE và Cloudflare Worker 24/7.
3. Khi người dùng yêu cầu viết code / tạo file: Bọc toàn bộ code trong:
\`\`\`commit:<đường_dẫn_file>
<toàn bộ mã nguồn code không lược bớt>
\`\`\`
4. Tự động chuyển giao: Nếu bài toán vượt quá khả năng xử lý đơn lượt, hãy thêm thẻ [ESCALATE_TO_GEMINI].`;

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        const botToken = (env && env.BOT_TOKEN) ? env.BOT_TOKEN : DEFAULT_BOT_TOKEN;

        // 1. Tải script cho máy net: GET /net hoặc GET /bootstrap
        if (request.method === "GET" && (url.pathname === "/net" || url.pathname === "/bootstrap")) {
            return serveBootstrapScript(url.origin);
        }

        // 2. Healthcheck ping
        if (request.method === "GET" && url.pathname === "/ping") {
            return new Response("pong", { status: 200 });
        }

        // 2b. Cứu hộ khẩn cấp 1 chạm: GET /cloud hoặc GET /rehook hoặc GET /rescue
        // Dành cho trường hợp PC bị sập nguồn đột ngột / rút điện mà chưa kịp gỡ Webhook
        if (request.method === "GET" && (url.pathname === "/cloud" || url.pathname === "/rehook" || url.pathname === "/rescue")) {
            try {
                const res = await fetch(`https://api.telegram.org/bot${botToken}/setWebhook`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        url: url.origin,
                        ip_address: '172.67.144.228',
                        drop_pending_updates: false,
                        allowed_updates: ['message', 'edited_message', 'callback_query']
                    })
                });
                const d = await res.json();
                await sendTg(botToken, SUPERGROUP_ID, `☁️ <b>[KÍCH HOẠT CLOUD KHẨN CẤP THÀNH CÔNG]</b>\n──────────────────────\n✅ Webhook đã được khôi phục về Cloudflare Edge 24/7!\n⚡ Sẵn sàng phục vụ bro ngay cả khi PC mất điện hoặc tắt đột ngột!`, PROJECT_TOPIC_ID);
                return new Response(`<h1>✅ Kích hoạt Cloud 24/7 thành công!</h1><p>Telegram Webhook đã được khôi phục về Cloudflare Edge.</p><pre>${JSON.stringify(d, null, 2)}</pre>`, {
                    headers: { "Content-Type": "text/html; charset=utf-8" }
                });
            } catch (e) {
                return new Response("Lỗi cứu hộ Cloud: " + e.message, { status: 500 });
            }
        }

        // 2c. Đồng bộ Ký ức / Ngữ cảnh Repo từ PC lên Cloud 24/7: POST /sync/context
        if (url.pathname === "/sync/context") {
            if (request.method === "POST") {
                try {
                    const data = await request.json();
                    const tId = Number(data.thread_id || PROJECT_TOPIC_ID);
                    const existing = topicMemory.get(tId) || { history: [] };

                    const incomingHist = Array.isArray(data.history) ? data.history : [];
                    const mergedHist = [...existing.history, ...incomingHist].slice(-20);

                    if (Array.isArray(data.projects)) {
                        registeredProjects = data.projects;
                    }

                    topicMemory.set(tId, {
                        repo: data.repo || "Quin-Iu-Mthu-Code-mobile",
                        path: data.path || "G:\\MThu Mobile Code",
                        pin: data.pin || PROJECT_PIN,
                        summary: data.summary || "Dự án Quin-Iu-Mthu-Code-mobile",
                        files: data.files || ["fast_bridge.cjs", "src/worker.js", "lib/intent.cjs", "lib/ipc.cjs", "lib/lobby.cjs"],
                        history: mergedHist,
                        lastSync: Date.now()
                    });

                    return new Response(JSON.stringify({ ok: true, synced_topic: tId, history_count: mergedHist.length, projects_count: registeredProjects.length }), {
                        headers: { "Content-Type": "application/json" }
                    });
                } catch (e) {
                    return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 400 });
                }
            } else if (request.method === "GET") {
                const allMem = {};
                for (const [k, v] of topicMemory.entries()) allMem[k] = v;
                return new Response(JSON.stringify({ ok: true, memory: allMem, registered_projects: registeredProjects }, null, 2), {
                    headers: { "Content-Type": "application/json" }
                });
            }
        }

        // 2c2. Hàng đợi lệnh điều khiển PC từ xa (Shutdown / Close App / Wake PC): /pc/pending_commands
        if (url.pathname === "/pc/pending_commands") {
            if (request.method === "GET") {
                return new Response(JSON.stringify({ ok: true, commands: pendingPcCommands }), {
                    headers: { "Content-Type": "application/json" }
                });
            } else if (request.method === "POST") {
                const clearedCount = pendingPcCommands.length;
                pendingPcCommands = [];
                return new Response(JSON.stringify({ ok: true, cleared_count: clearedCount }), {
                    headers: { "Content-Type": "application/json" }
                });
            }
        }

        // 2d. Đồng bộ TeleCloud Virtual Repo Snapshot từ PC: POST /telecloud/sync
        if (url.pathname === "/gmcloud/sync" || url.pathname === "/telecloud/sync") {
            if (request.method === "POST") {
                try {
                    const data = await request.json();
                    const tId = Number(data.thread_id || PROJECT_TOPIC_ID);
                    teleCloudStores.set(tId, {
                        fileId: data.file_id,
                        repo: data.repo || "Quin-Iu-Mthu-Code-mobile",
                        fileTree: data.file_tree || [],
                        fileCount: data.file_count || 0,
                        rawSize: data.raw_size || 0,
                        gzippedSize: data.gzipped_size || 0,
                        files: null, // lazy loaded
                        updatedAt: Date.now()
                    });

                    // Cập nhật luôn vào topicMemory
                    const mem = topicMemory.get(tId) || { history: [] };
                    mem.files = (data.file_tree || []).slice(0, 20);
                    topicMemory.set(tId, mem);

                    return new Response(JSON.stringify({
                        ok: true,
                        synced_telecloud: tId,
                        file_count: data.file_count,
                        file_id: data.file_id
                    }), { headers: { "Content-Type": "application/json" } });
                } catch (e) {
                    return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 400 });
                }
            } else if (request.method === "GET") {
                const allStores = {};
                for (const [k, v] of teleCloudStores.entries()) {
                    allStores[k] = { fileId: v.fileId, repo: v.repo, fileCount: v.fileCount, updatedAt: v.updatedAt };
                }
                return new Response(JSON.stringify({ ok: true, telecloud_stores: allStores }, null, 2), {
                    headers: { "Content-Type": "application/json" }
                });
            }
        }

        // 3. Máy net gửi thông tin đăng ký mã CMD (quinloverin -> cmdCode)
        if (request.method === "POST" && url.pathname === "/net/register") {
            try {
                const body = await request.json();
                const cmdCode = (body.cmd_code || "100").toString().padStart(3, "0");
                const hostname = body.hostname || "PC-Net";
                const drive = body.drive || "D:";

                netRegistrations.set(cmdCode, {
                    cmdCode,
                    hostname,
                    drive,
                    time: Date.now(),
                    teleCode: null,
                    dmBotToken: null,
                    dmMsgId: null,
                    verified: false
                });

                return new Response(JSON.stringify({ ok: true, cmd_code: cmdCode }), {
                    headers: { "Content-Type": "application/json" }
                });
            } catch (e) {
                return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 400 });
            }
        }

        // 4. Máy net gửi mã xác thực Telegram nhập từ bàn phím để kết thúc handshake
        if (request.method === "POST" && url.pathname === "/net/verify") {
            try {
                const body = await request.json();
                const cmdCode = (body.cmd_code || "").toString().trim();
                const inputTeleCode = (body.tele_code || "").toString().trim();

                const reg = netRegistrations.get(cmdCode);
                if (!reg) {
                    return new Response(JSON.stringify({ ok: false, error: "Không tìm thấy mã CMD đăng ký" }), { status: 404 });
                }

                if (reg.teleCode !== inputTeleCode) {
                    return new Response(JSON.stringify({ ok: false, error: "Mã xác thực Telegram không đúng" }), { status: 400 });
                }

                reg.verified = true;
                const sessionId = `gm_${cmdCode}-${reg.teleCode}_mthu`;

                // Xóa tin nhắn mã bí mật trong DM riêng để bảo mật và gửi link vào Topic
                if (reg.dmBotToken && reg.dmMsgId) {
                    ctx.waitUntil(deleteTg(reg.dmBotToken, ADMIN_USER_ID, reg.dmMsgId));
                    const jumpMarkup = {
                        inline_keyboard: [
                            [{ text: "🚀 Bấm Vào Topic Dự Án #1160", url: "https://t.me/c/1004457846636/1160" }]
                        ]
                    };
                    const successDm = `✅ <b>[KẾT NỐI MÁY PHỤ THÀNH CÔNG RỰC RỠ]</b>\n──────────────────────\n🏷️ <b>Mã phiên:</b> <code>${sessionId}</code>\n💻 <b>Thiết bị:</b> <code>${reg.hostname}</code> (Ổ ${reg.drive})\n⚡ Cửa sổ Cloud 24/7 độc lập đã kích hoạt!\n\nBro bấm nút bên dưới để vào Topic dự án nhé! 👇`;
                    ctx.waitUntil(sendTg(reg.dmBotToken, ADMIN_USER_ID, successDm, null, jumpMarkup));
                }

                return new Response(JSON.stringify({
                    ok: true,
                    session_id: sessionId,
                    tele_code: reg.teleCode
                }), { headers: { "Content-Type": "application/json" } });
            } catch (e) {
                return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 400 });
            }
        }

        // 5. Telegram Webhook
        if (request.method === "POST") {
            try {
                const body = await request.json();
                if (body && (body.message || body.callback_query)) {
                    ctx.waitUntil(handleTelegramUpdate(body, env, ctx));
                }
                return new Response("OK", { status: 200 });
            } catch (e) {
                return new Response("Bad Request: " + e.message, { status: 400 });
            }
        }

        return new Response("🚀 QuinloveRin 3.8 Cloudflare Worker 24/7 Active!", { status: 200 });
    }
};

async function handleTelegramUpdate(update, env, ctx) {
    const botToken = (env && env.BOT_TOKEN) ? env.BOT_TOKEN : DEFAULT_BOT_TOKEN;

    // A. XỬ LÝ NÚT BẤM CALLBACK QUERY (SẢNH LOBBY)
    if (update.callback_query) {
        const cb = update.callback_query;
        const cbData = cb.data || "";
        const chatId = cb.message ? cb.message.chat.id : null;
        const msgId = cb.message ? cb.message.message_id : null;

        // Bấm nút "Connect Net" tại Sảnh
        if (cbData === "hub_connect_net") {
            const promptText = `📟 <b>[XÁC THỰC KẾT NỐI MÁY PHỤ / NET PC]</b>\n──────────────────────\nℹ️ <b>Hướng dẫn:</b>\n1. Trên máy net, mở CMD và gõ lệnh: <code>quinloverin</code>\n2. CMD sẽ hiện <b>Mã 3 số</b> (ví dụ: <code>839</code>)\n3. Bro hãy gõ tin nhắn phản hồi <b>Mã 3 số</b> đó vào đây:`;
            await editTg(botToken, chatId, msgId, promptText);
            return;
        }

        // Bấm nút PIN
        if (cbData === "hub_show_pin") {
            adminAuthStates.set(ADMIN_USER_ID, { step: "AWAIT_PIN", enteredPin: false, enteredPass: false });
            const pinScreen = `📟 <b>[XÁC THỰC MÃ PIN DỰ ÁN]</b>\n──────────────────────\nBro hãy nhập mã PIN 4 số của dự án vào tin nhắn:`;
            await editTg(botToken, chatId, msgId, pinScreen);
            return;
        }

        // Bấm nút "Bàn giao Cloud 24/7" tại Sảnh
        if (cbData === "hub_cloud") {
            try {
                // 1. Tạo topic riêng cho Cloud 24/7
                const topicRes = await fetch(`https://api.telegram.org/bot${botToken}/createForumTopic`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        chat_id: chatId,
                        name: '☁️ Cloud 24/7 (Groq LPU)',
                        icon_color: 7322096
                    })
                });
                const tData = await topicRes.json();
                let newCloudTopicId = tData && tData.ok ? tData.result.message_thread_id : null;

                if (newCloudTopicId) {
                    const welcomeCloud = `☁️ <b>[CỬA SỔ CLOUDFLARE 24/7 ĐÃ SẴN SÀNG PHỤC VỤ]</b>\n──────────────────────\n⚡ <b>Động cơ:</b> Groq LPU siêu tốc (Qwen 3.8 27B / GPT-OSS 120B)\n🌐 <b>Máy chủ:</b> Cloudflare Edge 24/7 (Độc lập 100%)\n🔒 <b>Topic độc lập:</b> #${newCloudTopicId}\n\n👉 <b>Bro hãy chat, yêu cầu code tại đây!</b>\n• Khi muốn máy tính ở nhà tiếp quản lại: Gõ <code>/pc</code> hoặc <code>ket noi pc</code>.\n• Khi muốn đóng topic này: Gõ <code>/dongtopic</code>.`;
                    await sendTg(botToken, chatId, welcomeCloud, newCloudTopicId);

                    const boardText = `☁️ <b>[CLOUDFLARE WORKER 24/7 ĐANG HOẠT ĐỘNG]</b>\n──────────────────────\n🖥️ <b>Máy tính:</b> Đang ở chế độ Chờ.\n🌐 <b>Cửa sổ Cloud:</b> Đã sinh Topic riêng để phục vụ bro!\n\n👇 <i>Bro bấm nút bên dưới để vào làm việc ngay:</i>`;
                    const jumpMarkup = {
                        inline_keyboard: [
                            [{ text: `🚀 Vào Cửa Sổ Cloud Ngay (#${newCloudTopicId})`, url: `https://t.me/c/4457846636/${newCloudTopicId}` }],
                            [{ text: '🔄 Làm Mới Sảnh', callback_data: 'hub_refresh_menu' }]
                        ]
                    };
                    await editTg(botToken, chatId, msgId, boardText, jumpMarkup);
                }
            } catch (e) {
                console.error('[Worker hub_cloud error]:', e);
            }
            return;
        }

        // Bấm nút "Làm mới Menu Sảnh"
        if (cbData === "hub_refresh_menu") {
            const menuText = `🏛️ <b>BẢNG ĐIỀU KHIỂN SẢNH LOBBY (CLOUD 24/7)</b>\n──────────────────────\n<i>Hệ thống QuinloveRin Code đang trực chiến 24/7 trên Cloudflare Edge!</i>\n\nBro hãy chọn một thao tác bên dưới để bắt đầu:`;
            const menuMarkup = {
                inline_keyboard: [
                    [{ text: '🚀 Tạo Dự Án Mới (New Project)', callback_data: 'hub_create_proj' }],
                    [{ text: '☁️ GMCloud Virtual Storage', callback_data: 'hub_gmcloud' }],
                    [{ text: '🌐 Nối Máy Phụ (Connect Net)', callback_data: 'hub_connect_net' }],
                    [{ text: '☁️ Bàn Giao Cloud 24/7', callback_data: 'hub_cloud' }]
                ]
            };
            await editTg(botToken, chatId, msgId, menuText, menuMarkup);
            return;
        }

        // Bấm nút GMCloud Virtual Storage từ Sảnh hoặc từ Topic
        if (cbData === "hub_gmcloud") {
            const store = await getOrLoadTeleCloudRepo(botToken, threadId);
            const tree = store ? store.fileTree : [];
            const dirs = new Set();
            const files = [];
            for (const f of tree) {
                if (f.includes('/')) dirs.add(f.split('/')[0]);
                else files.push(f);
            }
            const rows = [];
            const dirArr = Array.from(dirs);
            for (let i = 0; i < dirArr.length; i += 2) {
                const r = [{ text: `📁 ${dirArr[i]}/`, callback_data: `gmcloud_dir:${dirArr[i]}` }];
                if (dirArr[i + 1]) r.push({ text: `📁 ${dirArr[i + 1]}/`, callback_data: `gmcloud_dir:${dirArr[i + 1]}` });
                rows.push(r);
            }
            for (const f of files.slice(0, 6)) {
                rows.push([{ text: `📄 ${f}`, callback_data: `gmcloud_view:${f}` }]);
            }
            rows.push([{ text: '🏛️ Về Sảnh Lobby', callback_data: 'hub_refresh_menu' }]);
            const boardText = `☁️ <b>[GMCLOUD - VIRTUAL REPO EXPLORER]</b>\n──────────────────────\n📂 <b>Repo:</b> <code>${store.repo || 'Quin-Iu-Mthu-Code-mobile'}</code>\n📊 <b>Mã nguồn:</b> ${tree.length} files (TeleCloud Object Storage)\n⚡ <b>Trực chiến:</b> Cloudflare Worker 24/7 (Độc lập 100%)\n🌐 <b>Web Dashboard:</b> Đồng bộ 100%\n\n👉 <i>Bro bấm các nút bên dưới để duyệt thư mục hoặc xem code file:</i>`;
            await editTg(botToken, chatId, msgId, boardText, { inline_keyboard: rows });
            return;
        }

        if (cbData.startsWith("gmcloud_dir:")) {
            const dir = cbData.replace("gmcloud_dir:", "");
            const store = await getOrLoadTeleCloudRepo(botToken, threadId);
            const tree = store ? store.fileTree : [];
            const subDirs = new Set();
            const subFiles = [];
            for (const f of tree) {
                if (!dir) {
                    if (f.includes('/')) subDirs.add(f.split('/')[0]);
                    else subFiles.push(f);
                } else if (f.startsWith(dir + '/')) {
                    const rest = f.slice(dir.length + 1);
                    if (rest.includes('/')) subDirs.add(rest.split('/')[0]);
                    else subFiles.push(f);
                }
            }
            const rows = [];
            const dArr = Array.from(subDirs);
            for (let i = 0; i < dArr.length; i += 2) {
                const fullD1 = dir ? `${dir}/${dArr[i]}` : dArr[i];
                const r = [{ text: `📁 ${dArr[i]}/`, callback_data: `gmcloud_dir:${fullD1}` }];
                if (dArr[i + 1]) {
                    const fullD2 = dir ? `${dir}/${dArr[i + 1]}` : dArr[i + 1];
                    r.push({ text: `📁 ${dArr[i + 1]}/`, callback_data: `gmcloud_dir:${fullD2}` });
                }
                rows.push(r);
            }
            for (const f of subFiles.slice(0, 6)) {
                rows.push([{ text: `📄 ${f.split('/').pop()}`, callback_data: `gmcloud_view:${f}` }]);
            }
            const navRow = [];
            if (dir) {
                const parts = dir.split('/');
                parts.pop();
                navRow.push({ text: '🔙 Thư mục cha', callback_data: `gmcloud_dir:${parts.join('/')}` });
            }
            navRow.push({ text: '🏛️ Về Sảnh Lobby', callback_data: 'hub_refresh_menu' });
            rows.push(navRow);
            const dirText = `☁️ <b>[GMCLOUD - VIRTUAL REPO EXPLORER]</b>\n──────────────────────\n📁 <b>Thư mục:</b> <code>/${dir ? dir + '/' : ''}</code>\n📊 <b>Số file:</b> ${subFiles.length} files\n\n👉 <i>Bro bấm các nút bên dưới để mở thư mục hoặc xem code file:</i>`;
            await editTg(botToken, chatId, msgId, dirText, { inline_keyboard: rows });
            return;
        }

        if (cbData.startsWith("gmcloud_view:")) {
            const filePath = cbData.replace("gmcloud_view:", "");
            const store = await getOrLoadTeleCloudRepo(botToken, threadId);
            const code = (store && store.files && store.files[filePath]) ? store.files[filePath] : "// Không tìm thấy file trong snapshot TeleCloud";
            const lines = code.split('\n');
            let displayCode = code;
            if (displayCode.length > 2800 || lines.length > 60) {
                displayCode = lines.slice(0, 55).join('\n') + `\n\n... (và còn ${lines.length - 55} dòng nữa)`;
            }
            const dir = filePath.includes('/') ? filePath.slice(0, filePath.lastIndexOf('/')) : '';
            const viewText = `📄 <b>[GMCLOUD VIEWER]:</b> <code>${filePath}</code>\n──────────────────────\n📊 <b>Số dòng:</b> ${lines.length} dòng | <b>Dung lượng:</b> ${(code.length / 1024).toFixed(1)} KB\n☁️ <b>Lưu trữ:</b> TeleCloud Object Storage 24/7\n\n<pre><code>${escapeHtml(displayCode)}</code></pre>`;
            const markup = {
                inline_keyboard: [
                    [{ text: `🔙 Quay lại ${dir || 'Root'}`, callback_data: `gmcloud_dir:${dir}` }],
                    [{ text: '🏛️ Về Sảnh Lobby', callback_data: 'hub_refresh_menu' }]
                ]
            };
            await editTg(botToken, chatId, msgId, viewText, markup);
            return;
        }
        return;
    }

    // B. XỬ LÝ TIN NHẮN TEXT TỪ NGƯỜI DÙNG
    const msg = update.message;
    if (!msg) return;

    const chatId = msg.chat ? msg.chat.id : null;
    const threadId = msg.message_thread_id || null;
    const text = (msg.text || msg.caption || "").trim();
    const userId = msg.from ? msg.from.id : null;

    if (!chatId || !text) return;

    // 1. KIỂM TRA MÃ 3 SỐ XÁC THỰC CONNECT NET (Nhập từ Sảnh Lobby)
    if (/^\d{3}$/.test(text) && (threadId === null || threadId === 3562)) {
        const cmdCode = text;
        const reg = netRegistrations.get(cmdCode);
        if (reg) {
            // Sinh mã ngẫu nhiên 3 số của Telegram
            const teleCode = Math.floor(100 + Math.random() * 900).toString();
            reg.teleCode = teleCode;

            // Chọn Bot 2 hoặc Bot 3 để gửi tin nhắn riêng (tránh trùng Bot 1 đang code)
            let chosenBotToken = BOT_2_TOKEN;
            let dmRes = await sendTg(chosenBotToken, ADMIN_USER_ID, `🔐 <b>[XÁC NHẬN KẾT NỐI THẬT TỪ QUINLOVERIN]</b>\n──────────────────────\nBạn hãy nhập mã <b>3 số</b> này vào CMD máy net để tiến hành kết nối nhé:\n\n👉 <code>${teleCode}</code>`);

            // Nếu Bot 2 bị chặn do chưa /start, thử Bot 3 hoặc Bot 1
            if (!dmRes) {
                chosenBotToken = BOT_3_TOKEN;
                dmRes = await sendTg(chosenBotToken, ADMIN_USER_ID, `🔐 <b>[XÁC NHẬN KẾT NỐI THẬT TỪ QUINLOVERIN]</b>\n──────────────────────\nBạn hãy nhập mã <b>3 số</b> này vào CMD máy net để tiến hành kết nối nhé:\n\n👉 <code>${teleCode}</code>`);
            }
            if (!dmRes) {
                chosenBotToken = botToken;
                dmRes = await sendTg(chosenBotToken, ADMIN_USER_ID, `🔐 <b>[XÁC NHẬN KẾT NỐI THẬT TỪ QUINLOVERIN]</b>\n──────────────────────\nBạn hãy nhập mã <b>3 số</b> này vào CMD máy net để tiến hành kết nối nhé:\n\n👉 <code>${teleCode}</code>`);
            }

            reg.dmBotToken = chosenBotToken;
            reg.dmMsgId = dmRes;

            const lobbyAck = `✅ <b>[ĐÃ GỬI MÃ XÁC THỰC QUA TIN NHẮN RIÊNG]</b>\n──────────────────────\n💻 <b>Máy net:</b> <code>${reg.hostname}</code> (Mã CMD: <code>${cmdCode}</code>)\n📱 <b>Bot phụ:</b> Đã gửi mã 3 số vào tin nhắn riêng (DM) của bro!\n\n👉 Bro kiểm tra tin nhắn riêng và nhập mã 3 số đó vào CMD máy net nhé!`;
            await sendTg(botToken, chatId, lobbyAck);
            return;
        } else {
            await sendTg(botToken, chatId, `⚠️ Không tìm thấy máy net nào đang chờ mã <code>${cmdCode}</code>. Bro hãy gõ <code>quinloverin</code> trên máy net trước nhé!`);
            return;
        }
    }

    // 2. NẾU LÀ PROMPT ĐÀM THOẠI / CÂU HỎI: BỎ QUA TOÀN BỘ LỆNH & ĐI THẲNG TỚI AI (GROQ / GEMINI)
    if (!isConversationalPrompt(text)) {
        // A. LỆNH KẾT NỐI / TIẾP QUẢN PC: /PC, /CONNECT, /KETNOI, KET NOI PC
        if (/^(?:\/pc|\/connect|\/ketnoi|ket\s*noi\s*pc|bật\s+antigravity|mở\s+antigravity|khởi\s+động\s+antigravity)(?:\s+(\d{3,4}))?$/i.test(text.trim())) {
            const match = text.trim().match(/^(?:\/pc|\/connect|\/ketnoi|ket\s*noi\s*pc|bật\s+antigravity|mở\s+antigravity|khởi\s+động\s+antigravity)(?:\s+(\d{3,4}))?$/i);
            const providedCode = match ? match[1] : null;

            if (providedCode) {
                const proj = findProjectByPin(providedCode, threadId);
                if (proj) {
                    adminAuthStates.delete(userId);
                    pendingPcCommands.push({ type: 'wake_and_open', pin: providedCode, project: proj, chatId, threadId: proj.topicId, time: Date.now() });
                    try {
                        await fetch(`https://api.telegram.org/bot${botToken}/deleteWebhook`);
                    } catch (e) {}
                    await sendTg(
                        botToken,
                        chatId,
                        `🖥️ <b>[ĐÃ XÁC THỰC MÃ PIN & BÀN GIAO CHO PC]</b>\n──────────────────────\n🔑 <b>Mã PIN:</b> <code>${providedCode}</code> (Cửa sổ: <b>${proj.name}</b> #${proj.topicId})\n📂 <b>Thư mục:</b> <code>${proj.path}</code>\n⚡ <b>Hành động:</b> Đã gửi tín hiệu đánh thức PC!\n🚀 Ứng dụng Antigravity IDE trên PC sẽ tự động mở và trỏ vào dự án!`,
                        proj.topicId || threadId
                    );
                    return;
                }
            }

            // Chưa có mã PIN hoặc mã PIN không khớp: BẮT BUỘC HỎI MÃ PIN DỰ ÁN
            adminAuthStates.set(userId, { step: "AWAIT_PC_PIN", threadId });
            await sendTg(
                botToken,
                chatId,
                `📟 <b>[XÁC THỰC KẾT NỐI MÁY PC - QUINLOVERIN]</b>\n──────────────────────\n🔑 <b>Cửa sổ:</b> Topic #${threadId || 1160}\n👉 Bro hãy nhập <b>Mã PIN (Mã cửa sổ repo / máy kết nối)</b> để đánh thức PC:`,
                threadId
            );
            return;
        }

        // B. KIỂM TRA NẾU ĐANG CHỜ MÃ PIN ĐỂ ĐÁNH THỨC PC HOẶC NHẬP MÃ PIN DỰ ÁN TRONG TOPIC
        let authState = adminAuthStates.get(userId) || { step: null, enteredPin: false, enteredPass: false };
        if (authState.step === "AWAIT_PC_PIN" || (/^\d{4}$/.test(text.trim()) && Number(threadId) !== 3562)) {
            const inputPin = text.trim();
            const proj = findProjectByPin(inputPin, threadId);
            if (proj) {
                adminAuthStates.delete(userId);
                pendingPcCommands.push({ type: 'wake_and_open', pin: inputPin, project: proj, chatId, threadId: proj.topicId, time: Date.now() });
                try {
                    await fetch(`https://api.telegram.org/bot${botToken}/deleteWebhook`);
                } catch (e) {}
                await sendTg(
                    botToken,
                    chatId,
                    `🖥️ <b>[ĐÃ XÁC THỰC MÃ PIN & BÀN GIAO CHO PC]</b>\n──────────────────────\n🔑 <b>Mã PIN:</b> <code>${inputPin}</code> (Cửa sổ: <b>${proj.name}</b> #${proj.topicId})\n📂 <b>Thư mục:</b> <code>${proj.path}</code>\n⚡ <b>Hành động:</b> Đã gửi tín hiệu đánh thức PC!\n🚀 Ứng dụng Antigravity IDE trên PC sẽ tự động mở và trỏ vào dự án!`,
                    proj.topicId || threadId
                );
                return;
            } else if (/^\d{3,4}$/.test(inputPin)) {
                await sendTg(
                    botToken,
                    chatId,
                    `❌ <b>[MÃ PIN DỰ ÁN / MÁY KHÔNG ĐÚNG]</b>\nMã <code>${inputPin}</code> không chính xác! Bro hãy nhập lại đúng mã PIN của dự án này hoặc máy tính cần kết nối:`,
                    threadId
                );
                return;
            }
        }

        // C. CƠ CHẾ XÁC THỰC KÉP QUẢN TRỊ VIÊN TẠI SẢNH LOBBY (MASTER PASSWORD & PIN)
        if (threadId === null || threadId === 3562) {
            if (text === PROJECT_PIN && authState.step === "AWAIT_PIN") {
                authState.enteredPin = true;
                if (authState.enteredPass) {
                    adminAuthStates.delete(userId);
                    await sendTg(botToken, chatId, `👑 <b>[TOÀN QUYỀN QUẢN TRỊ ĐÃ MỞ KHÓA 100%]</b>\n──────────────────────\n🔑 Mã PIN: <code>2726</code> (Trí nhớ dự án đã nạp)\n🛡️ Mật mã quản trị: <b>Chính xác!</b>\n🚀 Bro có thể điều hành và phát triển dự án từ xa ngay trên Cloud 24/7!`, threadId);
                    return;
                } else {
                    authState.step = "AWAIT_PASS";
                    adminAuthStates.set(userId, authState);
                    await sendTg(botToken, chatId, `👑 <b>[XÁC THỰC QUẢN TRỊ VIÊN]</b>\n──────────────────────\n✅ Đã nhận diện mã PIN dự án: <code>2726</code>!\n🔑 Vui lòng nhập <b>Mật mã Quản trị Tối cao</b> để kích hoạt toàn quyền:`, threadId);
                    return;
                }
            }

            if (text === MASTER_PASSWORD) {
                authState.enteredPass = true;
                if (authState.enteredPin) {
                    adminAuthStates.delete(userId);
                    await sendTg(botToken, chatId, `👑 <b>[TOÀN QUYỀN QUẢN TRỊ ĐÃ MỞ KHÓA 100%]</b>\n──────────────────────\n🔑 Mật mã quản trị: <b>Chính xác!</b>\n🧠 Mã PIN 2726: <b>Đã đồng bộ trí nhớ dự án!</b>\n🚀 Bro có thể điều hành và phát triển dự án từ xa ngay trên Cloud 24/7!`, threadId);
                    return;
                } else {
                    authState.step = "AWAIT_PIN";
                    adminAuthStates.set(userId, authState);
                    await sendTg(botToken, chatId, `👑 <b>[MẬT MÃ QUẢN TRỊ HỢP LỆ]</b>\n──────────────────────\n✅ Mật mã chính xác!\n🧠 Vui lòng nhập <b>Mã PIN 4 số của dự án</b> (<code>2726</code>) để liên kết trí nhớ:`, threadId);
                    return;
                }
            }
        }

        // D. LỆNH DỪNG / HỦY TÁC VỤ CLOUD: /CANCEL, /STOP
        if (/^(?:\/cancel|\/stop)$/i.test(text.trim())) {
            await sendTg(botToken, chatId, "🛑 <b>[ĐÃ DỪNG TOÀN BỘ TÁC VỤ CLOUD]</b>", threadId);
            return;
        }

        // E. LỆNH ĐÓNG REPO
        if (/^(?:\/ketthucrepo|\/endrepo|\/dongrepo)$/i.test(text.trim())) {
            await sendTg(botToken, chatId, "🔒 <b>[ĐÃ KẾT THÚC QUYỀN QUẢN TRỊ REPO]</b>\n──────────────────────\n✅ Đã khóa lại quyền hạn quản trị repo thành công trên Cloud!", threadId);
            return;
        }

        // F. LỆNH ĐÓNG & XOÁ TOPIC TRÊN CLOUD: /DONGTOPIC, /XOATOPIC
        if (/^(?:\/dongtopic|\/closetopic|\/dong_topic|\/xoatopic|\/xoa_topic)$/i.test(text.trim())) {
            if (threadId === null || threadId === undefined) {
                await sendTg(botToken, chatId, "⚠️ <b>[KHO GMCLOUD VĨNH CỬU ĐƯỢC BẢO VỆ]</b>\n──────────────────────\nTopic # (Kho GMCloud Storage) là kho lưu trữ vĩnh cửu của Telegram, tuyệt đối không thể xóa!", threadId);
            } else if (Number(threadId) === 3562) {
                await sendTg(botToken, chatId, "⚠️ <b>[KHÔNG THỂ XOÁ SẢNH LOBBY]</b>\n──────────────────────\nSảnh Lobby là kênh điều khiển trung tâm, tuyệt đối không thể xoá!", threadId);
            } else if (Number(threadId) === 1160 || Number(threadId) === 4692) {
                await sendTg(botToken, chatId, "🛡️ <b>[DỰ ÁN CỐT LÕI #1160 ĐƯỢC BẢO VỆ]</b>\n──────────────────────\nTopic dự án chính không thể xoá tự động để tránh mất dữ liệu liên kết!", threadId);
            } else {
                try {
                    await fetch(`https://api.telegram.org/bot${botToken}/deleteForumTopic`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ chat_id: chatId, message_thread_id: threadId })
                    });
                } catch (e) {}
            }
            return;
        }

        // G. LỆNH ĐIỀU KHIỂN TẮT ỨNG DỤNG TRÊN PC TỪ XA: /TAT, /DONG, /CLOSE
        if (/^\/(?:close_antigravity|tat_antigravity|kill_antigravity)$/i.test(text.trim()) ||
            /^(?:tắt|đóng|tat|dong)\s+antigravity$/i.test(text.trim())) {
            pendingPcCommands.push({ type: 'close_app', target: 'antigravity', chatId, threadId, time: Date.now() });
            try { await fetch(`https://api.telegram.org/bot${botToken}/deleteWebhook`); } catch (e) {}
            await sendTg(
                botToken,
                chatId,
                `🛑 <b>[ĐANG ĐIỀU KHIỂN TẮT ANTIGRAVITY TRÊN PC]</b>\n──────────────────────\n⚡ Đã gửi lệnh đóng Antigravity IDE tới máy tính PC để tiết kiệm RAM & CPU!\n☁️ Cloudflare Worker 24/7 tiếp tục trực chiến phục vụ bro!`,
                threadId
            );
            return;
        }

        if (/^\/(?:tat|dong|close|kill)\s+([a-zA-Z0-9_\-\.]+)$/i.test(text.trim()) ||
            /^(?:tắt|đóng|tat|dong)\s+([a-zA-Z0-9_\-\.]+)$/i.test(text.trim())) {
            const matchApp = text.trim().match(/^(?:\/tat|\/dong|\/close|\/kill|tắt|đóng|tat|dong)\s+([a-zA-Z0-9_\-\.]+)$/i);
            const closeTarget = matchApp ? matchApp[1].toLowerCase() : '';
            pendingPcCommands.push({ type: 'close_app', target: closeTarget, chatId, threadId, time: Date.now() });
            try { await fetch(`https://api.telegram.org/bot${botToken}/deleteWebhook`); } catch (e) {}
            await sendTg(
                botToken,
                chatId,
                `🛑 <b>[ĐANG ĐIỀU KHIỂN ĐÓNG ỨNG DỤNG TRÊN PC]</b>\n──────────────────────\n⚡ Đã chuyển tiếp lệnh đóng <code>${closeTarget}</code> tới máy tính PC để thực thi ngay!`,
                threadId
            );
            return;
        }

        // G2. LỆNH TẮT MÁY (REMOTE SHUTDOWN PC) KHI ĐANG Ở CLOUD
        if (/^(?:\/shutdown|\/tatmay|\/tat_pc|\/tat_may|(?:tắt|tat)\s+(?:máy|may|máy\s+tính|may\s+tinh|pc|nguồn|nguon)(?:\s+(?:đi|nhe|nhé|nha|thôi|thoi|giúp|giup|hộ|ho)?(?:\s+(?:bro|bạn|ban|ad|em))?)?)$/i.test(text.trim())) {
            pendingPcCommands.push({ type: 'shutdown_pc', chatId, threadId, time: Date.now() });
            try { await fetch(`https://api.telegram.org/bot${botToken}/deleteWebhook`); } catch (e) {}
            await sendTg(
                botToken,
                chatId,
                `🔌 <b>[ĐÃ TIẾP NHẬN LỆNH TẮT NGUỒN PC TỪ XA]</b>\n──────────────────────\n⚡ <b>Đã phát tín hiệu ngắt nguồn tới máy tính PC!</b>\n🖥️ PC đang thực thi lệnh đóng ứng dụng và tắt nguồn hoàn toàn (Shut down trong 10 giây).\n☁️ Cloudflare Worker 24/7 tiếp tục trực chiến trên Đám Mây để chờ bro!`,
                threadId
            );
            return;
        }

        // H. LỆNH TELECLOUD VIRTUAL REPO: /files, /cat, /search
        if (/^(?:\/files|\/tree|danh\s+sách\s+file|cây\s+thư\s+mục)$/i.test(text.trim())) {
            const store = await getOrLoadTeleCloudRepo(botToken, threadId);
            if (store && store.fileTree && store.fileTree.length > 0) {
                const treeText = store.fileTree.slice(0, 35).map(f => `📄 <code>${f}</code>`).join('\n');
                const moreText = store.fileTree.length > 35 ? `\n<i>...và ${store.fileTree.length - 35} files khác</i>` : '';
                await sendTg(
                    botToken,
                    chatId,
                    `📦 <b>[TELECLOUD VIRTUAL REPO - ${store.repo}]</b>\n──────────────────────\n📊 <b>Tổng số file:</b> ${store.fileTree.length} files mã nguồn\n☁️ <b>Lưu trữ:</b> Telegram Object Store (Zero API Call)\n\n${treeText}${moreText}\n\n👉 <i>Bro có thể gõ <code>/cat &lt;đường_dẫn&gt;</code> để đọc trực tiếp file!</i>`,
                    threadId
                );
            } else {
                await sendTg(botToken, chatId, `⚠️ Chưa có snapshot TeleCloud cho Topic này. Trên PC gõ <code>/sync_telecloud</code> để đồng bộ nhé!`, threadId);
            }
            return;
        }

        const catMatch = text.trim().match(/^(?:\/cat|\/read|xem\s+file|đọc\s+file)\s+([^\s]+)$/i);
        if (catMatch) {
            const targetPath = catMatch[1].trim();
            const store = await getOrLoadTeleCloudRepo(botToken, threadId);
            if (store && store.files) {
                const matchedKey = Object.keys(store.files).find(k => k.toLowerCase() === targetPath.toLowerCase() || k.toLowerCase().endsWith('/' + targetPath.toLowerCase()));
                if (matchedKey) {
                    const content = store.files[matchedKey];
                    const previewContent = content.length > 3000 ? content.substring(0, 3000) + '\n\n// ... (đã cắt bớt vì giới hạn độ dài tin nhắn)' : content;
                    await sendTg(
                        botToken,
                        chatId,
                        `📄 <b>[TELECLOUD FILE: <code>${matchedKey}</code>]</b>\n──────────────────────\n<pre><code class="language-javascript">${escapeHtml(previewContent)}</code></pre>`,
                        threadId
                    );
                } else {
                    await sendTg(botToken, chatId, `⚠️ Không tìm thấy file <code>${escapeHtml(targetPath)}</code> trong TeleCloud snapshot. Gõ <code>/files</code> để xem danh sách file nhé!`, threadId);
                }
            } else {
                await sendTg(botToken, chatId, `⚠️ Không thể tải TeleCloud snapshot. Vui lòng thử lại sau!`, threadId);
            }
            return;
        }

        const searchMatch = text.trim().match(/^(?:\/search|\/grep|tìm\s+code|tìm\s+kiếm)\s+(.+)$/i);
        if (searchMatch) {
            const query = searchMatch[1].trim();
            const store = await getOrLoadTeleCloudRepo(botToken, threadId);
            if (store && store.files) {
                const matches = [];
                for (const [fPath, content] of Object.entries(store.files)) {
                    if (content.toLowerCase().includes(query.toLowerCase())) {
                        matches.push(fPath);
                    }
                }
                if (matches.length > 0) {
                    const list = matches.slice(0, 15).map(m => `• <code>${m}</code>`).join('\n');
                    await sendTg(
                        botToken,
                        chatId,
                        `🔍 <b>[KẾT QUẢ TÌM KIẾM TELECLOUD]: "${escapeHtml(query)}"</b>\n──────────────────────\nTìm thấy trong <b>${matches.length}</b> files:\n${list}\n\n👉 <i>Gõ <code>/cat &lt;file&gt;</code> để xem chi tiết!</i>`,
                        threadId
                    );
                } else {
                    await sendTg(botToken, chatId, `🔍 Không tìm thấy từ khóa <code>${escapeHtml(query)}</code> trong bất kỳ file nào của repo!`, threadId);
                }
            }
            return;
        }
    }

    // 🏛️ SẢNH LOBBY TRÊN CLOUD: XÓA TIN NHẮN & TUYỆT ĐỐI KHÔNG CHẠY CODE TẠI ĐÂY
    if (Number(threadId) === 3562) {
        if (msg.message_id) {
            try {
                await fetch(`https://api.telegram.org/bot${botToken}/deleteMessage`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ chat_id: chatId, message_id: msg.message_id })
                });
            } catch (e) {}
        }
        return;
    }

    // 4. HÀNG ĐỢI TUẦN TỰ CLOUD (FIFO PROMPT QUEUE) & XỬ LÝ VỚI KÝ ỨC REPO
    const queueKey = `${chatId}_${threadId || 'general'}`;
    let currentChain = topicQueues.get(queueKey) || Promise.resolve();
    const curLen = (topicQueueLengths.get(queueKey) || 0);

    if (curLen > 0) {
        await sendTg(
            botToken,
            chatId,
            `⏳ <b>[ĐÃ ĐƯA VÀO HÀNG ĐỢI CLOUD #${curLen}]</b>\n──────────────────────\n📝 <code>${text.replace(/[<>]/g, "").substring(0, 50)}</code>\n⚡ Cloud đang trả lời yêu cầu trước, prompt này sẽ được thực thi tiếp theo!`,
            threadId
        );
    }
    topicQueueLengths.set(queueKey, curLen + 1);

    const nextChain = currentChain.then(async () => {
        try {
            await executeCloudPromptWithMemory(text, chatId, threadId, botToken, env);
        } finally {
            const rem = (topicQueueLengths.get(queueKey) || 1) - 1;
            topicQueueLengths.set(queueKey, Math.max(0, rem));
        }
    });
    topicQueues.set(queueKey, nextChain);
    await nextChain;
}

async function getOrLoadTeleCloudRepo(botToken, threadId) {
    const memKey = Number(threadId) || PROJECT_TOPIC_ID;
    let store = teleCloudStores.get(memKey);
    if (!store) {
        store = {
            fileId: "BQACAgUAAyEGAAMBCbVXbAACEQVq5hNURRPie_2XZnt2i9c0K0rWGAAC1SUAAqoFMFfPFeUc2DE__T0E",
            repo: "Quin-Iu-Mthu-Code-mobile",
            fileTree: [],
            files: null,
            updatedAt: Date.now()
        };
        teleCloudStores.set(memKey, store);
    }

    if (store.files) {
        return store;
    }

    // Timeout nhanh 3 giay de tranh delay / hang tren Cloudflare
    if (store.fileId) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 3000);
            const getFileRes = await fetch(`https://api.telegram.org/bot${botToken}/getFile?file_id=${store.fileId}`, { signal: controller.signal });
            const fileData = await getFileRes.json();
            if (fileData.ok && fileData.result && fileData.result.file_path) {
                const downloadUrl = `https://api.telegram.org/file/bot${botToken}/${fileData.result.file_path}`;
                const fileRes = await fetch(downloadUrl, { signal: controller.signal });
                const arrayBuf = await fileRes.arrayBuffer();
                clearTimeout(timeoutId);
                const decompressed = gunzipSync(Buffer.from(arrayBuf)).toString("utf8");
                const bundle = JSON.parse(decompressed);
                store.files = bundle.files || {};
                store.fileTree = Object.keys(store.files);
                store.fileCount = store.fileTree.length;
                store.repo = bundle.repo || store.repo;
            } else {
                clearTimeout(timeoutId);
            }
        } catch (e) {
            console.warn('[GMCloud Quick Cache Bypass]:', e.message);
        }
    }

    return store;
}

/**
 * Tra cứu thông tin trực tiếp trên Internet (Live Web Search qua DuckDuckGo Lite)
 * Siêu nhẹ: < 2ms CPU, < 2MB RAM, timeout 3.5s an toàn cho Cloudflare Worker!
 */
async function searchLiveWeb(query) {
    if (!query || query.length < 3) return "";
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3500);
        const res = await fetch("https://lite.duckduckgo.com/lite/", {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
            },
            body: "q=" + encodeURIComponent(query),
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        if (!res.ok) return "";
        const html = await res.text();
        const snippetRegex = /<td class=['"]result-snippet['"]>([\s\S]*?)<\/td>/g;
        const linkRegex = /<a[^>]*class=['"]result-link['"][^>]*>([\s\S]*?)<\/a>/g;

        const titles = [];
        let mLink;
        while ((mLink = linkRegex.exec(html)) !== null && titles.length < 3) {
            titles.push(mLink[1].replace(/<[^>]+>/g, "").trim());
        }

        const snippets = [];
        let mSnippet;
        while ((mSnippet = snippetRegex.exec(html)) !== null && snippets.length < 3) {
            snippets.push(
                mSnippet[1]
                    .replace(/<[^>]+>/g, "")
                    .replace(/&quot;/g, '"')
                    .replace(/&amp;/g, '&')
                    .replace(/&#039;/g, "'")
                    .trim()
            );
        }

        const items = [];
        for (let i = 0; i < Math.max(titles.length, snippets.length); i++) {
            const t = titles[i] || "";
            const s = snippets[i] || "";
            if (t || s) {
                items.push(`• ${t}: ${s}`);
            }
        }
        return items.join("\n\n");
    } catch (e) {
        return "";
    }
}

async function executeCloudPromptWithMemory(text, chatId, threadId, botToken, env) {
    const ghToken = (env && env.GITHUB_TOKEN) ? env.GITHUB_TOKEN : DEFAULT_GH_TOKEN;
    const ghOwner = (env && env.GITHUB_OWNER) ? env.GITHUB_OWNER : "letrungquangm-alt";
    const currentRepo = (env && env.CURRENT_REPO) ? env.CURRENT_REPO : "Quin-Iu-Mthu-Code-mobile";
    let groqKeys = DEFAULT_GROQ_KEYS;
    let geminiKeys = DEFAULT_GEMINI_KEYS;

    const memKey = Number(threadId) || PROJECT_TOPIC_ID;
    let mem = topicMemory.get(memKey);
    if (!mem) {
        mem = {
            repo: currentRepo,
            path: "G:\\MThu Mobile Code",
            pin: PROJECT_PIN,
            summary: "Dự án Quin-Iu-Mthu-Code-mobile (Universal Telegram Mobile Coding Bridge)",
            files: ["fast_bridge.cjs", "src/worker.js", "lib/intent.cjs", "lib/ipc.cjs", "lib/lobby.cjs"],
            history: []
        };
        topicMemory.set(memKey, mem);
    }

    let fullSystem = SYSTEM_INSTRUCTION;
    fullSystem += `\n\n[KÝ ỨC NGỮ CẢNH DỰ ÁN & REPO]:\n- Tên repo: ${mem.repo}\n- Đường dẫn workspace PC: ${mem.path}\n- Mã PIN cửa sổ: ${mem.pin}\n- Topic Telegram hiện tại: #${memKey}\n- Tóm tắt công việc: ${mem.summary}`;
    if (mem.files && mem.files.length > 0) {
        fullSystem += `\n- Các file chính trong repo: ${mem.files.join(', ')}`;
    }

    // Tự động nạp mã nguồn thực tế của file nếu câu hỏi có nhắc tới (Zero GitHub API Call)
    const store = await getOrLoadTeleCloudRepo(botToken, memKey);
    let injectedFilesContext = "";
    if (store && store.files) {
        const textLower = text.toLowerCase();
        let injectedCount = 0;
        for (const fPath of Object.keys(store.files)) {
            const baseName = fPath.split('/').pop().toLowerCase();
            if (textLower.includes(fPath.toLowerCase()) || (baseName.length > 4 && textLower.includes(baseName))) {
                const fileCode = store.files[fPath];
                if (fileCode && fileCode.length < 25000) {
                    injectedFilesContext += `\n\n--- [FILE THỰC TẾ TRONG REPO TỪ TELECLOUD: ${fPath}] ---\n${fileCode}\n--- [HẾT FILE ${fPath}] ---`;
                    injectedCount++;
                    if (injectedCount >= 3) break;
                }
            }
        }
    }
    if (injectedFilesContext) {
        fullSystem += `\n\n[MÃ NGUỒN THỰC TẾ TỪ TELECLOUD VIRTUAL REPO]:${injectedFilesContext}`;
    }

    // Tự động tìm kiếm Internet (Live Web Search) nếu câu hỏi cần tra cứu bên ngoài
    let webSearchContext = "";
    const shouldSearchWeb = /(?:là gì|la gi|thế nào|the nao|mới nhất|moi nhat|hôm nay|hom nay|thời tiết|thoi tiet|tin tức|tin tuc|giá|gia|thư viện|thu vien|cách dùng|cach dung|hướng dẫn|huong dan|search|google|tra cứu|tra cuu|nghĩa là gì|nghia la gi|ai là|ai la|ở đâu|o dau)/i.test(text) || text.trim().startsWith('/search');
    if (shouldSearchWeb) {
        const queryToSearch = text.replace(/^\/search\s*/i, '').trim();
        webSearchContext = await searchLiveWeb(queryToSearch);
    }
    if (webSearchContext) {
        fullSystem += `\n\n[KẾT QUẢ TRA CỨU INTERNET TRỰC TIẾP (LIVE WEB SEARCH)]:\n${webSearchContext}\n--- (Bro hãy dùng thông tin mới nhất từ Internet này để trả lời chuẩn xác cho người dùng) ---`;
    }

    const historyList = mem.history || [];
    const groqMessages = [
        { role: "system", content: fullSystem },
        ...historyList.slice(-10),
        { role: "user", content: text }
    ];

    const preview = text.replace(/[<>]/g, "").substring(0, 50);
    const start = Date.now();
    const searchNotice = webSearchContext ? "🌐 Đã tra cứu Internet Live & Đang xử lý qua Groq LPU..." : "⚡ Đang xử lý qua Groq LPU (Kèm Ký ức Repo)...";
    const ackId = await sendTg(botToken, chatId, `⏳ <b>[QUINLOVERIN 3.8 CLOUD 24/7]</b>\n──────────────────────\n<i>${searchNotice}</i>\n📝 <code>${preview}</code>`, threadId);

    let answer = "";
    let modelUsed = "Groq LPU Qwen 3.8 27B";
    let shouldEscalate = false;

    // Goi Groq LPU sieu toc (qwen3.8-27b -> openai/gpt-oss-120b -> openai/gpt-oss-20b)
    const groqModels = ["qwen/qwen3.8-27b", "openai/gpt-oss-120b", "openai/gpt-oss-20b"];

    for (const model of groqModels) {
        for (const gKey of groqKeys) {
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 8000);
                const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                    method: "POST",
                    headers: { "Authorization": "Bearer " + gKey, "Content-Type": "application/json" },
                    body: JSON.stringify({
                        model: model,
                        messages: groqMessages,
                        max_tokens: 2048,
                        temperature: 0.7
                    }),
                    signal: controller.signal
                });
                clearTimeout(timeoutId);

                if (groqRes.status === 200) {
                    const gData = await groqRes.json();
                    if (gData.choices && gData.choices[0] && gData.choices[0].message) {
                        answer = gData.choices[0].message.content.trim();
                        modelUsed = `Groq LPU (${model})`;
                        break;
                    }
                }
            } catch (e) {}
        }
        if (answer) break;
    }

    if (!answer) answer = "Hệ thống Cloud đang xử lý yêu cầu, bro hãy gửi lại tin nhắn nhé!";
    const elapsedSec = ((Date.now() - start) / 1000).toFixed(1);

    // Commit code nếu có block commit
    const commitRegex = /```commit:([^\n\r]+)\n([\s\S]*?)```/g;
    let match;
    const committedFiles = [];

    if (ghToken) {
        while ((match = commitRegex.exec(answer)) !== null) {
            const filePath = match[1].trim();
            const codeContent = match[2];
            const sha = await commitToGitHub(ghToken, ghOwner, currentRepo, filePath, codeContent);
            if (sha) committedFiles.push({ file: filePath, sha: sha.substring(0, 7) });
        }
    }

    const cleanAnswer = answer.replace(/```commit:[^\n\r]+\n[\s\S]*?```/g, "").replace("[ESCALATE_TO_GEMINI]", "").trim();

    // Cập nhật Ký ức hội thoại cho Topic này
    historyList.push({ role: "user", content: text });
    historyList.push({ role: "assistant", content: cleanAnswer });
    if (historyList.length > 20) historyList.splice(0, historyList.length - 20);
    mem.history = historyList;
    topicMemory.set(memKey, mem);

    let reply = `🤖 <b>[QUINLOVERIN 3.8 CLOUD]</b> ⏱️ <b>${elapsedSec}s</b> (<i>${modelUsed}</i>)\n──────────────────────\n${cleanAnswer}\n\n`;

    if (committedFiles.length > 0) {
        reply += `📦 <b>CÁC FILE ĐÃ COMMIT TỰ ĐỘNG LÊN GITHUB:</b>\n`;
        for (const f of committedFiles) {
            reply += `• <code>${f.file}</code> (commit: <code>${f.sha}</code>)\n`;
        }
        reply += `\n🌐 <b>Repo:</b> https://github.com/${ghOwner}/${currentRepo}\n✨ Máy tính chính bật lại chỉ cần <code>git pull</code> là có ngay code mới!`;
    }

    if (ackId) await deleteTg(botToken, chatId, ackId);
    await sendTg(botToken, chatId, reply, threadId);
}

async function sendTg(token, chatId, text, threadId, replyMarkup) {
    const payload = { chat_id: chatId, text: text, parse_mode: "HTML", disable_web_page_preview: true };
    if (threadId && Number(threadId) > 0) payload.message_thread_id = Number(threadId);
    if (replyMarkup) payload.reply_markup = replyMarkup;
    try {
        const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
        const d = await res.json();
        return d.ok && d.result ? d.result.message_id : null;
    } catch (e) { return null; }
}

async function editTg(token, chatId, messageId, text, replyMarkup) {
    const payload = { chat_id: chatId, message_id: messageId, text: text, parse_mode: "HTML", disable_web_page_preview: true };
    if (replyMarkup) payload.reply_markup = replyMarkup;
    try {
        await fetch(`https://api.telegram.org/bot${token}/editMessageText`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
    } catch (e) {}
}

async function deleteTg(token, chatId, messageId) {
    try {
        await fetch(`https://api.telegram.org/bot${token}/deleteMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: chatId, message_id: messageId })
        });
    } catch (e) {}
}

async function commitToGitHub(token, owner, repo, path, content) {
    try {
        let sha = null;
        const checkRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${path}`, {
            headers: { "Authorization": `token ${token}`, "User-Agent": "QuinloveRin-Cloudflare" }
        });
        if (checkRes.status === 200) {
            const data = await checkRes.json();
            sha = data.sha;
        }

        const body = {
            message: `feat(cloud): update ${path} via Telegram`,
            content: btoa(unescape(encodeURIComponent(content)))
        };
        if (sha) body.sha = sha;

        const putRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${path}`, {
            method: "PUT",
            headers: { "Authorization": `token ${token}`, "User-Agent": "QuinloveRin-Cloudflare", "Content-Type": "application/json" },
            body: JSON.stringify(body)
        });

        if (putRes.status === 200 || putRes.status === 201) {
            const data = await putRes.json();
            return data.commit ? data.commit.sha : "latest";
        }
    } catch (e) {}
    return null;
}

// Script bootstrap PowerShell chạy trên máy net
function serveBootstrapScript(workerOrigin) {
    const psCode = `
# ========================================================
# QUINLOVERIN NET ONBOARDING - PROTOCOL gm_xxx-yyy_mthu
# ========================================================
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

Write-Host ""
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host " 🚀 QUINLOVERIN NET ONBOARDING (GM-TELE)                  " -ForegroundColor Yellow
Write-Host " Kết nối máy net / máy mới thẳng với Cloudflare & Telegram " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host ""

$workerUrl = "${workerOrigin}"

# 1. Khởi tạo mã CMD ngẫu nhiên 3 số
$cmdCode = (Get-Random -Minimum 100 -Maximum 999).ToString()

# 2. Đăng ký lệnh 'quinloverin' toàn cục vào máy
$binDir = "$env:USERPROFILE\\.quinloverin"
if (-not (Test-Path $binDir)) { New-Item -ItemType Directory -Path $binDir -Force | Out-Null }
$cmdLines = @('@echo off', 'powershell -ExecutionPolicy Bypass -Command "irm https://is.gd/qmthu | iex"')
$cmdLines | Set-Content -Path "$binDir\\quinloverin.cmd" -Encoding ASCII
$currentPath = [System.Environment]::GetEnvironmentVariable("Path", "User")
if ($currentPath -notlike "*$binDir*") {
    [System.Environment]::SetEnvironmentVariable("Path", "$currentPath;$binDir", "User")
    $env:Path += ";$binDir"
    Write-Host "✨ Đã ghim lệnh 'quinloverin' vào hệ thống!" -ForegroundColor Gray
}

# 3. Gửi thông tin về Cloudflare để sẵn sàng cho Lobby
$regBody = @{
    cmd_code = $cmdCode
    hostname = $env:COMPUTERNAME
    drive = (Get-Location).Drive.Name + ":"
} | ConvertTo-Json

try {
    $resp = Invoke-RestMethod -Uri "$workerUrl/net/register" -Method POST -Body $regBody -ContentType "application/json" -TimeoutSec 15
    Write-Host "==========================================================" -ForegroundColor Yellow
    Write-Host " 📡 ĐÃ GỬI THÔNG TIN VỀ GM-TELE" -ForegroundColor Green
    Write-Host " 👉 Bro hãy vào Sảnh (Lobby) bấm nút [Connect Net]" -ForegroundColor Cyan
    Write-Host "    và nhập mã này: " -NoNewline
    Write-Host "[$cmdCode]" -ForegroundColor Green
    Write-Host "==========================================================" -ForegroundColor Yellow
    Write-Host ""

    # Chờ user nhập mã 3 số từ tin nhắn riêng của Bot gửi về
    $inputTele = Read-Host "🔑 Nhập mã 3 chữ số từ Telegram gửi riêng về để kết nối"
    $inputTele = $inputTele.Trim()

    # Gửi xác thực
    $verifyBody = @{
        cmd_code = $cmdCode
        tele_code = $inputTele
    } | ConvertTo-Json

    $vResp = Invoke-RestMethod -Uri "$workerUrl/net/verify" -Method POST -Body $verifyBody -ContentType "application/json" -TimeoutSec 15
    if ($vResp.ok) {
        $sessionId = $vResp.session_id
        Write-Host ""
        Write-Host "==========================================================" -ForegroundColor Green
        Write-Host " ✅ XÁC THỰC THÀNH CÔNG RỰC RỠ!" -ForegroundColor Green
        Write-Host " 🔑 MÃ LIÊN KẾT PHIÊN: " -NoNewline
        Write-Host "$sessionId" -ForegroundColor Yellow
        Write-Host " 🌐 Đã liên kết với Topic dự án trên Telegram qua Cloud 24/7!" -ForegroundColor Cyan
        Write-Host "==========================================================" -ForegroundColor Green
        Write-Host ""
    } else {
        Write-Host "❌ Mã xác thực không chính xác!" -ForegroundColor Red
    }
} catch {
    Write-Host "❌ Lỗi kết nối Cloud: $($_.Exception.Message)" -ForegroundColor Red
}
`;
    return new Response(psCode, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
