// src/worker.js - QuinloveRin 3.8 24/7 Cloudflare Worker (Groq LPU + Gemini Flash Tier 2)

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

    const botToken = env.BOT_TOKEN;
    const ghToken = env.GITHUB_TOKEN;
    const ghOwner = env.GITHUB_OWNER || "letrungquangm-alt";
    const currentRepo = env.CURRENT_REPO || "Quin-Iu-Mthu-Code-mobile";

    let groqKeys = [];
    if (env.GROQ_API_KEYS) {
        try {
            groqKeys = typeof env.GROQ_API_KEYS === "string" ? JSON.parse(env.GROQ_API_KEYS) : env.GROQ_API_KEYS;
        } catch (e) {
            groqKeys = [env.GROQ_API_KEYS];
        }
    }

    let geminiKeys = [];
    if (env.GEMINI_API_KEYS) {
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
        await sendTg(botToken, chatId, "🖥️ <b>[TIẾP NHẬN LỆNH /PC]</b>\n──────────────────────\nCloudflare đã sẵn sàng nhường quyền cho PC ở nhà khi PC online!", threadId);
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
