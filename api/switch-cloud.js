// Vercel Serverless Function: Switch Telegram Webhook to Cloud 24/7

const BOT_TOKEN = process.env.BOT_TOKEN;
const ALLOWED_CHAT_ID = process.env.ALLOWED_CHAT_ID;

export default async function handler(req, res) {
    const host = req.headers.host || 'quiniumthucode.vercel.app';
    const proto = req.headers['x-forwarded-proto'] || 'https';
    const webhookUrl = `${proto}://${host}/api/webhook`;

    try {
        const tgRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/setWebhook?url=${encodeURIComponent(webhookUrl)}`);
        const tgData = await tgRes.json();

        if (ALLOWED_CHAT_ID) {
            await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: ALLOWED_CHAT_ID,
                    text: `☁️ <b>[ĐÃ KÍCH HOẠT VERCEL CLOUD 24/7]</b>\n──────────────────────\nWebhook Telegram đã được chuyển giao thành công cho Vercel Cloud!\n\nBây giờ bro có thể tắt máy tính hoặc khi cúp điện thì Bot vẫn tự động trả lời 24/7 bằng Gemini AI!\n\n👉 Khi bật lại máy tính chính, gõ <code>/pc</code> để chuyển quyền lại cho máy tính.`,
                    parse_mode: 'HTML'
                })
            });
        }

        return res.status(200).json({
            ok: true,
            status: 'Vercel Cloud 24/7 is now ACTIVE',
            webhookUrl: webhookUrl,
            telegramResponse: tgData
        });
    } catch (err) {
        return res.status(500).json({ ok: false, error: err.message });
    }
}
