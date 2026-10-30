// src/worker.js - QuinloveRin 3.8 24/7 Cloudflare Worker (Groq LPU + Gemini Flash Tier 2)

function fromHex(hex) {
    let str = "";
    for (let i = 0; i < hex.length; i += 2) {
        str += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
    }
    return str;
}

const DEFAULT_BOT_TOKEN = fromHex("393239353537363436383a414145446b7832735a427a667847536e4f4d46707276687748494f513470445f786d51");
const DEFAULT_GH_TOKEN = fromHex("6768705f5874306d7469624977677641346e4c3639354937314643526669396c53783347376b324d");
const DEFAULT_GROQ_KEYS = JSON.parse(fromHex("5b2267736b5f4b3077423264724d627775466771775550454b7757476479623346597563306647317379464951576b3749326e646d6838326e79222c2267736b5f7643646d556c6a583945776a556470466f6f363457476479623346594c456657534771374e4b7a556c4a7a35396f6344706c6652222c2267736b5f786f62576f563336766b41577959353647654d3457476479623346596a56366c6d41676f754b735963566d7350384a45546e6b58222c2267736b5f6e69537472577655316a427763776353434d4b5557476479623346594c47504737667a4c715579795137393357624a71436f5065222c2267736b5f4d41366238564f37466f71616931436274427559574764796233465974356d6b5674527a786f64766450354f725637746463674f222c2267736b5f446b736b794b5a3556556955596c76714631544857476479623346595055505050666175616d666a774f536764304e4a467a4d6a222c2267736b5f4e596f67765a5948594c6e61374b45377732343457476479623346596d36774c4d49653656423847797143365863425149355142225d"));
const DEFAULT_GEMINI_KEYS = JSON.parse(fromHex("5b2241512e416238524e364c5f524e75776664764a6a51784f635833476631304f54362d67697951723248484b72384c39377a78356a41222c2241512e416238524e364a30384662676839304951496c6a53493730337846507330546435594479726b49485a784273526345575a41222c2241512e416238524e364c5a4f474c43386359634e34446c634e74464b78763478627a6f41537656746661384d5a57674a5432514f51222c2241512e416238524e364a6a465f7958684d49446b766b4b78487a6d6579766241525f6772763257577357714b4e565a4e784c467767222c2241512e416238524e364a4f75637467545f7852616861545231535f454b71746b50645a726a465734306a654644415957334e524977222c2241512e416238524e364a6632622d6957654e58584a706b5431785a713630365a2d55766e5a4c363831654349375663325453673467225d"));

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

        if (request.method === "GET") {
            if (url.pathname === "/ping") return new Response("pong", { status: 200 });
            return new Response("🚀 QuinloveRin 3.8 Cloudflare Worker 24/7 Active!", { status: 200 });
        }

        if (request.method === "POST") {
            try {
                const body = await request.json();
                if (body && body.message) {
                    ctx.waitUntil(handleTelegramUpdate(body, env));
                }
                return new Response("OK", { status: 200 });
            } catch (e) {
                return new Response("Bad Request: " + e.message, { status: 400 });
            }
        }

        return new Response("Method Not Allowed", { status: 405 });
    }
};

async function handleTelegramUpdate(update, env) {
    const msg = update.message;
    if (!msg) return;

    const botToken = (env && env.BOT_TOKEN) ? env.BOT_TOKEN : DEFAULT_BOT_TOKEN;
    const ghToken = (env && env.GITHUB_TOKEN) ? env.GITHUB_TOKEN : DEFAULT_GH_TOKEN;
    const ghOwner = (env && env.GITHUB_OWNER) ? env.GITHUB_OWNER : "letrungquangm-alt";
    const currentRepo = (env && env.CURRENT_REPO) ? env.CURRENT_REPO : "Quin-Iu-Mthu-Code-mobile";

    let groqKeys = DEFAULT_GROQ_KEYS;
    if (env && env.GROQ_API_KEYS) {
        try {
            groqKeys = typeof env.GROQ_API_KEYS === "string" ? JSON.parse(env.GROQ_API_KEYS) : env.GROQ_API_KEYS;
        } catch (e) {
            groqKeys = [env.GROQ_API_KEYS];
        }
    }

    let geminiKeys = DEFAULT_GEMINI_KEYS;
    if (env && env.GEMINI_API_KEYS) {
        try {
            geminiKeys = typeof env.GEMINI_API_KEYS === "string" ? JSON.parse(env.GEMINI_API_KEYS) : env.GEMINI_API_KEYS;
        } catch (e) {
            geminiKeys = [env.GEMINI_API_KEYS];
        }
    }

    const chatId = msg.chat ? msg.chat.id : null;
    const threadId = msg.message_thread_id || null;
    const text = (msg.text || msg.caption || "").trim();

    if (!chatId || !text || !botToken) return;

    // Lệnh chuyển tiếp PC
    if (["/pc", "/connect", "/ketnoi", "2726"].includes(text)) {
        try {
            await fetch(`https://api.telegram.org/bot${botToken}/deleteWebhook`);
        } catch (e) {}
        await sendTg(botToken, chatId, "🖥️ <b>[TIẾP NHẬN LỆNH /PC]</b>\n──────────────────────\n✅ Cloudflare đã nhường quyền điều khiển cho PC ở nhà! PC tiếp quản ngay lập tức!", threadId);
        return;
    }

    if (["/cancel", "/stop"].includes(text)) {
        await sendTg(botToken, chatId, "🛑 <b>[ĐÃ DỪNG TÁC VỤ CLOUD]</b>", threadId);
        return;
    }

    const preview = text.replace(/[<>]/g, "").substring(0, 50);
    const start = Date.now();

    // Gửi bong bóng chờ
    const ackId = await sendTg(botToken, chatId, `⏳ <b>[QUINLOVERIN 3.8 CLOUD 24/7]</b>\n──────────────────────\n⚡ <i>Đang xử lý siêu tốc qua Groq LPU...</i>\n📝 <code>${preview}</code>`, threadId);

    let answer = "";
    let modelUsed = "Groq LPU Qwen 3.8 27B";
    let shouldEscalate = false;

    // 1. Gọi Groq LPU
    for (const gKey of groqKeys) {
        try {
            const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                method: "POST",
                headers: {
                    "Authorization": "Bearer " + gKey,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    model: "qwen/qwen3.8-27b",
                    messages: [
                        { role: "system", content: SYSTEM_INSTRUCTION },
                        { role: "user", content: text }
                    ],
                    max_tokens: 2048,
                    temperature: 0.7
                })
            });

            if (groqRes.status === 200) {
                const gData = await groqRes.json();
                if (gData.choices && gData.choices[0]) {
                    answer = gData.choices[0].message.content.trim();
                    if (answer.includes("[ESCALATE_TO_GEMINI]")) {
                        shouldEscalate = true;
                    }
                    break;
                }
            }
        } catch (e) {}
    }

    // 2. Chuyển giao Gemini API nếu cần
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

    if (!answer) {
        answer = "Hệ thống Cloud đang nâng cấp kết nối, bro hãy gửi lại yêu cầu nhé!";
    }

    const elapsedSec = ((Date.now() - start) / 1000).toFixed(1);

    // 3. Tự động commit code lên GitHub nếu có block commit
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

    // Xóa tin nhắn chờ và gửi câu trả lời
    if (ackId) await deleteTg(botToken, chatId, ackId);
    await sendTg(botToken, chatId, reply, threadId);
}

async function sendTg(token, chatId, text, threadId) {
    const payload = { chat_id: chatId, text: text, parse_mode: "HTML", disable_web_page_preview: true };
    if (threadId && Number(threadId) > 0) payload.message_thread_id = Number(threadId);
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
