// src/worker.js - QuinloveRin 3.8 24/7 Cloudflare Worker
// Interactive Net PC Handshake & Dual-Auth Admin System

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

// Trạng thái Admin xác thực kép tại Sảnh: userId -> { step: 'AWAIT_PIN' | 'AWAIT_PASS', enteredPin: false, enteredPass: false }
let adminAuthStates = new Map();

const SYSTEM_INSTRUCTION = `Bạn là QuinloveRin 3.8, trợ lý lập trình AI siêu cấp hoạt động 24/7 trên Cloudflare Worker & Groq LPU.
Quy tắc:
1. Xưng hô: "tôi - bro", thân thiện, nhạy bén, công nghệ cao. Tuyệt đối không dùng "anh - em" hay "anh yêu".
2. Khi người dùng yêu cầu viết code / tạo file: Bọc toàn bộ code trong:
\`\`\`commit:<đường_dẫn_file>
<toàn bộ mã nguồn code không lược bớt>
\`\`\`
3. Tự động chuyển giao: Nếu bài toán vượt quá khả năng xử lý đơn lượt, hãy thêm thẻ [ESCALATE_TO_GEMINI].`;

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
    if (/^\d{3}$/.test(text) && threadId === null) {
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

    // 2. CƠ CHẾ XÁC THỰC KÉP QUẢN TRỊ VIÊN (ADMIN AUTH: PASSWORD & PIN 2726)
    let authState = adminAuthStates.get(userId) || { step: null, enteredPin: false, enteredPass: false };

    // A. Nhập mã PIN 2726
    if (text === PROJECT_PIN) {
        authState.enteredPin = true;
        if (authState.enteredPass) {
            // Cả hai đã hoàn tất!
            adminAuthStates.delete(userId);
            await sendTg(botToken, chatId, `👑 <b>[SUPER ADMIN TOÀN QUYỀN ĐÃ MỞ KHÓA 100%]</b>\n──────────────────────\n🔑 Mã PIN: <code>2726</code> (Trí nhớ dự án đã nạp)\n🛡️ Mật mã quản trị: <b>Chính xác!</b>\n🚀 Bro có thể điều hành và phát triển dự án từ xa ngay trên Cloud 24/7!`, threadId);
            return;
        } else {
            authState.step = "AWAIT_PASS";
            adminAuthStates.set(userId, authState);
            await sendTg(botToken, chatId, `👑 <b>[XÁC THỰC QUẢN TRỊ VIÊN]</b>\n──────────────────────\n✅ Đã nhận diện mã PIN dự án: <code>2726</code>!\n🔑 Vui lòng nhập <b>Mật mã Quản trị Tối cao</b> để kích hoạt toàn quyền:`, threadId);
            return;
        }
    }

    // B. Nhập Mật mã Quản trị Tối cao
    if (text === MASTER_PASSWORD) {
        authState.enteredPass = true;
        if (authState.enteredPin) {
            // Cả hai đã hoàn tất!
            adminAuthStates.delete(userId);
            await sendTg(botToken, chatId, `👑 <b>[SUPER ADMIN TOÀN QUYỀN ĐÃ MỞ KHÓA 100%]</b>\n──────────────────────\n🔑 Mật mã quản trị: <b>Chính xác!</b>\n🧠 Mã PIN 2726: <b>Đã đồng bộ trí nhớ dự án!</b>\n🚀 Bro có thể điều hành và phát triển dự án từ xa ngay trên Cloud 24/7!`, threadId);
            return;
        } else {
            authState.step = "AWAIT_PIN";
            adminAuthStates.set(userId, authState);
            await sendTg(botToken, chatId, `👑 <b>[MẬT MÃ QUẢN TRỊ HỢP LỆ]</b>\n──────────────────────\n✅ Mật mã chính xác!\n🧠 Vui lòng nhập <b>Mã PIN 4 số của dự án</b> (<code>2726</code>) để liên kết trí nhớ:`, threadId);
            return;
        }
    }

    // 3. LỆNH CHUYỂN TIẾP PC / CLOUD
    if (["/pc", "/connect", "/ketnoi"].includes(text)) {
        try {
            await fetch(`https://api.telegram.org/bot${botToken}/deleteWebhook`);
        } catch (e) {}
        await sendTg(botToken, chatId, "🖥️ <b>[TIẾP NHẬN LỆNH /PC]</b>\n──────────────────────\n✅ Cloudflare đã nhường quyền cho PC chính ở nhà! PC tiếp quản ngay lập tức!", threadId);
        return;
    }

    if (["/cancel", "/stop"].includes(text)) {
        await sendTg(botToken, chatId, "🛑 <b>[ĐÃ DỪNG TOÀN BỘ TÁC VỤ CLOUD]</b>", threadId);
        return;
    }

    // 4. XỬ LÝ PROMPT LẬP TRÌNH BÌNH THƯỜNG TRONG TOPIC DỰ ÁN
    const ghToken = (env && env.GITHUB_TOKEN) ? env.GITHUB_TOKEN : DEFAULT_GH_TOKEN;
    const ghOwner = (env && env.GITHUB_OWNER) ? env.GITHUB_OWNER : "letrungquangm-alt";
    const currentRepo = (env && env.CURRENT_REPO) ? env.CURRENT_REPO : "Quin-Iu-Mthu-Code-mobile";
    let groqKeys = DEFAULT_GROQ_KEYS;
    let geminiKeys = DEFAULT_GEMINI_KEYS;

    const preview = text.replace(/[<>]/g, "").substring(0, 50);
    const start = Date.now();
    const ackId = await sendTg(botToken, chatId, `⏳ <b>[QUINLOVERIN 3.8 CLOUD 24/7]</b>\n──────────────────────\n⚡ <i>Đang xử lý qua Groq LPU...</i>\n📝 <code>${preview}</code>`, threadId);

    let answer = "";
    let modelUsed = "Groq LPU Qwen 3.8 27B";
    let shouldEscalate = false;

    // Gọi Groq LPU
    for (const gKey of groqKeys) {
        try {
            const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                method: "POST",
                headers: { "Authorization": "Bearer " + gKey, "Content-Type": "application/json" },
                body: JSON.stringify({
                    model: "qwen/qwen3.8-27b",
                    messages: [{ role: "system", content: SYSTEM_INSTRUCTION }, { role: "user", content: text }],
                    max_tokens: 2048,
                    temperature: 0.7
                })
            });
            if (groqRes.status === 200) {
                const gData = await groqRes.json();
                if (gData.choices && gData.choices[0]) {
                    answer = gData.choices[0].message.content.trim();
                    if (answer.includes("[ESCALATE_TO_GEMINI]")) shouldEscalate = true;
                    break;
                }
            }
        } catch (e) {}
    }

    // Escalation Gemini nếu cần
    if (!answer || shouldEscalate) {
        for (const gemKey of geminiKeys) {
            try {
                const gemRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${gemKey}`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        contents: [{ role: "user", parts: [{ text: text }] }],
                        systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] }
                    })
                });
                if (gemRes.status === 200) {
                    const gemData = await gemRes.json();
                    if (gemData.candidates && gemData.candidates[0]) {
                        const parts = gemData.candidates[0].content.parts || [];
                        answer = parts.map(p => p.text || "").join("\n").trim();
                        modelUsed = "Gemini 3.5 Flash Escalation";
                        break;
                    }
                }
            } catch (e) {}
        }
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
Write-Host " 🚀 QUINLOVERIN NET ONBOARDING (GM-TELE ĐẦU NÃO)          " -ForegroundColor Yellow
Write-Host " Kết nối máy net / máy mới thẳng với Cloudflare & Telegram " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host ""

$workerUrl = "${workerOrigin}"

# 1. Khởi tạo mã CMD ngẫu nhiên 3 số
$cmdCode = (Get-Random -Minimum 100 -Maximum 999).ToString()

# 2. Đăng ký lệnh 'quinloverin' toàn cục vào máy
$binDir = "$env:USERPROFILE\\.quinloverin"
if (-not (Test-Path $binDir)) { New-Item -ItemType Directory -Path $binDir -Force | Out-Null }
$cmdWrapper = "@echo off\`r\`npowershell -ExecutionPolicy Bypass -Command \\"irm $workerUrl/net | iex\\""
Set-Content -Path "$binDir\\quinloverin.cmd" -Value $cmdWrapper -Encoding ASCII
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
    Write-Host " 📡 ĐÃ GỬI THÔNG TIN VỀ GM-TELE (ĐẦU NÃO)" -ForegroundColor Green
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
