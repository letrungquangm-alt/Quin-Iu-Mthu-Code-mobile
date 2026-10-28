export default function handler(req, res) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(200).send(`
<!DOCTYPE html>
<html lang="vi">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>QuinloveRin Code - Cloud Gateway 24/7</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
        .card { background: #1e293b; padding: 2rem; border-radius: 1rem; border: 1px solid #334155; max-width: 480px; width: 90%; text-align: center; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.5); }
        h1 { color: #38bdf8; font-size: 1.5rem; margin-bottom: 0.5rem; }
        p { color: #94a3b8; line-height: 1.6; }
        .status { display: inline-block; background: #064e3b; color: #34d399; padding: 0.25rem 0.75rem; border-radius: 9999px; font-size: 0.875rem; font-weight: bold; margin-bottom: 1rem; }
        .btn { display: inline-block; background: #0284c7; color: white; text-decoration: none; padding: 0.75rem 1.5rem; border-radius: 0.5rem; font-weight: bold; margin-top: 1rem; transition: background 0.2s; }
        .btn:hover { background: #0369a1; }
    </style>
</head>
<body>
    <div class="card">
        <div class="status">🟢 CLOUD SERVERLESS ONLINE 24/7</div>
        <h1>QuinloveRin Code Gateway</h1>
        <p>Hệ thống dự phòng đám mây trên Vercel tự động phản hồi Telegram khi máy tính chính tắt hoặc cúp điện.</p>
        <a class="btn" href="/api/switch-cloud">⚡ Kích hoạt Webhook Cloud Ngay</a>
    </div>
</body>
</html>
    `);
}
