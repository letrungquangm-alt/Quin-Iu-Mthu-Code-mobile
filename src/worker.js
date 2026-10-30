// src/worker.js - QuinloveRin 3.8 24/7 Cloudflare Worker with Direct Net PC Protocol (gm_xxx-yyy_mthu)

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

// Quản lý phiên máy phụ (Net PC sessions) & lệnh hàng đợi
let activeSessions = new Map(); // sessionId -> { cmdCode, teleCode, hostname, os, drive, lastSeen }
let pendingCommands = [];       // { id, sessionId, command, chatId, threadId }
let latestSessionId = null;

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
        const defaultChatId = "-1004457846636";
        const defaultThreadId = 1160;

        // 1. Tải script cài đặt cho máy net mới: GET /net hoặc GET /bootstrap
        if (request.method === "GET" && (url.pathname === "/net" || url.pathname === "/bootstrap")) {
            return serveBootstrapScript(url.origin);
        }

        // 2. Healthcheck ping
        if (request.method === "GET" && url.pathname === "/ping") {
            return new Response("pong", { status: 200 });
        }

        // 3. Handshake đăng ký máy phụ từ CMD (quinloverin)
        if (request.method === "POST" && url.pathname === "/net/handshake") {
            try {
                const body = await request.json();
                const cmdCode = (body.cmd_code || "100").toString().padStart(3, "0");
                const teleCode = Math.floor(100 + Math.random() * 900).toString();
                const sessionId = `gm_${cmdCode}-${teleCode}_mthu`;
                const hostname = body.hostname || "PC-Net";
                const drive = body.drive || "D:";
                const osName = body.os || "Windows";

                activeSessions.set(sessionId, {
                    cmdCode,
                    teleCode,
                    hostname,
                    drive,
                    os: osName,
                    lastSeen: Date.now()
                });
                latestSessionId = sessionId;

                // Bắn thông báo xác thực tới Telegram Topic #1160
                const notifyMsg = `🖥️ <b>[MÁY PHỤ / QUÁN NET ĐÃ KẾT NỐI TRỰC TIẾP]</b>\n──────────────────────\n🏷️ <b>Mã định danh phiên:</b> <code>${sessionId}</code>\n💻 <b>Thiết bị:</b> <code>${hostname}</code> (Ổ <b>${drive}</b>, ${osName})\n⚡ <b>Giao thức:</b> Kênh điều khiển Remote Terminal trực tiếp (Không qua Antigravity)\n\n👉 <b>Bro gõ lệnh từ Telegram:</b> <code>/cmd &lt;lệnh&gt;</code>\n<i>Ví dụ: <code>/cmd dir ${drive}\\</code> hoặc <code>/cmd git status</code></i>`;
                ctx.waitUntil(sendTg(botToken, defaultChatId, notifyMsg, defaultThreadId));

                return new Response(JSON.stringify({
                    ok: true,
                    session_id: sessionId,
                    cmd_code: cmdCode,
                    tele_code: teleCode
                }), { headers: { "Content-Type": "application/json" } });
            } catch (e) {
                return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 400 });
            }
        }

        // 4. Máy phụ thăm dò lệnh từ xa: GET /cmd/poll?session=...
        if (request.method === "GET" && url.pathname === "/cmd/poll") {
            const reqSession = url.searchParams.get("session") || latestSessionId;
            if (activeSessions.has(reqSession)) {
                activeSessions.get(reqSession).lastSeen = Date.now();
            }

            const cmdIndex = pendingCommands.findIndex(c => !c.sessionId || c.sessionId === reqSession);
            if (cmdIndex !== -1) {
                const cmdItem = pendingCommands.splice(cmdIndex, 1)[0];
                return new Response(JSON.stringify({
                    has_command: true,
                    cmd_id: cmdItem.id,
                    command: cmdItem.command,
                    session: reqSession
                }), { headers: { "Content-Type": "application/json" } });
            }

            return new Response(JSON.stringify({ has_command: false }), { headers: { "Content-Type": "application/json" } });
        }

        // 5. Máy phụ trả kết quả thực thi terminal: POST /cmd/result
        if (request.method === "POST" && url.pathname === "/cmd/result") {
            try {
                const resBody = await request.json();
                const cmdOutput = resBody.output || "[Không có đầu ra]";
                const cmdText = resBody.command || "";
                const exitCode = resBody.exit_code !== undefined ? resBody.exit_code : 0;
                const sess = resBody.session || latestSessionId || "gm_cmd_mthu";

                const cleanOut = escapeHtml(cmdOutput.length > 3500 ? cmdOutput.substring(0, 3500) + "\n...[Output bị cắt bớt vì quá dài]" : cmdOutput);
                const statusIcon = exitCode === 0 ? "✅" : "⚠️";

                const teleReply = `💻 <b>[TERMINAL MÁY PHỤ]</b> ${statusIcon} (Exit code: ${exitCode})\n🏷️ <b>Phiên:</b> <code>${sess}</code>\n⌨️ <b>Lệnh:</b> <code>${escapeHtml(cmdText)}</code>\n──────────────────────\n<pre><code class="language-text">${cleanOut}</code></pre>`;
                ctx.waitUntil(sendTg(botToken, defaultChatId, teleReply, defaultThreadId));

                return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
            } catch (e) {
                return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 400 });
            }
        }

        // 6. Xử lý webhook chính từ Telegram
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

        return new Response("🚀 QuinloveRin 3.8 Cloudflare Worker 24/7 Active!", { status: 200 });
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

    // Lệnh chuyển tiếp PC chính ở nhà
    if (["/pc", "/connect", "/ketnoi", "2726"].includes(text)) {
        try {
            await fetch(`https://api.telegram.org/bot${botToken}/deleteWebhook`);
        } catch (e) {}
        await sendTg(botToken, chatId, "🖥️ <b>[TIẾP NHẬN LỆNH /PC]</b>\n──────────────────────\n✅ Cloudflare đã nhường quyền cho PC chính ở nhà! PC sẽ tiếp quản ngay lập tức!", threadId);
        return;
    }

    if (["/cancel", "/stop"].includes(text)) {
        pendingCommands = [];
        await sendTg(botToken, chatId, "🛑 <b>[ĐÃ DỪNG TOÀN BỘ TÁC VỤ & HÀNG ĐỢI CLOUD]</b>", threadId);
        return;
    }

    // LỆNH ĐIỀU KHIỂN REMOTE CMD TRÊN MÁY PHỤ / QUÁN NET (/cmd <lệnh>)
    const cmdMatch = text.match(/^(?:\/cmd|\/sh|\/exec|\/terminal)(?:\s+([\s\S]+))?$/i);
    if (cmdMatch) {
        const cmdToRun = cmdMatch[1];
        if (!cmdToRun) {
            await sendTg(botToken, chatId, "⚠️ <b>[CÚ PHÁP ĐIỀU KHIỂN CMD]</b>\n──────────────────────\nVí dụ:\n• <code>/cmd dir D:\\</code>\n• <code>/cmd git status</code>\n• <code>/cmd ipconfig</code>", threadId);
            return;
        }

        if (!latestSessionId) {
            await sendTg(botToken, chatId, "⚠️ <b>[CHƯA CÓ MÁY PHỤ / NET KẾT NỐI]</b>\n──────────────────────\nℹ️ Hãy mở CMD trên máy net và gõ: <code>quinloverin</code> để kết nối tạo mã <code>gm_xxx-yyy_mthu</code> trước nhé!", threadId);
            return;
        }

        const cmdId = "cmd_" + Date.now();
        pendingCommands.push({
            id: cmdId,
            sessionId: latestSessionId,
            command: cmdToRun,
            chatId: chatId,
            threadId: threadId
        });

        await sendTg(botToken, chatId, `⚡ <b>[ĐÃ GỬI LỆNH TỚI MÁY PHỤ]</b>\n🏷️ <b>Phiên:</b> <code>${latestSessionId}</code>\n⌨️ <b>Lệnh:</b> <code>${escapeHtml(cmdToRun)}</code>\n⏳ Đang chờ máy phụ thực thi và trả kết quả...`, threadId);
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

function escapeHtml(str) {
    return (str || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
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

// Script bootstrap PowerShell tải về máy net
function serveBootstrapScript(workerOrigin) {
    const psCode = `
# ========================================================
# QUINLOVERIN DIRECT CMD CONNECTOR - PROTOCOL gm_xxx-yyy_mthu
# ========================================================
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

Write-Host ""
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host " 🚀 QUINLOVERIN DIRECT CMD CONNECTOR (GIAO THỨC MÁY PHỤ)   " -ForegroundColor Yellow
Write-Host " Kết nối máy net / máy mới thẳng với Cloudflare & Telegram " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host ""

$workerUrl = "${workerOrigin}"

# 1. Khởi tạo mã CMD ngẫu nhiên 3 số
$cmdCode = (Get-Random -Minimum 100 -Maximum 999).ToString()
Write-Host "⚡ [BƯỚC 1] Mã ngẫu nhiên CMD: " -NoNewline
Write-Host "[$cmdCode]" -ForegroundColor Green

# 2. Hỏi ổ đĩa làm việc
$drives = Get-PSDrive -PSProvider FileSystem | Where-Object { $_.Free -gt 1GB } | Select-Object -ExpandProperty Name
$defaultDrive = if ($drives -contains 'D') { 'D' } else { 'C' }
$chosenDrive = Read-Host "📁 Chọn ổ đĩa làm việc trên máy này (Mặc định: $defaultDrive)"
if (-not $chosenDrive) { $chosenDrive = $defaultDrive }
$workDir = "$($chosenDrive):\\QuinloveRin_Workspace"
if (-not (Test-Path $workDir)) { New-Item -ItemType Directory -Path $workDir -Force | Out-Null }
Set-Location $workDir
Write-Host "   -> Thư mục làm việc: $workDir" -ForegroundColor Gray

# 3. Đăng ký lệnh 'quinloverin' toàn cục vào máy
$binDir = "$env:USERPROFILE\\.quinloverin"
if (-not (Test-Path $binDir)) { New-Item -ItemType Directory -Path $binDir -Force | Out-Null }
$cmdWrapper = "@echo off\`r\`npowershell -ExecutionPolicy Bypass -Command \\"irm $workerUrl/net | iex\\""
Set-Content -Path "$binDir\\quinloverin.cmd" -Value $cmdWrapper -Encoding ASCII
$currentPath = [System.Environment]::GetEnvironmentVariable("Path", "User")
if ($currentPath -notlike "*$binDir*") {
    [System.Environment]::SetEnvironmentVariable("Path", "$currentPath;$binDir", "User")
    $env:Path += ";$binDir"
    Write-Host "✨ Đã đăng ký lệnh toàn cục 'quinloverin' vào hệ thống!" -ForegroundColor Green
}

# 4. Gửi Handshake bắt tay với Cloudflare
Write-Host "📡 [BƯỚC 2] Đang bắt tay xác thực với Cloudflare Worker 24/7..." -ForegroundColor Yellow
$handshakeBody = @{
    cmd_code = $cmdCode
    hostname = $env:COMPUTERNAME
    drive = "$($chosenDrive):"
    os = (Get-CimInstance Win32_OperatingSystem).Caption
} | ConvertTo-Json

try {
    $resp = Invoke-RestMethod -Uri "$workerUrl/net/handshake" -Method POST -Body $handshakeBody -ContentType "application/json" -TimeoutSec 15
    $sessionId = $resp.session_id
    $teleCode = $resp.tele_code

    Write-Host ""
    Write-Host "==========================================================" -ForegroundColor Green
    Write-Host " ✅ KẾT NỐI MÁY PHỤ THÀNH CÔNG RỰC RỠ!" -ForegroundColor Green
    Write-Host " 🔑 MÃ ĐỊNH DANH PHIÊN: " -NoNewline
    Write-Host "$sessionId" -ForegroundColor Yellow
    Write-Host " 📱 Đã gửi mã '$sessionId' về Telegram Topic #1160" -ForegroundColor Cyan
    Write-Host " ⌨️ Giờ bro có thể điều khiển máy này từ Telegram qua:" -ForegroundColor Gray
    Write-Host "    /cmd <lệnh_bất_kỳ>" -ForegroundColor Yellow
    Write-Host "==========================================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "⚡ Đang lắng nghe lệnh trực tiếp từ Telegram... (Bấm Ctrl+C để thoát)" -ForegroundColor Gray

    # 5. Vòng lặp nhận lệnh Remote Terminal
    while ($true) {
        Start-Sleep -Milliseconds 1500
        try {
            $poll = Invoke-RestMethod -Uri "$workerUrl/cmd/poll?session=$sessionId" -Method GET -TimeoutSec 10
            if ($poll.has_command) {
                $cmdToRun = $poll.command
                $cmdId = $poll.cmd_id
                Write-Host "[Telegram Exec]: $cmdToRun" -ForegroundColor Cyan

                $cmdOutput = ""
                $exitCode = 0
                try {
                    $cmdOutput = Invoke-Expression $cmdToRun 2>&1 | Out-String
                } catch {
                    $cmdOutput = $_.Exception.Message
                    $exitCode = 1
                }

                if (-not $cmdOutput) { $cmdOutput = "[Lệnh đã thực thi xong (Không có đầu ra văn bản)]" }

                $resultBody = @{
                    cmd_id = $cmdId
                    session = $sessionId
                    command = $cmdToRun
                    output = $cmdOutput
                    exit_code = $exitCode
                } | ConvertTo-Json

                Invoke-RestMethod -Uri "$workerUrl/cmd/result" -Method POST -Body $resultBody -ContentType "application/json" -TimeoutSec 10 | Out-Null
            }
        } catch {}
    }
} catch {
    Write-Host "❌ Lỗi kết nối Cloudflare: $($_.Exception.Message)" -ForegroundColor Red
}
`;
    return new Response(psCode, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
