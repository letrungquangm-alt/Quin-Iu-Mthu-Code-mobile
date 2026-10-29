// Vercel Serverless Function: Telegram Webhook 24/7 Cloud GitOps
// Hoạt động 24/7 ngay cả khi máy tính chính bị cúp điện hoặc tắt nguồn
// Tự động đọc / ghi / commit code lên GitHub Repo để đồng bộ với máy nhà

const BOT_TOKEN = process.env.BOT_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const ALLOWED_CHAT_ID = process.env.ALLOWED_CHAT_ID ? String(process.env.ALLOWED_CHAT_ID) : '';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const GITHUB_OWNER = process.env.GITHUB_OWNER || 'letrungquangm-alt';
let CURRENT_ACTIVE_REPO = process.env.DEFAULT_REPO || 'Quin-Iu-Mthu-Code-mobile';

// --- TIỆN ÍCH XỬ LÝ TIN NHẮN TELEGRAM ---

function splitTelegramText(text, maxLen = 3500) {
    const chunks = [];
    if (!text) return chunks;

    while (text.length > maxLen) {
        let splitIdx = text.lastIndexOf('\n\n', maxLen);
        if (splitIdx < maxLen / 2) {
            splitIdx = text.lastIndexOf('\n', maxLen);
        }
        if (splitIdx < maxLen / 2) {
            splitIdx = text.lastIndexOf('. ', maxLen);
        }
        if (splitIdx < maxLen / 2) {
            splitIdx = maxLen;
        } else {
            splitIdx += 1;
        }

        const chunk = text.substring(0, splitIdx).trim();
        if (chunk) chunks.push(chunk);
        text = text.substring(splitIdx).trim();
    }
    if (text) chunks.push(text);
    return chunks;
}

function convertMdToTgHtml(text) {
    if (!text) return '';
    let s = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

    s = s.replace(/```([a-zA-Z0-9_\-\+]*)\n([\s\S]*?)```/g, (match, lang, code) => {
        return `<pre><code>${code}</code></pre>`;
    });

    s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
    s = s.replace(/\*\*([^\*\r\n]+)\*\*/g, '<b>$1</b>');
    s = s.replace(/(?<!\w)\*([^\*\r\n]+)\*(?!\w)/g, '<i>$1</i>');
    s = s.replace(/^&gt;\s*([^\r\n]+)/gm, '<blockquote>$1</blockquote>');

    return s;
}

async function sendTelegramMessage(chatId, text, parseMode = 'HTML', replyMarkup = null) {
    if (!text) return null;
    const chunks = splitTelegramText(text, 3500);
    const totalParts = chunks.length;

    for (let i = 0; i < totalParts; i++) {
        let chunkText = chunks[i];
        if (totalParts > 1) {
            chunkText = `<b>[Phần ${i + 1}/${totalParts}]</b>\n` + chunkText;
        }

        const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
        const bodyObj = {
            chat_id: chatId,
            text: chunkText,
            disable_web_page_preview: true
        };
        if (parseMode) bodyObj.parse_mode = parseMode;
        if (replyMarkup && i === totalParts - 1) bodyObj.reply_markup = replyMarkup;

        try {
            const resp = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(bodyObj)
            });
            const data = await resp.json();
            if (!data.ok && parseMode) {
                delete bodyObj.parse_mode;
                await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(bodyObj)
                });
            }
        } catch (err) {
            console.error('Error sending Telegram message:', err);
        }

        if (totalParts > 1 && i < totalParts - 1) {
            await new Promise(r => setTimeout(r, 150));
        }
    }
}

// --- GITHUB REST API ENGINE ---

async function fetchGitHub(endpoint, method = 'GET', body = null) {
    if (!GITHUB_TOKEN) return { ok: false, error: 'Chưa cấu hình GITHUB_TOKEN trên Vercel.' };
    const url = `https://api.github.com${endpoint}`;
    const headers = {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'User-Agent': 'QuinloveRin-Cloud-GitOps',
        'Accept': 'application/vnd.github.v3+json'
    };
    if (body) headers['Content-Type'] = 'application/json';

    try {
        const resp = await fetch(url, {
            method,
            headers,
            body: body ? JSON.stringify(body) : null
        });
        const data = await resp.json();
        return { ok: resp.ok, status: resp.status, data };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

async function listGitHubRepos() {
    const res = await fetchGitHub(`/users/${GITHUB_OWNER}/repos?sort=updated&per_page=15`);
    if (res.ok && Array.isArray(res.data)) {
        return res.data.map(r => ({
            name: r.name,
            fullName: r.full_name,
            private: r.private,
            updatedAt: r.updated_at
        }));
    }
    return [];
}

async function listRepoFiles(repo, path = '') {
    const res = await fetchGitHub(`/repos/${GITHUB_OWNER}/${repo}/contents/${path}`);
    if (res.ok && Array.isArray(res.data)) {
        return res.data.map(item => ({
            name: item.name,
            path: item.path,
            type: item.type, // 'file' or 'dir'
            size: item.size
        }));
    }
    return null;
}

async function readRepoFile(repo, path) {
    const res = await fetchGitHub(`/repos/${GITHUB_OWNER}/${repo}/contents/${path}`);
    if (res.ok && res.data && res.data.content) {
        const text = Buffer.from(res.data.content, 'base64').toString('utf-8');
        return { text, sha: res.data.sha };
    }
    return null;
}

async function commitFileToGitHub(repo, path, content, commitMessage = 'feat(cloud): update file via Telegram') {
    // 1. Kiểm tra xem file đã tồn tại trên repo chưa để lấy SHA
    let existingSha = undefined;
    const checkRes = await fetchGitHub(`/repos/${GITHUB_OWNER}/${repo}/contents/${path}`);
    if (checkRes.ok && checkRes.data?.sha) {
        existingSha = checkRes.data.sha;
    }

    // 2. Commit file mới hoặc cập nhật
    const b64 = Buffer.from(content, 'utf-8').toString('base64');
    const body = {
        message: commitMessage,
        content: b64
    };
    if (existingSha) body.sha = existingSha;

    const putRes = await fetchGitHub(`/repos/${GITHUB_OWNER}/${repo}/contents/${path}`, 'PUT', body);
    if (putRes.ok && putRes.data?.commit) {
        return {
            success: true,
            sha: putRes.data.commit.sha,
            htmlUrl: putRes.data.content?.html_url || `https://github.com/${GITHUB_OWNER}/${repo}/blob/main/${path}`
        };
    }
    return {
        success: false,
        error: putRes.data?.message || 'Không thể commit lên GitHub'
    };
}

// --- GEMINI AI VỚI TỰ ĐỘNG PHÁT HIỆN & COMMIT CODE ---

async function askGeminiText(userText, currentRepo) {
    const sysPrompt = `Bạn là trợ lý lập trình AI siêu cấp QuinloveRin Code hoạt động 24/7 trên Vercel Cloud khi máy tính chính bị tắt hoặc cúp điện.
Hiện tại, dự án và GitHub Repo đang làm việc là: "${currentRepo}" của chủ tài khoản GitHub: "${GITHUB_OWNER}".

QUY TẮC BẮT BUỘC KHI SINH HOẶC CHỈNH SỬA CODE:
1. Khi người dùng yêu cầu viết code, tạo file hoặc chỉnh sửa mã nguồn cho dự án:
   Bạn PHẢI đặt toàn bộ nội dung file code bên trong khối đánh dấu sau để hệ thống Vercel tự động commit đẩy thẳng lên GitHub Repo "${currentRepo}":
   \`\`\`commit:<đường_dẫn_file>
   <nội dung code đầy đủ>
   \`\`\`
   Ví dụ:
   \`\`\`commit:index.html
   <!DOCTYPE html>
   ...
   \`\`\`
2. Trả lời chi tiết, chuyên nghiệp, bằng Tiếng Việt có dấu chuẩn 100%. Luôn xưng hô "tôi - bro", tuyệt đối không dùng "anh - em".
3. Nhắc nhở người dùng rằng code đã được đẩy lên GitHub an toàn, khi máy tính chính bật lại sẽ tự động git pull về ổ cứng.`;

    const models = ['gemini-2.5-flash', 'gemini-flash-latest', 'gemini-flash-lite-latest'];

    for (const model of models) {
        try {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
            const payload = {
                systemInstruction: { parts: [{ text: sysPrompt }] },
                contents: [{ role: 'user', parts: [{ text: userText }] }]
            };

            const resp = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await resp.json();
            if (data.candidates && data.candidates[0]?.content?.parts?.[0]?.text) {
                return data.candidates[0].content.parts[0].text;
            }
        } catch (e) {
            console.error(`Gemini model ${model} error:`, e);
        }
    }
    return 'Cloud AI đang tạm thời bận, bro hãy gửi lại tin nhắn nhé!';
}

async function askGeminiVision(userText, base64Image, mimeType = 'image/jpeg') {
    const sysPrompt = "Bạn là trợ lý lập trình AI siêu cấp QuinloveRin Code có thị giác máy tính (Vision) hoạt động 24/7 trên Vercel Cloud. Hãy quan sát ảnh kỹ lưỡng và giải thích, hướng dẫn bằng Tiếng Việt có dấu chuẩn xác. Xưng hô 'tôi - bro'.";
    const models = ['gemini-2.5-flash', 'gemini-flash-latest', 'gemini-flash-lite-latest'];

    for (const model of models) {
        try {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
            const payload = {
                systemInstruction: { parts: [{ text: sysPrompt }] },
                contents: [{
                    role: 'user',
                    parts: [
                        { text: userText || 'Hãy quan sát bức ảnh này và phân tích chi tiết giúp tôi.' },
                        { inlineData: { mimeType, data: base64Image } }
                    ]
                }]
            };

            const resp = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await resp.json();
            if (data.candidates && data.candidates[0]?.content?.parts?.[0]?.text) {
                return data.candidates[0].content.parts[0].text;
            }
        } catch (e) {
            console.error(`Gemini Vision model ${model} error:`, e);
        }
    }
    return 'Cloud Vision AI đang tạm thời bận, bro hãy gửi lại ảnh nhé!';
}

// --- VÒNG LẶP XỬ LÝ CHÍNH CỦA VERCEL WEBHOOK ---

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(200).send('QuinloveRin Code Cloud GitOps Webhook is active 24/7 on Vercel.');
    }

    try {
        const update = req.body;
        if (!update) return res.status(200).json({ ok: true });

        // Xử lý Callback Query (nếu người dùng bấm nút inline keyboard)
        if (update.callback_query) {
            const cb = update.callback_query;
            const cbChatId = String(cb.message.chat.id);
            const cbData = cb.data || '';

            if (cbData.startsWith('repo:select:')) {
                const selRepo = cbData.substring(12).trim();
                CURRENT_ACTIVE_REPO = selRepo;
                await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery?callback_query_id=${cb.id}&text=Đã chọn repo ${selRepo}`);
                await sendTelegramMessage(cbChatId, `📁 <b>[ĐÃ CHUYỂN DỰ ÁN CLOUD]</b>\n──────────────────────\n• <b>GitHub Repo</b>: <code>${CURRENT_ACTIVE_REPO}</code>\n• <b>Owner</b>: <code>${GITHUB_OWNER}</code>\n\nMọi file bạn yêu cầu viết tiếp sẽ được commit thẳng vào repo này! Khi máy tính bật lại sẽ tự động git pull về ổ cứng.`);
            }
            return res.status(200).json({ ok: true });
        }

        if (!update.message) return res.status(200).json({ ok: true });

        const msg = update.message;
        const chatId = String(msg.chat.id);

        // Kiểm tra quyền truy cập Chat ID
        if (ALLOWED_CHAT_ID && chatId !== ALLOWED_CHAT_ID) {
            await sendTelegramMessage(chatId, 'Xin lỗi, bạn không có quyền sử dụng Bot này!');
            return res.status(200).json({ ok: true });
        }

        // 1. Chuyển quyền về máy tính (/pc hoặc /local)
        if (msg.text === '/pc' || msg.text === '/local' || msg.text === '/ketnoilai' || msg.text === '/reconnect' || msg.text === '6585' || /^\/ketnoilai\s+6585$/i.test(msg.text)) {
            await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/deleteWebhook`);
            await sendTelegramMessage(chatId, '💻 <b>[ĐÃ BÀN GIAO CHO MÁY TÍNH]</b>\nĐã gỡ Webhook Cloud! Máy tính của bro (nếu đang bật) sẽ tiếp nhận tin nhắn trực tiếp qua Long Polling.');
            return res.status(200).json({ ok: true });
        }

        // 2. Trạng thái Cloud GitOps (/status)
        if (msg.text === '/status') {
            const statusMsg = `☁️ <b>[QUINLOVERIN CLOUD GITOPS 24/7]</b>\n──────────────────────\n• <b>Hạ tầng</b>: Vercel Serverless Global Edge\n• <b>Trạng thái</b>: Trực tuyến 24/7 (Sẵn sàng khi máy nhà tắt)\n• <b>GitHub Owner</b>: <code>${GITHUB_OWNER}</code>\n• <b>Project/Repo Đang Chọn</b>: <code>${CURRENT_ACTIVE_REPO}</code>\n• <b>Cơ chế</b>: Tự động commit lên GitHub khi tạo/sửa file\n\n👉 Gõ <code>/projects</code> hoặc <code>/repos</code> để xem danh sách dự án trên GitHub.\n👉 Gõ <code>/ls</code> để xem cây thư mục của dự án hiện tại.\n👉 Khi máy tính chính bật lại, gõ <code>/pc</code> để điều khiển trực tiếp máy tính!`;
            await sendTelegramMessage(chatId, statusMsg);
            return res.status(200).json({ ok: true });
        }

        // 3. Xem danh sách Projects / Repositories (/projects hoặc /repos)
        if (msg.text === '/projects' || msg.text === '/repos' || msg.text === '/project') {
            const repos = await listGitHubRepos();
            if (repos.length === 0) {
                await sendTelegramMessage(chatId, `📂 Không tìm thấy repo nào trên GitHub của tài khoản <code>${GITHUB_OWNER}</code>.`);
            } else {
                let repoListText = `📂 <b>DANH SÁCH DỰ ÁN TRÊN GITHUB (${repos.length}):</b>\n──────────────────────\n`;
                const buttons = [];
                for (const r of repos) {
                    const isCur = (r.name === CURRENT_ACTIVE_REPO) ? ' (Đang chọn) ✓' : '';
                    repoListText += `• <code>${r.name}</code>${isCur}\n`;
                    buttons.push([{ text: `📁 ${r.name}${isCur}`, callback_data: `repo:select:${r.name}` }]);
                }
                repoListText += `\n<i>👉 Bấm vào nút bên dưới hoặc gõ <code>/use &lt;tên_repo&gt;</code> để chọn dự án tiếp tục làm việc!</i>`;
                await sendTelegramMessage(chatId, repoListText, 'HTML', { inline_keyboard: buttons.slice(0, 8) });
            }
            return res.status(200).json({ ok: true });
        }

        // 4. Đổi repo đang làm việc (/use <repo> hoặc /setrepo <repo>)
        if (msg.text && (msg.text.startsWith('/use ') || msg.text.startsWith('/setrepo '))) {
            const targetRepo = msg.text.split(' ')[1]?.trim();
            if (targetRepo) {
                CURRENT_ACTIVE_REPO = targetRepo;
                await sendTelegramMessage(chatId, `✅ <b>[ĐÃ CHỌN DỰ ÁN]</b>: <code>${CURRENT_ACTIVE_REPO}</code>\nTừ bây giờ mọi file code sinh ra sẽ được commit thẳng vào repo này.`);
            } else {
                await sendTelegramMessage(chatId, 'Cú pháp: <code>/use &lt;tên_repo&gt;</code>');
            }
            return res.status(200).json({ ok: true });
        }

        // 5. Xem danh sách file trong dự án hiện tại (/ls hoặc /dir)
        if (msg.text === '/ls' || msg.text === '/dir') {
            const files = await listRepoFiles(CURRENT_ACTIVE_REPO);
            if (!files) {
                await sendTelegramMessage(chatId, `❌ Không thể đọc danh sách file của repo <code>${CURRENT_ACTIVE_REPO}</code> từ GitHub.`);
            } else {
                let out = `📂 <b>DỰ ÁN: [${CURRENT_ACTIVE_REPO}] (GitHub)</b>\n──────────────────────\n`;
                for (const f of files) {
                    const icon = f.type === 'dir' ? '📁' : '📄';
                    const sizeStr = f.size ? ` (${(f.size / 1024).toFixed(1)} KB)` : '';
                    out += `${icon} <code>${f.path}</code>${sizeStr}\n`;
                }
                out += `\n<i>👉 Gõ <code>/read &lt;tên_file&gt;</code> để xem nội dung file trực tiếp trên GitHub!</i>`;
                await sendTelegramMessage(chatId, out);
            }
            return res.status(200).json({ ok: true });
        }

        // 6. Đọc nội dung file từ GitHub (/read <file_path>)
        if (msg.text && msg.text.startsWith('/read ')) {
            const filePath = msg.text.substring(6).trim();
            const fileData = await readRepoFile(CURRENT_ACTIVE_REPO, filePath);
            if (fileData) {
                const header = `📄 <b>FILE: <code>${filePath}</code> [${CURRENT_ACTIVE_REPO}]</b>\n──────────────────────\n`;
                const safeCode = fileData.text
                    .replace(/&/g, '&amp;')
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;');
                const body = `<pre><code>${safeCode}</code></pre>`;
                await sendTelegramMessage(chatId, header + body);
            } else {
                await sendTelegramMessage(chatId, `❌ Không tìm thấy file <code>${filePath}</code> trong repo <code>${CURRENT_ACTIVE_REPO}</code>.`);
            }
            return res.status(200).json({ ok: true });
        }

        // 7. Lệnh thủ công: /save <path>\n<code>
        if (msg.text && msg.text.startsWith('/save ')) {
            const firstLineBreak = msg.text.indexOf('\n');
            if (firstLineBreak > 0) {
                const filePath = msg.text.substring(6, firstLineBreak).trim();
                const fileContent = msg.text.substring(firstLineBreak + 1);
                await sendTelegramMessage(chatId, `⏳ Đang commit file <code>${filePath}</code> lên GitHub repo <code>${CURRENT_ACTIVE_REPO}</code>...`);
                const commitRes = await commitFileToGitHub(CURRENT_ACTIVE_REPO, filePath, fileContent, `feat(cloud): add ${filePath} via Telegram`);
                if (commitRes.success) {
                    await sendTelegramMessage(chatId, `💾 <b>[ĐÃ COMMIT LÊN GITHUB THÀNH CÔNG]</b>\n──────────────────────\n• <b>Repo</b>: <code>${CURRENT_ACTIVE_REPO}</code>\n• <b>File</b>: <code>${filePath}</code>\n• <b>Commit SHA</b>: <code>${commitRes.sha.slice(0, 7)}</code>\n\n<i>👉 Khi máy tính chính bật lại, code sẽ tự động git pull về ổ cứng!</i>`);
                } else {
                    await sendTelegramMessage(chatId, `❌ Lỗi commit: ${commitRes.error}`);
                }
                return res.status(200).json({ ok: true });
            }
        }

        // 8. Xử lý ảnh (Vision)
        if (msg.photo && msg.photo.length > 0) {
            const largest = msg.photo[msg.photo.length - 1];
            const fileId = largest.file_id;
            const caption = msg.caption ? msg.caption.trim() : 'Hãy quan sát bức ảnh này và phân tích chi tiết giúp tôi.';

            await sendTelegramMessage(chatId, `📷 <b>[CLOUD VISION - ĐANG PHÂN TÍCH ẢNH...]</b>\n<blockquote><i>"${caption.slice(0, 100)}"</i></blockquote>`);

            const fInfoResp = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${fileId}`);
            const fInfo = await fInfoResp.json();

            if (fInfo.ok && fInfo.result?.file_path) {
                const dlResp = await fetch(`https://api.telegram.org/file/bot${BOT_TOKEN}/${fInfo.result.file_path}`);
                const arrayBuffer = await dlResp.arrayBuffer();
                const base64 = Buffer.from(arrayBuffer).toString('base64');

                const answer = await askGeminiVision(caption, base64, 'image/jpeg');
                const htmlAnswer = convertMdToTgHtml(answer) + '\n\n☁️ <i>[Phản hồi từ QuinloveRin Cloud 24/7]</i>';
                await sendTelegramMessage(chatId, htmlAnswer);
            } else {
                await sendTelegramMessage(chatId, '❌ Không thể tải ảnh từ máy chủ Telegram.');
            }
            return res.status(200).json({ ok: true });
        }

        // 9. Xử lý tin nhắn văn bản thông thường (Prompt Lập trình & Hỏi đáp)
        if (msg.text) {
            const userPrompt = msg.text.trim();

            // Nếu người dùng gõ lệnh terminal đặc thù của Windows
            if (userPrompt.startsWith('/cmd ')) {
                const notice = `💻 <b>[CHẾ ĐỘ CLOUD GITOPS 24/7 - MÁY TÍNH ĐANG TẮT]</b>\n──────────────────────\nLệnh Terminal <code>${userPrompt}</code> yêu cầu máy tính Windows chính đang bật.\n\nHiện tại bro đang kết nối qua Cloud AI trên Vercel. Mọi file mã nguồn bro yêu cầu sẽ được lưu an toàn trên GitHub Repo <code>${CURRENT_ACTIVE_REPO}</code>. Khi máy tính chính có điện và bật lại, bro hãy gõ <code>/pc</code> để thực thi trực tiếp trên máy tính nhé!`;
                await sendTelegramMessage(chatId, notice);
                return res.status(200).json({ ok: true });
            }

            // Gọi Gemini AI xử lý
            const rawAnswer = await askGeminiText(userPrompt, CURRENT_ACTIVE_REPO);

            // Kiểm tra xem Gemini có xuất khối ```commit:<file_path>\n<code>``` không
            const commitRegex = /```commit:([^\r\n]+)\r?\n([\s\S]*?)```/g;
            let match;
            const committedFiles = [];

            while ((match = commitRegex.exec(rawAnswer)) !== null) {
                const targetFilePath = match[1].trim();
                const codeContent = match[2];
                try {
                    const commitRes = await commitFileToGitHub(
                        CURRENT_ACTIVE_REPO,
                        targetFilePath,
                        codeContent,
                        `feat(cloud): update ${targetFilePath} via Telegram Mobile`
                    );
                    if (commitRes.success) {
                        committedFiles.push({
                            file: targetFilePath,
                            sha: commitRes.sha.slice(0, 7)
                        });
                    }
                } catch (e) {
                    console.error('Lỗi tự động commit:', e);
                }
            }

            // Định dạng câu trả lời gửi về Telegram
            let cleanAnswer = rawAnswer.replace(/```commit:([^\r\n]+)/g, '```');
            let formatted = convertMdToTgHtml(cleanAnswer);

            if (committedFiles.length > 0) {
                let commitNotice = `\n\n💾 <b>[ĐÃ TỰ ĐỘNG COMMIT LÊN GITHUB]:</b>\n• <b>Repo</b>: <code>${CURRENT_ACTIVE_REPO}</code>\n`;
                for (const cf of committedFiles) {
                    commitNotice += `• <b>File</b>: <code>${cf.file}</code> (Commit: <code>${cf.sha}</code>)\n`;
                }
                commitNotice += `<i>👉 Toàn bộ mã nguồn đã được lưu an toàn trên GitHub Cloud! Khi máy tính chính bật lại, hệ thống sẽ tự động git pull về ổ cứng.</i>`;
                formatted += commitNotice;
            }

            formatted += '\n\n☁️ <i>[QuinloveRin Cloud GitOps 24/7]</i>';
            await sendTelegramMessage(chatId, formatted);
            return res.status(200).json({ ok: true });
        }

        return res.status(200).json({ ok: true });
    } catch (err) {
        console.error('Webhook error:', err);
        return res.status(200).json({ ok: true, error: err.message });
    }
}
